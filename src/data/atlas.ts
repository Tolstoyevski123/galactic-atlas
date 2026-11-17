/**
 * In-memory catalogue: decodes the files emitted by the data pipeline into typed arrays and
 * derives everything the app needs (scene positions, display names, lookups).
 * Pure and DOM-free so the filter worker can run the very same code.
 */

import { equatorialToScene } from '../lib/astro'
import { bayerSearchForms, fold, formatBayer } from './names'
import {
  DATA_VERSION,
  FLAG_SYNTHETIC,
  type ColumnSpec,
  type PlanetRecord,
  type StarColumnName,
  type StarsMeta,
  type SystemRecord,
  type SystemsFile,
} from './schema'

export interface PlanetRow extends PlanetRecord {
  /** Global planet index (exoplanets first, Solar System last). */
  index: number
  /** Index of the owning system. */
  system: number
}

export interface Atlas {
  meta: StarsMeta
  count: number
  hygCount: number
  /** Equatorial xyz as stored in the file (parsec). */
  posEq: Float32Array
  /** Scene-frame xyz (see equatorialToScene): where the star is today. */
  pos: Float32Array
  /**
   * Scene-frame velocity relative to the Sun, parsec per year; zero where it is unknown
   * (FLAG_NO_VEL). Read positions at another date through starPositionAt().
   */
  vel: Float32Array
  /** Distance from the Sun today, parsec. */
  dist: Float32Array
  mag: Float32Array
  absmag: Float32Array
  ci: Float32Array
  hip: Int32Array
  hd: Int32Array
  hygId: Int32Array
  spect: Uint16Array
  spectClass: Uint8Array
  con: Uint8Array
  flags: Uint8Array
  /** Star → system index, −1 when the star hosts no known planets. Sol maps to the Solar System. */
  systemOfStar: Int32Array
  /** Star → number of confirmed exoplanets (0 for Sol). */
  planetCount: Uint8Array
  /** Primary display name of every star. */
  names: string[]
  proper: Map<number, string>
  bayer: Map<number, string>
  flamsteed: Map<number, string>
  gliese: Map<number, string>
  systems: SystemRecord[]
  planets: PlanetRow[]
  /** System → index of its first planet in `planets`. */
  planetStart: Int32Array
  exoSystemCount: number
  exoPlanetCount: number
  methods: string[]
  facilities: string[]
  /** Star rows that host exoplanets (excludes Sol). */
  hosts: Int32Array
  /** Index of the bundled Solar System in `systems`. */
  solSystem: number
}

function column(bin: ArrayBuffer, columns: ColumnSpec[], count: number, name: StarColumnName) {
  const spec = columns.find((c) => c.name === name)
  if (!spec) throw new Error(`Veri dosyasında "${name}" kolonu yok.`)
  const length = count * spec.components
  switch (spec.type) {
    case 'f32':
      return new Float32Array(bin, spec.offset, length)
    case 'i32':
      return new Int32Array(bin, spec.offset, length)
    case 'u16':
      return new Uint16Array(bin, spec.offset, length)
    default:
      return new Uint8Array(bin, spec.offset, length)
  }
}

export function decodeAtlas(bin: ArrayBuffer, meta: StarsMeta, file: SystemsFile): Atlas {
  if (meta.version !== DATA_VERSION || file.version !== DATA_VERSION) {
    throw new Error(
      `Veri sürümü uyuşmuyor (dosya v${meta.version}, uygulama v${DATA_VERSION}). "npm run data" ile yeniden üretin.`,
    )
  }
  if (bin.byteLength !== meta.byteLength) {
    throw new Error('stars.bin boyutu beklenenden farklı — dosya eksik inmiş olabilir.')
  }

  const n = meta.count
  const posEq = column(bin, meta.columns, n, 'pos') as Float32Array
  const pos = equatorialToScene(posEq)
  // A rotation is linear, so it carries velocities into the scene frame exactly as it does positions.
  const vel = equatorialToScene(column(bin, meta.columns, n, 'vel') as Float32Array)
  const dist = new Float32Array(n)
  for (let i = 0; i < n; i++) dist[i] = Math.hypot(posEq[3 * i], posEq[3 * i + 1], posEq[3 * i + 2])

  const hip = column(bin, meta.columns, n, 'hip') as Int32Array
  const hd = column(bin, meta.columns, n, 'hd') as Int32Array
  const hygId = column(bin, meta.columns, n, 'hygId') as Int32Array
  const con = column(bin, meta.columns, n, 'con') as Uint8Array
  const flags = column(bin, meta.columns, n, 'flags') as Uint8Array

  const proper = new Map<number, string>(meta.proper)
  const bayer = new Map<number, string>(meta.bayer)
  const flamsteed = new Map<number, string>(meta.flamsteed)
  const gliese = new Map<number, string>(meta.gliese)

  // Systems and the flattened planet list.
  const systems = file.systems
  const systemOfStar = new Int32Array(n).fill(-1)
  const planetCount = new Uint8Array(n)
  const planetStart = new Int32Array(systems.length)
  const planets: PlanetRow[] = []
  const hostList: number[] = []
  let solSystem = -1
  systems.forEach((sys, si) => {
    planetStart[si] = planets.length
    for (const p of sys.planets) planets.push({ ...p, index: planets.length, system: si })
    if (sys.builtin) solSystem = si
    if (sys.star >= 0) {
      systemOfStar[sys.star] = si
      if (!sys.builtin) {
        planetCount[sys.star] = Math.min(255, sys.planets.length)
        hostList.push(sys.star)
      }
    }
  })

  // Primary names, most recognisable designation first.
  const names = new Array<string>(n)
  for (let i = 0; i < n; i++) {
    const conAbbr = meta.constellations[con[i]]
    const b = bayer.get(i)
    const f = flamsteed.get(i)
    const si = systemOfStar[i]
    let name = proper.get(i)
    if (name === 'Sol') name = 'Güneş'
    if (!name && b) name = formatBayer(b, conAbbr)
    if (!name && f) name = `${f} ${conAbbr}`
    if (!name && si >= 0) name = systems[si].host
    if (!name) name = gliese.get(i)
    if (!name && hd[i] > 0) name = `HD ${hd[i]}`
    if (!name && hip[i] > 0) name = `HIP ${hip[i]}`
    names[i] = name ?? `HYG ${hygId[i]}`
  }

  return {
    meta,
    count: n,
    hygCount: meta.hygCount,
    posEq,
    pos,
    vel,
    dist,
    mag: column(bin, meta.columns, n, 'mag') as Float32Array,
    absmag: column(bin, meta.columns, n, 'absmag') as Float32Array,
    ci: column(bin, meta.columns, n, 'ci') as Float32Array,
    hip,
    hd,
    hygId,
    spect: column(bin, meta.columns, n, 'spect') as Uint16Array,
    spectClass: column(bin, meta.columns, n, 'spectClass') as Uint8Array,
    con,
    flags,
    systemOfStar,
    planetCount,
    names,
    proper,
    bayer,
    flamsteed,
    gliese,
    systems,
    planets,
    planetStart,
    exoSystemCount: file.exoSystemCount,
    exoPlanetCount: file.exoPlanetCount,
    methods: file.methods,
    facilities: file.facilities,
    hosts: Int32Array.from(hostList),
    solSystem,
  }
}

export interface Vec3Like {
  x: number
  y: number
  z: number
}

/**
 * Scene position of star `i`, `years` from today (negative = the past), assuming it keeps its
 * present velocity. This is the one place the time machine's motion is defined on the CPU; the
 * shaders compute the same `position + velocity · years`, so what is drawn, labelled and picked
 * always agrees.
 */
export function starPositionAt<T extends Vec3Like>(atlas: Atlas, i: number, years: number, out: T): T {
  const k = i * 3
  const pos = atlas.pos
  const vel = atlas.vel
  out.x = pos[k] + vel[k] * years
  out.y = pos[k + 1] + vel[k + 1] * years
  out.z = pos[k + 2] + vel[k + 2] * years
  return out
}

/** Distance of star `i` from the Sun, parsec, `years` from today. */
export function starDistanceAt(atlas: Atlas, i: number, years: number): number {
  const k = i * 3
  return Math.hypot(atlas.pos[k] + atlas.vel[k] * years, atlas.pos[k + 1] + atlas.vel[k + 1] * years, atlas.pos[k + 2] + atlas.vel[k + 2] * years)
}

/** Every designation of a star, primary name first, without duplicates. */
export function starDesignations(atlas: Atlas, i: number): string[] {
  const conAbbr = atlas.meta.constellations[atlas.con[i]]
  const out: string[] = [atlas.names[i]]
  const add = (s: string | undefined) => {
    if (s && !out.includes(s)) out.push(s)
  }
  const p = atlas.proper.get(i)
  add(p === 'Sol' ? 'Güneş' : p)
  const b = atlas.bayer.get(i)
  if (b) add(formatBayer(b, conAbbr))
  const f = atlas.flamsteed.get(i)
  if (f) add(`${f} ${conAbbr}`)
  const si = atlas.systemOfStar[i]
  if (si >= 0 && !atlas.systems[si].builtin) add(atlas.systems[si].host)
  add(atlas.gliese.get(i))
  if (atlas.hd[i] > 0) add(`HD ${atlas.hd[i]}`)
  if (atlas.hip[i] > 0) add(`HIP ${atlas.hip[i]}`)
  return out
}

/** Folded text a star can be found by: all designations plus spelled-out Bayer forms. */
export function starSearchText(atlas: Atlas, i: number): string {
  const parts = starDesignations(atlas, i)
  const b = atlas.bayer.get(i)
  if (b) parts.push(bayerSearchForms(b, atlas.meta.constellations[atlas.con[i]]))
  if (i === 0) parts.push('sol sun')
  return fold(parts.join(' '))
}

export function planetSearchText(atlas: Atlas, p: PlanetRow): string {
  const sys = atlas.systems[p.system]
  const starName = sys.star >= 0 ? atlas.names[sys.star] : ''
  return fold(`${p.name} ${sys.host} ${starName}`)
}

export const isSynthetic = (atlas: Atlas, i: number): boolean => (atlas.flags[i] & FLAG_SYNTHETIC) !== 0

/**
 * Stable, shareable key for a star (used in the URL hash and for favourites):
 * the Hipparcos number when there is one, otherwise the HYG id or the host system's slug.
 */
export function starKey(atlas: Atlas, i: number): string {
  if (atlas.hip[i] > 0) return `star-${atlas.hip[i]}`
  if (atlas.hygId[i] >= 0) return `star-hyg${atlas.hygId[i]}`
  const si = atlas.systemOfStar[i]
  return si >= 0 ? `star-s-${atlas.systems[si].id}` : `star-row${i}`
}

export const planetKey = (p: PlanetRow): string => `planet-${p.id}`
export const systemKey = (s: SystemRecord): string => `system-${s.id}`

export interface KeyLookup {
  star(key: string): number
  planet(key: string): number
  system(key: string): number
}

/** Reverse lookups for keys; built once on first use. */
export function buildKeyLookup(atlas: Atlas): KeyLookup {
  const byHip = new Map<number, number>()
  const byHyg = new Map<number, number>()
  for (let i = 0; i < atlas.count; i++) {
    if (atlas.hip[i] > 0) byHip.set(atlas.hip[i], i)
    if (atlas.hygId[i] >= 0) byHyg.set(atlas.hygId[i], i)
  }
  const systemById = new Map(atlas.systems.map((s, i) => [s.id, i]))
  const planetById = new Map(atlas.planets.map((p) => [p.id, p.index]))
  return {
    star(key) {
      const token = key.replace(/^star-/, '')
      if (/^\d+$/.test(token)) return byHip.get(Number(token)) ?? -1
      if (/^hyg\d+$/.test(token)) return byHyg.get(Number(token.slice(3))) ?? -1
      if (token.startsWith('s-')) {
        const si = systemById.get(token.slice(2))
        return si !== undefined ? atlas.systems[si].star : -1
      }
      return -1
    },
    planet: (key) => planetById.get(key.replace(/^planet-/, '')) ?? -1,
    system: (key) => systemById.get(key.replace(/^system-/, '')) ?? -1,
  }
}
