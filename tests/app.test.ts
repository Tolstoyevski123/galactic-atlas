import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  buildTables,
  countPlanetFilters,
  countStarFilters,
  EMPTY_PLANET_FILTER,
  EMPTY_STAR_FILTER,
  filterStars,
  queryPlanets,
  queryStars,
  rankByRelevance,
  sortRows,
  type StarTable,
} from '../src/browser/filterEngine'
import { buildKeyLookup, decodeAtlas, planetKey, starKey, systemKey } from '../src/data/atlas'
import { bayerSearchForms, fold, formatBayer } from '../src/data/names'
import { HZ_CONSERVATIVE, HZ_NONE, type StarsMeta, type SystemsFile } from '../src/data/schema'
import {
  equatorialToScene,
  orbitRadius,
  orbitState,
  planetClass,
  raDecOf,
  radiusFromMass,
  solveKepler,
  teffFromBv,
  teffToRgb,
} from '../src/lib/astro'
import { fixed, formatDec, formatDistance, formatPeriod, formatRa, sig } from '../src/lib/format'
import { layoutSystem, displayRadius, FRAME_RADIUS } from '../src/three/systemLayout'
import { buildHostOrbits, eclipticPole, MAX_RINGS, orbitNormal, systemRings } from '../src/three/hostOrbits'
import { effectiveMagnitude, hostMarkerRadius, hostRingness, referenceDistance, starAlpha, starSize } from '../src/three/view'

describe('astronomy helpers', () => {
  it('puts the Galactic centre on +X and the north Galactic pole on +Y', () => {
    const deg = Math.PI / 180
    const dir = (ra: number, dec: number) => [Math.cos(dec * deg) * Math.cos(ra * deg), Math.cos(dec * deg) * Math.sin(ra * deg), Math.sin(dec * deg)]
    const scene = equatorialToScene(new Float32Array([...dir(266.405, -28.936), ...dir(192.859, 27.128)]))
    expect(scene[0]).toBeCloseTo(1, 3)
    expect(scene[1]).toBeCloseTo(0, 3)
    expect(scene[4]).toBeCloseTo(1, 3)
    // A rotation: lengths are preserved.
    expect(Math.hypot(scene[0], scene[1], scene[2])).toBeCloseTo(1, 5)
  })

  it('recovers right ascension and declination', () => {
    const eq = raDecOf(-0.494323, 2.476731, -0.758485)! // Sirius
    expect(eq.raHours).toBeCloseTo(6.7525, 3)
    expect(eq.decDeg).toBeCloseTo(-16.716, 2)
    expect(raDecOf(0, 0, 0)).toBeNull()
  })

  it('solves Kepler’s equation', () => {
    for (const e of [0, 0.1, 0.5, 0.9]) {
      for (const m of [0.1, 1, 3, 5.5, -2, 9]) {
        const big = solveKepler(m, e)
        const wrapped = ((m % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
        expect(big - e * Math.sin(big)).toBeCloseTo(wrapped, 6)
      }
    }
  })

  it('keeps orbit geometry consistent', () => {
    expect(orbitState(1.234, 0).r).toBeCloseTo(1, 9)
    const e = 0.4
    expect(orbitState(0, e).r).toBeCloseTo(1 - e, 6) // periapsis
    expect(orbitState(Math.PI, e).r).toBeCloseTo(1 + e, 6) // apoapsis
    const s = orbitState(2, e)
    expect(orbitRadius(s.nu, e)).toBeCloseTo(s.r, 6)
  })

  it('gives plausible star colours and planet sizes', () => {
    const [r, , b] = teffToRgb(3000)
    expect(r).toBeGreaterThan(b) // cool stars are orange
    const hot = teffToRgb(20000)
    expect(hot[2]).toBeGreaterThan(hot[0]) // hot stars are blue
    expect(teffFromBv(0.65)).toBeGreaterThan(5500)
    expect(teffFromBv(0.65)).toBeLessThan(6100)
    expect(radiusFromMass(1)).toBeCloseTo(1, 1)
    expect(radiusFromMass(2.04 - 1e-6)).toBeCloseTo(radiusFromMass(2.04 + 1e-6), 2) // continuous at the breaks
    expect(radiusFromMass(132 - 1e-4)).toBeCloseTo(radiusFromMass(132 + 1e-4), 1)
    expect(planetClass(1, undefined)).toBe('rocky')
    expect(planetClass(undefined, 318)).toBe('jovian')
    expect(planetClass(undefined, undefined)).toBe('unknown')
  })
})

describe('names and formatting', () => {
  it('formats and folds designations', () => {
    expect(formatBayer('Alp-1', 'Cen')).toBe('α¹ Cen')
    expect(formatBayer('Tau', 'Cet')).toBe('τ Cet')
    expect(fold('Güneş')).toBe('gunes')
    expect(fold('SIRIUS')).toBe('sirius')
    expect(fold('İstanbul ıy')).toBe('istanbul iy')
    expect(fold(bayerSearchForms('Alp-1', 'Cen'))).toContain('alpha1 centauri')
    expect(fold(bayerSearchForms('Alp-1', 'Cen'))).toContain('alf1 cen')
  })

  it('formats numbers the Turkish way', () => {
    expect(sig(0.01154, 3)).toBe('0,0115')
    expect(sig(12.43, 3)).toBe('12,4')
    expect(sig(1234.5, 3)).toBe('1.235')
    expect(sig(NaN)).toBe('—')
    expect(fixed(-1.44, 2)).toBe('-1,44')
    expect(formatDistance(2.6371, 'ly')).toBe('8,6 ıy')
    expect(formatDistance(2.6371, 'pc')).toBe('2,64 pc')
    expect(formatPeriod(0.5)).toBe('12 saat')
    expect(formatPeriod(365.256)).toBe('365 gün')
    expect(formatPeriod(4332.59)).toBe('11,9 yıl')
    expect(formatRa(6.752481)).toBe('06s 45d 09sn')
    expect(formatDec(-16.716116)).toBe('−16° 42′ 58″')
  })
})

describe('view model', () => {
  it('draws true apparent magnitudes near a target and never dims when zooming out', () => {
    expect(referenceDistance(5, 3)).toBe(10)
    expect(referenceDistance(30, 32)).toBeGreaterThan(10)
    expect(referenceDistance(30, 5000)).toBe(25)
    expect(referenceDistance(3500, 3500)).toBeCloseTo(100, 6)
    expect(effectiveMagnitude(4.83, 10, 10)).toBeCloseTo(4.83, 9)
    expect(starSize(-1, 6.5)).toBeGreaterThan(starSize(5, 6.5))
    expect(starAlpha(9, 6.5)).toBeLessThan(starAlpha(6.5, 6.5))
    expect(starAlpha(-5, 6.5)).toBe(1)
  })

  it('turns hosts near the target into rings only while looking at a neighbourhood', () => {
    expect(hostRingness(2, 30)).toBe(1)
    expect(hostRingness(40, 30)).toBe(0)
    expect(hostRingness(2, 500)).toBe(0)
    expect(hostMarkerRadius(30, 30, 2, 1)).toBeGreaterThan(hostMarkerRadius(30, 30, 40, 1))
    expect(hostMarkerRadius(30, 30, 2, 7)).toBeGreaterThan(hostMarkerRadius(30, 30, 2, 1)) // richer systems are drawn larger
    expect(hostMarkerRadius(30, 30, 40, 7)).toBe(hostMarkerRadius(30, 30, 40, 1)) // …but a far-away dot is just a dot
  })

  it('lays systems out on a square-root scale that fills the frame', () => {
    const planet = (a: number, extra: object = {}) => ({ id: `p${a}`, name: `p ${a}`, letter: 'b', method: 0, hz: 0 as const, a, index: 0, system: 0, ...extra })
    const system = { id: 's', host: 'S', star: 0, ra: 0, dec: 0, snum: 1, pnum: 2, rad: 1, mass: 1, hz: [0.75, 0.95, 1.68, 1.77] as [number, number, number, number], planets: [] }
    const layout = layoutSystem(system, [planet(0.05, { radius: 11 }), planet(4, { period: 2922 })])
    expect(displayRadius(layout.frameAu, layout.scale)).toBeCloseTo(FRAME_RADIUS, 6)
    expect(layout.frameAu).toBe(4)
    expect(layout.planets[0].period).toBeCloseTo(365.25 * Math.sqrt(0.05 ** 3), 6) // filled in from Kepler III
    expect(layout.starRadius).toBeLessThan(displayRadius(0.05, layout.scale))
    expect(layout.planets[0].size).toBeGreaterThan(layout.planets[1].size * 0.99)
    const unknown = layoutSystem(system, [{ ...planet(1), a: undefined, period: undefined }])
    expect(unknown.planets[0].drawn).toBe(false)
    expect(unknown.frameAu).toBeCloseTo(1.77, 6)
  })
})

describe('miniature systems on the map', () => {
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const length = (a: number[]) => Math.hypot(a[0], a[1], a[2])
  const system = (planets: Array<{ a?: number; period?: number; hz?: 0 | 1 | 2 }>, extra: object = {}) => ({
    id: 'test',
    host: 'Test',
    star: 1,
    ra: 0,
    dec: 0,
    snum: 1,
    pnum: planets.length,
    mass: 1,
    planets: planets.map((p, i) => ({ id: `test-${i}`, name: `Test ${i}`, letter: 'b', method: 0, hz: p.hz ?? (0 as const), a: p.a, period: p.period })),
    ...extra,
  })

  it('orients the orbital plane from the measured inclination', () => {
    const position: [number, number, number] = [3, -4, 12]
    const sight = position.map((v) => v / 13)
    // 90°: every transiting system — the line of sight from the Sun lies in the orbital plane.
    const edgeOn = orbitNormal(position, 90, 'a')
    expect(length(edgeOn)).toBeCloseTo(1, 6)
    expect(dot(edgeOn, sight)).toBeCloseTo(0, 6)
    // 0°: seen face-on from the Sun.
    expect(dot(orbitNormal(position, 0, 'a'), sight)).toBeCloseTo(1, 6)
    expect(dot(orbitNormal(position, 60, 'a'), sight)).toBeCloseTo(0.5, 6)
    // Unknown: still a unit vector, and the same one every time.
    expect(length(orbitNormal(position, undefined, 'b'))).toBeCloseTo(1, 6)
    expect(orbitNormal(position, undefined, 'b')).toEqual(orbitNormal(position, undefined, 'b'))
    expect(orbitNormal(position, undefined, 'b')).not.toEqual(orbitNormal(position, undefined, 'c'))
  })

  it('tilts the Solar System by the obliquity of the ecliptic', () => {
    const pole = eclipticPole()
    expect(length(pole)).toBeCloseTo(1, 5)
    // The ecliptic is inclined about 60.2° to the Galactic plane, whose pole is the scene's +Y.
    expect((Math.acos(pole[1]) * 180) / Math.PI).toBeCloseTo(60.2, 0)
  })

  it('draws one orbit per planet, scaled by semi-major axis, inner planets faster', () => {
    const rings = systemRings(system([{ a: 0.05, period: 4 }, { a: 1, period: 365, hz: 1 }, { a: 5.2, period: 4333 }]))
    expect(rings.count).toBe(3)
    expect(rings.radii.slice(0, 4)).toEqual([expect.any(Number), expect.any(Number), 1, 0])
    expect(rings.radii[0]).toBeLessThan(rings.radii[1])
    expect(rings.radii[1]).toBeLessThan(1)
    expect(rings.speeds[0]).toBeGreaterThan(rings.speeds[1])
    expect(rings.speeds[1]).toBeGreaterThan(rings.speeds[2])
    expect(rings.hzMask).toBe(0b010)
  })

  it('copes with missing orbits and crowded systems', () => {
    expect(systemRings(system([{ a: 0.7 }])).radii[0]).toBe(1)
    // Period only: the orbit size comes from Kepler's third law.
    expect(systemRings(system([{ period: 365.25 }, { a: 4 }])).count).toBe(2)
    // Nothing known: one placeholder orbit so the host still reads as a system.
    const unknown = systemRings(system([{}, {}]))
    expect([unknown.count, unknown.radii[0], unknown.radii[1]]).toEqual([1, 1, 0])
    const crowded = systemRings(system(Array.from({ length: 11 }, (_, i) => ({ a: 0.1 * (i + 1) }))))
    expect(crowded.count).toBe(MAX_RINGS)
    expect(crowded.radii.every((r) => r > 0 && r <= 1)).toBe(true)
  })
})

describe('filter engine', () => {
  const table: StarTable = {
    n: 6,
    dist: Float32Array.from([0, 2.6, 4.2, 100, 12.4, 8]),
    mag: Float32Array.from([-26.7, -1.44, 0.03, 6.2, NaN, 9]),
    absmag: Float32Array.from([4.85, 1.45, 0.6, 1.2, 16.5, 9.5]),
    ci: Float32Array.from([0.66, 0.01, 0, NaN, 2.2, 1.5]),
    spectClass: Uint8Array.from([4, 2, 2, 5, 6, 255]),
    spectKey: Float32Array.from([42, 20, 20, 51, 68, NaN]),
    con: Uint8Array.from([88, 3, 7, 3, 1, 3]),
    planets: Uint8Array.from([0, 0, 0, 1, 7, 0]),
    names: ['Güneş', 'Sirius', 'Vega', 'HD 10', 'TRAPPIST-1', 'HD 2'],
    search: ['gunes sol sun', 'sirius α cma alpha canis majoris hd 48915', 'vega α lyr', 'hd 10', 'trappist-1', 'hd 2'],
    nameRank: null,
  }
  const all = { key: 'default' as const, desc: false }

  it('returns everything for an empty filter', () => {
    expect([...queryStars(table, EMPTY_STAR_FILTER, all, null)]).toEqual([0, 1, 2, 3, 4, 5])
    expect(countStarFilters(EMPTY_STAR_FILTER)).toBe(0)
    expect(countPlanetFilters(EMPTY_PLANET_FILTER)).toBe(0)
  })

  it('applies inclusive ranges and drops rows with unknown values', () => {
    expect([...filterStars(table, { ...EMPTY_STAR_FILTER, dist: [2.6, 12.4] }, null)]).toEqual([1, 2, 4, 5])
    expect([...filterStars(table, { ...EMPTY_STAR_FILTER, mag: [null, 6.5] }, null)]).toEqual([0, 1, 2, 3]) // NaN mag excluded
    expect([...filterStars(table, { ...EMPTY_STAR_FILTER, ci: [0, 1] }, null)]).toEqual([0, 1, 2])
  })

  it('combines class, constellation, host and text criteria', () => {
    expect([...filterStars(table, { ...EMPTY_STAR_FILTER, classes: [2, 6] }, null)]).toEqual([1, 2, 4])
    expect([...filterStars(table, { ...EMPTY_STAR_FILTER, classes: [255] }, null)]).toEqual([5])
    expect([...filterStars(table, { ...EMPTY_STAR_FILTER, con: 3 }, null)]).toEqual([1, 3, 5])
    expect([...filterStars(table, { ...EMPTY_STAR_FILTER, hostsOnly: true }, null)]).toEqual([3, 4])
    expect([...filterStars(table, { ...EMPTY_STAR_FILTER, query: 'ALPHA  canis' }, null)]).toEqual([1])
    expect([...filterStars(table, { ...EMPTY_STAR_FILTER, query: 'Güneş' }, null)]).toEqual([0])
    expect([...filterStars(table, { ...EMPTY_STAR_FILTER, query: 'hd', con: 3, dist: [50, null] }, null)]).toEqual([3])
    expect(countStarFilters({ ...EMPTY_STAR_FILTER, query: 'hd', con: 3, dist: [50, null] })).toBe(2)
  })

  it('restricts to favourites', () => {
    const favourites = Int32Array.from([4, 1, 99])
    expect([...filterStars(table, { ...EMPTY_STAR_FILTER, favoritesOnly: true }, favourites)]).toEqual([1, 4])
    expect([...filterStars(table, { ...EMPTY_STAR_FILTER, favoritesOnly: true }, null)]).toEqual([])
  })

  it('sorts both ways with unknown values always last', () => {
    const rows = Int32Array.from([0, 1, 2, 3, 4, 5])
    expect([...sortRows(rows, table.mag, false)]).toEqual([0, 1, 2, 3, 5, 4])
    expect([...sortRows(rows, table.mag, true)]).toEqual([5, 3, 2, 1, 0, 4])
    expect([...queryStars(table, EMPTY_STAR_FILTER, { key: 'spect', desc: false }, null)]).toEqual([1, 2, 0, 3, 4, 5])
    expect([...queryStars(table, EMPTY_STAR_FILTER, { key: 'planets', desc: true }, null)].slice(0, 2)).toEqual([4, 3])
  })

  it('ranks the best name matches first while searching', () => {
    const names = ['Kepler-220 b', 'Kepler-22 b', 'Kepler-221 c', 'Kepler-22', 'HD 22 (kepler-22 field)']
    const rows = Int32Array.from([0, 1, 2, 3, 4])
    expect([...rankByRelevance(rows, names, 'KEPLER-22')]).toEqual([3, 1, 0, 2, 4])
    expect([...rankByRelevance(rows, names, '')]).toEqual([0, 1, 2, 3, 4])
    // In the table: stars *named* "HD …" come before Sirius, which only matches through its alias HD 48915 …
    expect([...queryStars(table, { ...EMPTY_STAR_FILTER, query: 'hd' }, all, null)]).toEqual([3, 5, 1])
    expect([...queryStars(table, { ...EMPTY_STAR_FILTER, query: 'hd 2' }, all, null)]).toEqual([5])
    // … unless the viewer asked for an explicit sort, which always wins.
    expect([...queryStars(table, { ...EMPTY_STAR_FILTER, query: 'hd' }, { key: 'dist', desc: false }, null)]).toEqual([1, 5, 3])
  })

  it('sorts names naturally', () => {
    const order = [...queryStars(table, EMPTY_STAR_FILTER, { key: 'name', desc: false }, null)].map((i) => table.names[i])
    expect(order).toEqual(['Güneş', 'HD 2', 'HD 10', 'Sirius', 'TRAPPIST-1', 'Vega'])
  })
})

// ── The generated catalogue itself (skipped until `npm run data` has been run).
const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data')
const hasData = existsSync(join(dataDir, 'stars.bin'))

describe.skipIf(!hasData)('generated catalogue', () => {
  const load = () => {
    const file = readFileSync(join(dataDir, 'stars.bin'))
    const bin = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer
    const meta = JSON.parse(readFileSync(join(dataDir, 'stars.meta.json'), 'utf8')) as StarsMeta
    const systems = JSON.parse(readFileSync(join(dataDir, 'systems.json'), 'utf8')) as SystemsFile
    return decodeAtlas(bin, meta, systems)
  }
  const atlas = hasData ? load() : null!

  it('has the Sun at the origin as row 0, with the Solar System attached', () => {
    expect(atlas.names[0]).toBe('Güneş')
    expect(atlas.dist[0]).toBe(0)
    const solar = atlas.systems[atlas.systemOfStar[0]]
    expect(solar.builtin).toBe(true)
    expect(solar.planets.map((p) => p.name)).toContain('Dünya')
    expect(atlas.planetCount[0]).toBe(0) // not an exoplanet host
  })

  it('keeps HYG rows sorted by brightness and every position finite', () => {
    for (let i = 2; i < atlas.hygCount; i++) expect(atlas.mag[i]).toBeGreaterThanOrEqual(atlas.mag[i - 1])
    expect(atlas.pos.every(Number.isFinite)).toBe(true)
    expect(atlas.absmag.every(Number.isFinite)).toBe(true)
  })

  it('finds well-known objects by their shareable keys', () => {
    const lookup = buildKeyLookup(atlas)
    const sirius = lookup.star('star-32349')
    expect(atlas.names[sirius]).toBe('Sirius')
    expect(atlas.dist[sirius]).toBeCloseTo(2.64, 1)
    expect(starKey(atlas, sirius)).toBe('star-32349')

    const trappist = atlas.systems[lookup.system('system-trappist-1')]
    expect(trappist.planets).toHaveLength(7)
    expect(trappist.planets.filter((p) => p.hz === HZ_CONSERVATIVE).map((p) => p.letter)).toEqual(['e', 'f', 'g'])
    expect(lookup.star(starKey(atlas, trappist.star))).toBe(trappist.star)

    const proximaB = atlas.planets[lookup.planet('planet-proxima-cen-b')]
    expect(proximaB.hz).toBe(HZ_CONSERVATIVE)
    expect(atlas.names[atlas.systems[proximaB.system].star]).toBe('Proxima Centauri')
    expect(lookup.planet(planetKey(proximaB))).toBe(proximaB.index)
    expect(lookup.system(systemKey(trappist))).toBeGreaterThanOrEqual(0)
    expect(lookup.star('star-999999999')).toBe(-1)
  })

  it('links systems, stars and planets consistently', () => {
    expect(atlas.planets.filter((p) => !atlas.systems[p.system].builtin)).toHaveLength(atlas.exoPlanetCount)
    for (const host of atlas.hosts) {
      const system = atlas.systems[atlas.systemOfStar[host]]
      expect(system.star).toBe(host)
      expect(atlas.planetCount[host]).toBe(Math.min(255, system.planets.length))
    }
    // A hot Jupiter is nowhere near its habitable zone.
    const peg = atlas.systems.find((s) => s.host === '51 Peg')!
    expect(peg.planets[0].hz).toBe(HZ_NONE)
  })

  it('builds a marker for every host plus the Sun, edge-on where planets transit', () => {
    const orbits = buildHostOrbits(atlas)
    const n = atlas.hosts.length + 1
    expect(orbits.stars).toHaveLength(n)
    expect(orbits.stars[n - 1]).toBe(0)
    expect(orbits.info[(n - 1) * 3 + 1]).toBe(8) // eight planets
    expect(orbits.info[(n - 1) * 3 + 2]).toBe(1) // flagged as home
    expect(orbits.normals.every(Number.isFinite)).toBe(true)

    // TRAPPIST-1 transits, so seen from the Sun its orbital plane is almost exactly edge-on.
    const lookup = buildKeyLookup(atlas)
    const star = atlas.systems[lookup.system('system-trappist-1')].star
    const m = orbits.stars.indexOf(star)
    const sight = [atlas.pos[star * 3], atlas.pos[star * 3 + 1], atlas.pos[star * 3 + 2]].map((v) => v / atlas.dist[star])
    const normal = [...orbits.normals.slice(m * 3, m * 3 + 3)]
    expect(Math.abs(normal[0] * sight[0] + normal[1] * sight[1] + normal[2] * sight[2])).toBeLessThan(0.02)
    expect(orbits.info[m * 3 + 1]).toBe(7)
    expect(orbits.info[m * 3]).toBe(0b0111100) // d, e, f, g are in the (optimistic) habitable zone
  })

  it('answers real queries', () => {
    const tables = buildTables(atlas)
    const named = queryStars(tables.stars, { ...EMPTY_STAR_FILTER, query: 'alpha centauri' }, { key: 'default', desc: false }, null)
    expect([...named].map((i) => atlas.names[i])).toEqual(expect.arrayContaining(['Rigil Kentaurus', 'Toliman']))
    const nakedEye = queryStars(tables.stars, { ...EMPTY_STAR_FILTER, mag: [null, 6.5] }, { key: 'default', desc: false }, null)
    expect(nakedEye.length).toBeGreaterThan(7000)
    expect(nakedEye.length).toBeLessThan(10000)
    const temperate = queryPlanets(tables.planets, { ...EMPTY_PLANET_FILTER, hz: 2, radius: [null, 1.6] }, { key: 'radius', desc: false }, null)
    expect([...temperate].map((i) => atlas.planets[i].name)).toEqual(expect.arrayContaining(['TRAPPIST-1 e', 'Proxima Cen b']))
    expect(temperate.every((i) => atlas.planets[i].hz === HZ_CONSERVATIVE)).toBe(true)
  })
})
