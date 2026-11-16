/**
 * Build-time data pipeline:  npm run data   (add --refresh to re-download the sources)
 *
 *   HYG CSV ──┐
 *             ├─► clean ─► cross-match hosts ─► habitable zones ─► public/data/{stars.bin, *.json}
 *   NASA TAP ─┘
 */

import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DATA_VERSION,
  FLAG_ABSMAG_EST,
  FLAG_DIST_NASA,
  FLAG_HOST,
  FLAG_SYNTHETIC,
  HZ_CONSERVATIVE,
  HZ_OPTIMISTIC,
  SPECT_UNKNOWN,
  type ConstellationsFile,
  type PlanetRecord,
  type StarsMeta,
  type SystemRecord,
  type SystemsFile,
} from '../../src/data/schema'
import { CONSTELLATIONS_URL, loadConstellationFigures } from './constellations'
import { crossmatch, parseCatalogNumber, type HostInput, type MatchMethod } from './crossmatch'
import { packStars, writeOutputs, type StarRow } from './emit'
import { loadExoplanets, TAP_URL, type NasaRow } from './fetch_exoplanets'
import { HYG_NO_DISTANCE, HYG_URL, loadHyg, type HygStar } from './fetch_hyg'
import {
  classifyHz,
  habitableZone,
  luminosityFromMass,
  luminosityFromRadiusTeff,
  semiMajorAxisFromPeriod,
  type HabitableZone,
} from './habitable_zone'
import { SOLAR_PLANETS, SUN } from './solar_system'
import { bvFromTeff, classFromTeff, spectralClass } from './stellar'
import { makeSlugger, sig, SkyIndex, unitVector } from './util'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const cacheDir = join(root, '.cache')
const outDir = join(root, 'public', 'data')
const refresh = process.argv.includes('--refresh')

/** All planets of one host, with the stellar parameters reconciled across rows. */
interface HostGroup {
  host: string
  rows: NasaRow[]
  ra: number
  dec: number
  dist: number
  vmag: number
  bmag: number
  gmag: number
  teff: number
  /** Linear solar units. */
  lum: number
  lumSrc: 'cat' | 'rt' | 'mass' | null
  rad: number
  mass: number
  spect: string
}

const positive = (v: number | null | undefined): number => (v != null && Number.isFinite(v) && v > 0 ? v : NaN)
const finite = (v: number | null | undefined): number => (v != null && Number.isFinite(v) ? v : NaN)

function groupHosts(rows: NasaRow[]): HostGroup[] {
  const byHost = new Map<string, NasaRow[]>()
  for (const row of rows) {
    const list = byHost.get(row.hostname)
    if (list) list.push(row)
    else byHost.set(row.hostname, [row])
  }

  const groups: HostGroup[] = []
  for (const [host, list] of byHost) {
    list.sort((a, b) => a.pl_name.localeCompare(b.pl_name))
    // PSCompPars composes stellar values per planet row, so siblings can disagree or have gaps:
    // take the first usable value for each parameter.
    const first = (get: (r: NasaRow) => number): number => {
      for (const r of list) {
        const v = get(r)
        if (Number.isFinite(v)) return v
      }
      return NaN
    }
    const teff = first((r) => positive(r.st_teff))
    const rad = first((r) => positive(r.st_rad))
    const mass = first((r) => positive(r.st_mass))
    const logLum = first((r) => finite(r.st_lum))

    let lum = NaN
    let lumSrc: HostGroup['lumSrc'] = null
    if (Number.isFinite(logLum)) {
      lum = 10 ** logLum // the archive publishes log10(L/L☉)
      lumSrc = 'cat'
    } else if (Number.isFinite(rad) && Number.isFinite(teff)) {
      lum = luminosityFromRadiusTeff(rad, teff)
      lumSrc = 'rt'
    } else if (Number.isFinite(mass)) {
      lum = luminosityFromMass(mass)
      lumSrc = 'mass'
    }

    groups.push({
      host,
      rows: list,
      ra: first((r) => finite(r.ra)),
      dec: first((r) => finite(r.dec)),
      dist: first((r) => positive(r.sy_dist)),
      vmag: first((r) => finite(r.sy_vmag)),
      bmag: first((r) => finite(r.sy_bmag)),
      gmag: first((r) => finite(r.sy_gaiamag)),
      teff,
      lum,
      lumSrc,
      rad,
      mass,
      spect: list.find((r) => r.st_spectype)?.st_spectype ?? '',
    })
  }
  return groups
}

function hygToRow(star: HygStar, flags: number): StarRow {
  const isSol = star.id === 0
  return {
    x: isSol ? 0 : star.x,
    y: isSol ? 0 : star.y,
    z: isSol ? 0 : star.z,
    mag: star.mag,
    absmag: star.absmag,
    ci: star.ci,
    hip: star.hip,
    hd: star.hd,
    hygId: star.id,
    spect: star.spect,
    spectClass: spectralClass(star.spect),
    con: star.con,
    flags,
    proper: star.proper,
    bayer: star.bayer,
    flam: star.flam,
    gl: star.gl,
  }
}

function positionAt(raDeg: number, decDeg: number, dist: number): [number, number, number] {
  const [ux, uy, uz] = unitVector(raDeg, decDeg)
  return [ux * dist, uy * dist, uz * dist]
}

const absoluteMagnitude = (mag: number, dist: number): number => mag - 5 * Math.log10(dist / 10)

function syntheticRow(group: HostGroup, con: string): StarRow {
  const [x, y, z] = positionAt(group.ra, group.dec, group.dist)
  let flags = FLAG_SYNTHETIC | FLAG_HOST

  // Absolute magnitude drives how the star is drawn, so it must always be finite.
  let absmag: number
  if (Number.isFinite(group.vmag)) {
    absmag = absoluteMagnitude(group.vmag, group.dist)
  } else {
    flags |= FLAG_ABSMAG_EST
    if (Number.isFinite(group.gmag)) absmag = absoluteMagnitude(group.gmag, group.dist) // Gaia G as a stand-in for V
    else if (Number.isFinite(group.lum)) absmag = 4.83 - 2.5 * Math.log10(group.lum) // bolometric ≈ visual
    else absmag = 9 // typical faint dwarf host
  }

  let ci = NaN
  if (Number.isFinite(group.bmag) && Number.isFinite(group.vmag)) {
    const bv = group.bmag - group.vmag
    if (bv > -0.4 && bv < 2.5) ci = bv
  }
  if (!Number.isFinite(ci) && Number.isFinite(group.teff)) ci = bvFromTeff(group.teff)

  let cls = spectralClass(group.spect)
  if (cls === SPECT_UNKNOWN) cls = classFromTeff(group.teff)

  return {
    x, y, z,
    mag: group.vmag,
    absmag,
    ci,
    hip: 0,
    hd: 0,
    hygId: -1,
    spect: group.spect,
    spectClass: cls,
    con,
    flags,
    proper: '',
    bayer: '',
    flam: '',
    gl: '',
  }
}

interface Dictionaries {
  method: Map<string, number>
  facility: Map<string, number>
}

function buildPlanet(row: NasaRow, group: HostGroup, hz: HabitableZone | null, dict: Dictionaries, slug: (s: string) => string): PlanetRecord {
  const period = positive(row.pl_orbper)
  let a = positive(row.pl_orbsmax)
  let aEst = false
  if (!Number.isFinite(a) && Number.isFinite(period) && Number.isFinite(group.mass)) {
    a = semiMajorAxisFromPeriod(period, group.mass)
    aEst = true
  }
  const ecc = finite(row.pl_orbeccen)
  let insol = positive(row.pl_insol)
  if (!Number.isFinite(insol) && Number.isFinite(group.lum) && Number.isFinite(a)) insol = group.lum / (a * a)

  const planet: PlanetRecord = {
    id: slug(row.pl_name),
    name: row.pl_name,
    letter: row.pl_letter ?? '',
    method: dict.method.get(row.discoverymethod ?? '') ?? -1,
    hz: classifyHz(a, hz),
  }
  if (row.disc_year != null) planet.year = row.disc_year
  const fac = dict.facility.get(row.disc_facility ?? '')
  if (fac !== undefined) planet.fac = fac
  if (Number.isFinite(period)) planet.period = sig(period, 7)
  if (Number.isFinite(a)) planet.a = sig(a, 5)
  if (aEst) planet.aEst = true
  if (Number.isFinite(ecc) && ecc >= 0 && ecc < 1) planet.ecc = sig(ecc, 4)
  const radius = positive(row.pl_rade)
  if (Number.isFinite(radius)) planet.radius = sig(radius, 4)
  const mass = positive(row.pl_bmasse)
  if (Number.isFinite(mass)) {
    planet.mass = sig(mass, 4)
    if (row.pl_bmassprov) planet.massProv = row.pl_bmassprov
  }
  const eqt = positive(row.pl_eqt)
  if (Number.isFinite(eqt)) planet.eqt = Math.round(eqt)
  if (Number.isFinite(insol)) planet.insol = sig(insol, 4)
  if (row.pl_controv_flag === 1) planet.controversial = true
  return planet
}

function sortPlanets(planets: PlanetRecord[]): void {
  const key = (p: PlanetRecord) => p.a ?? (p.period != null ? Math.cbrt((p.period / 365.25) ** 2) : Infinity)
  planets.sort((p, q) => key(p) - key(q) || p.name.localeCompare(q.name))
}

function hzTuple(hz: HabitableZone): [number, number, number, number] {
  return [sig(hz.optInner, 4), sig(hz.inner, 4), sig(hz.outer, 4), sig(hz.optOuter, 4)]
}

async function main(): Promise<void> {
  const started = Date.now()
  console.log('▸ HYG kataloğu okunuyor…')
  const hyg = await loadHyg(cacheDir, refresh)
  console.log(`  ${hyg.length.toLocaleString('tr')} yıldız`)

  console.log('▸ NASA Exoplanet Archive (PSCompPars) okunuyor…')
  const nasa = await loadExoplanets(cacheDir, refresh)
  const groups = groupHosts(nasa)
  console.log(`  ${nasa.length.toLocaleString('tr')} gezegen, ${groups.length.toLocaleString('tr')} host yıldız`)

  console.log('▸ Host yıldızlar HYG ile eşleştiriliyor…')
  const hostInputs: HostInput[] = groups.map((g) => ({
    host: g.host,
    hip: parseCatalogNumber(g.rows.find((r) => r.hip_name)?.hip_name, 'HIP'),
    hd: parseCatalogNumber(g.rows.find((r) => r.hd_name)?.hd_name, 'HD'),
    ra: g.ra,
    dec: g.dec,
    dist: g.dist,
    vmag: g.vmag,
  }))
  const matches = crossmatch(hostInputs, hyg)
  const hostOfHyg = new Map<number, number>() // HYG array index → host group index
  const methodCounts: Record<MatchMethod, number> = { hip: 0, hd: 0, gj: 0, position: 0 }
  matches.forEach((m, gi) => {
    if (!m) return
    hostOfHyg.set(m.index, gi)
    methodCounts[m.method]++
  })

  // ── HYG rows: keep every star with a real distance; rescue hosts that only NASA has a distance for.
  interface Kept {
    row: StarRow
    hygIndex: number
  }
  const kept: Kept[] = []
  let droppedNoDistance = 0
  let rescuedByNasa = 0
  for (let i = 0; i < hyg.length; i++) {
    const star = hyg[i]
    const gi = hostOfHyg.get(i)
    const hostFlag = gi !== undefined ? FLAG_HOST : 0
    if (star.dist < HYG_NO_DISTANCE) {
      kept.push({ row: hygToRow(star, hostFlag), hygIndex: i })
    } else if (gi !== undefined && Number.isFinite(groups[gi].dist)) {
      const dist = groups[gi].dist
      const row = hygToRow(star, hostFlag | FLAG_DIST_NASA)
      ;[row.x, row.y, row.z] = positionAt(star.raDeg, star.decDeg, dist)
      row.absmag = absoluteMagnitude(star.mag, dist)
      kept.push({ row, hygIndex: i })
      rescuedByNasa++
    } else {
      droppedNoDistance++
    }
  }
  // Brightest first, so a prefix of the table is a magnitude-limited sample.
  kept.sort((a, b) => a.row.mag - b.row.mag || a.row.hygId - b.row.hygId)
  const rowOfHyg = new Map<number, number>()
  kept.forEach((k, rowIndex) => rowOfHyg.set(k.hygIndex, rowIndex))
  const starRows: StarRow[] = kept.map((k) => k.row)
  const hygCount = starRows.length

  // ── Synthetic stars for hosts HYG does not contain.
  const sky = new SkyIndex(hyg.map((s) => unitVector(s.raDeg, s.decDeg)))
  const starOfGroup = new Int32Array(groups.length).fill(-1)
  const synthetic: Array<{ gi: number; row: StarRow }> = []
  let hostsWithoutPosition = 0
  groups.forEach((g, gi) => {
    const m = matches[gi]
    if (m) {
      const rowIndex = rowOfHyg.get(m.index)
      if (rowIndex !== undefined) starOfGroup[gi] = rowIndex
      else hostsWithoutPosition++
      return
    }
    if (!Number.isFinite(g.dist) || !Number.isFinite(g.ra) || !Number.isFinite(g.dec)) {
      hostsWithoutPosition++
      return
    }
    // Constellation of the nearest catalogue star on the sky — exact except right at a boundary.
    const near = sky.nearest(unitVector(g.ra, g.dec))
    synthetic.push({ gi, row: syntheticRow(g, near ? hyg[near.index].con : '') })
  })
  synthetic.sort((a, b) => groups[a.gi].dist - groups[b.gi].dist)
  for (const s of synthetic) {
    starOfGroup[s.gi] = starRows.length
    starRows.push(s.row)
  }

  // ── Constellation figures, as rows of the table just built.
  console.log('▸ Takımyıldız çizgileri okunuyor…')
  const rowOfHip = new Map<number, number>()
  for (let row = 0; row < hygCount; row++) if (starRows[row].hip > 0) rowOfHip.set(starRows[row].hip, row)
  const constellations = await loadConstellationFigures(cacheDir, refresh, rowOfHip)
  console.log(`  ${constellations.figures.length} takımyıldız, ${constellations.segments.toLocaleString('tr')} çizgi parçası`)

  // ── Systems and planets.
  console.log('▸ Yaşanabilir bölgeler hesaplanıyor…')
  // Dictionary-encode the repetitive text columns, most frequent value first.
  const dictionary = (get: (r: NasaRow) => string | null): string[] => {
    const freq = new Map<string, number>()
    for (const r of nasa) {
      const v = get(r)
      if (v) freq.set(v, (freq.get(v) ?? 0) + 1)
    }
    return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name)
  }
  const methods = dictionary((r) => r.discoverymethod)
  const facilities = dictionary((r) => r.disc_facility)
  const dict: Dictionaries = {
    method: new Map(methods.map((m, i) => [m, i])),
    facility: new Map(facilities.map((f, i) => [f, i])),
  }

  const systemSlug = makeSlugger()
  const planetSlug = makeSlugger()
  let hzConservative = 0
  let hzOptimistic = 0
  let systemsWithHz = 0
  let systemsWithInclination = 0

  const order = groups.map((_, gi) => gi)
  const sortDist = (gi: number) => (Number.isFinite(groups[gi].dist) ? groups[gi].dist : Infinity)
  order.sort((a, b) => sortDist(a) - sortDist(b) || groups[a].host.localeCompare(groups[b].host))

  const systems: SystemRecord[] = []
  for (const gi of order) {
    const g = groups[gi]
    const star = starOfGroup[gi]
    const hz = habitableZone(g.lum, g.teff)
    const planets = g.rows.map((row) => buildPlanet(row, g, hz, dict, planetSlug))
    sortPlanets(planets)
    for (const p of planets) {
      if (p.hz === HZ_CONSERVATIVE) hzConservative++
      else if (p.hz === HZ_OPTIMISTIC) hzOptimistic++
    }

    // Prefer NASA's (mostly Gaia-based) distance; fall back to the matched catalogue star.
    let dist = g.dist
    if (!Number.isFinite(dist) && star >= 0) {
      const r = starRows[star]
      dist = Math.hypot(r.x, r.y, r.z)
    }

    const system: SystemRecord = {
      id: systemSlug(g.host),
      host: g.host,
      star,
      ra: sig(g.ra, 9),
      dec: sig(g.dec, 9),
      snum: g.rows[0].sy_snum ?? 1,
      pnum: planets.length,
      planets,
    }
    if (Number.isFinite(dist)) system.dist = sig(dist, 6)
    if (g.rows.some((r) => r.cb_flag === 1)) system.circumbinary = true
    // One orientation per system: the median of its planets' measured inclinations.
    const inclinations = g.rows
      .map((r) => finite(r.pl_orbincl))
      .filter((v) => Number.isFinite(v) && v >= 0 && v <= 180)
      .sort((a, b) => a - b)
    if (inclinations.length > 0) {
      system.incl = sig(inclinations[Math.floor(inclinations.length / 2)], 4)
      systemsWithInclination++
    }
    if (Number.isFinite(g.teff)) system.teff = Math.round(g.teff)
    if (Number.isFinite(g.lum) && g.lumSrc) {
      system.lum = sig(g.lum, 4)
      system.lumSrc = g.lumSrc
    }
    if (Number.isFinite(g.rad)) system.rad = sig(g.rad, 4)
    if (Number.isFinite(g.mass)) system.mass = sig(g.mass, 4)
    if (g.spect) system.spect = g.spect
    if (hz) {
      system.hz = hzTuple(hz)
      if (hz.extrapolated) system.hzExtrap = true
      systemsWithHz++
    }
    systems.push(system)
  }
  const exoSystemCount = systems.length
  const exoPlanetCount = systems.reduce((n, s) => n + s.planets.length, 0)

  // The Solar System rides along as the last entry, attached to Sol (row 0).
  const sunHz = habitableZone(SUN.lum, SUN.teff)!
  systems.push({
    id: 'gunes-sistemi',
    host: 'Güneş',
    star: 0,
    builtin: true,
    ra: 0,
    dec: 0,
    dist: 0,
    snum: 1,
    pnum: SOLAR_PLANETS.length,
    teff: SUN.teff,
    lum: SUN.lum,
    lumSrc: 'cat',
    rad: SUN.rad,
    mass: SUN.mass,
    spect: SUN.spect,
    hz: hzTuple(sunHz),
    planets: SOLAR_PLANETS.map((p) => ({
      id: planetSlug(p.name),
      name: p.name,
      letter: '',
      method: -1,
      period: p.period,
      a: p.a,
      ecc: p.ecc,
      radius: p.radius,
      mass: p.mass,
      massProv: 'Mass',
      eqt: p.eqt,
      insol: sig(SUN.lum / (p.a * p.a), 4),
      hz: classifyHz(p.a, sunHz),
    })),
  })

  // ── Emit.
  console.log('▸ Çıktılar yazılıyor…')
  const generatedAt = new Date().toISOString()
  const today = generatedAt.slice(0, 10)
  const packed = packStars(starRows)
  const stats: Record<string, number> = {
    hygInput: hyg.length,
    hygKept: hygCount,
    hygDroppedNoDistance: droppedNoDistance,
    hygRescuedWithNasaDistance: rescuedByNasa,
    syntheticHosts: synthetic.length,
    hosts: groups.length,
    hostsMatchedHip: methodCounts.hip,
    hostsMatchedHd: methodCounts.hd,
    hostsMatchedGliese: methodCounts.gj,
    hostsMatchedPosition: methodCounts.position,
    hostsWithoutPosition,
    planets: exoPlanetCount,
    systemsWithHz,
    systemsWithInclination,
    planetsInConservativeHz: hzConservative,
    planetsInOptimisticHzOnly: hzOptimistic,
    constellations: constellations.figures.length,
    constellationSegments: constellations.segments,
    constellationStarsMissing: constellations.missingStars,
  }
  const meta: StarsMeta = {
    ...packed.meta,
    generatedAt,
    hygCount,
    stats,
    sources: [
      { name: 'HYG Database v4.1 (astronexus)', url: HYG_URL, license: 'CC BY-SA 4.0', retrieved: today },
      {
        name: 'NASA Exoplanet Archive — Planetary Systems Composite Parameters (DOI 10.26133/NEA13)',
        url: TAP_URL,
        license: 'Public (NASA/Caltech; atıf gerekli)',
        retrieved: today,
      },
      { name: 'Stellarium — "modern" gök kültürü (takımyıldız çizgileri)', url: CONSTELLATIONS_URL, license: 'CC BY-SA 4.0', retrieved: today },
    ],
  }
  const constellationsFile: ConstellationsFile = {
    version: DATA_VERSION,
    source: { name: 'Stellarium — modern sky culture', url: CONSTELLATIONS_URL, license: 'CC BY-SA 4.0' },
    figures: constellations.figures,
  }
  const systemsFile: SystemsFile = {
    version: DATA_VERSION,
    generatedAt,
    methods,
    facilities,
    exoSystemCount,
    exoPlanetCount,
    systems,
  }
  writeOutputs(outDir, packed.buffer, meta, systemsFile)
  writeFileSync(join(outDir, 'constellations.json'), JSON.stringify(constellationsFile))

  const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`
  console.log('')
  console.log('── Özet ─────────────────────────────────────────────')
  for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(28)} ${v.toLocaleString('tr')}`)
  console.log(`  ${'toplam yıldız satırı'.padEnd(28)} ${starRows.length.toLocaleString('tr')}`)
  console.log(`  ${'stars.bin'.padEnd(28)} ${mb(packed.buffer.byteLength)}`)
  console.log(`  ${'stars.meta.json'.padEnd(28)} ${mb(Buffer.byteLength(JSON.stringify(meta)))}`)
  console.log(`  ${'systems.json'.padEnd(28)} ${mb(Buffer.byteLength(JSON.stringify(systemsFile)))}`)
  console.log(`  süre: ${((Date.now() - started) / 1000).toFixed(1)} sn → ${outDir}`)
}

main().catch((err) => {
  console.error('\n✖ Veri hattı başarısız oldu:\n', err)
  process.exit(1)
})
