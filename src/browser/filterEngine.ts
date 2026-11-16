/**
 * Filter / search / sort engine for the data browser.
 *
 * Works on struct-of-arrays tables built once from the Atlas, and returns the matching row
 * indices as an Int32Array. Pure and synchronous: the worker wraps it, the tests call it directly.
 */

import { planetSearchText, starSearchText, type Atlas } from '../data/atlas'
import { fold } from '../data/names'
import { HZ_CONSERVATIVE, HZ_NONE, SPECT_UNKNOWN } from '../data/schema'

/** Inclusive numeric range; null means "open on that side". */
export type Range = [number | null, number | null]

export interface StarFilter {
  query: string
  /** Parsec. */
  dist: Range
  mag: Range
  absmag: Range
  ci: Range
  /** Spectral class codes (0..6 = OBAFGKM, 7 = other, 255 = unknown); empty = any. */
  classes: number[]
  /** Constellation index, −1 = any. */
  con: number
  hostsOnly: boolean
  favoritesOnly: boolean
}

export interface PlanetFilter {
  query: string
  /** Discovery method indices; empty = any. */
  methods: number[]
  year: Range
  /** Earth radii. */
  radius: Range
  /** Earth masses. */
  mass: Range
  /** Days. */
  period: Range
  /** AU. */
  a: Range
  /** Kelvin. */
  eqt: Range
  /** Parsec. */
  dist: Range
  /** Planets in the system. */
  pnum: Range
  /** 0 = any, 1 = inside the habitable zone (optimistic limits), 2 = inside the conservative zone only. */
  hz: 0 | 1 | 2
  favoritesOnly: boolean
}

export type StarSortKey = 'default' | 'name' | 'dist' | 'mag' | 'absmag' | 'ci' | 'spect' | 'con' | 'planets'
export type PlanetSortKey =
  | 'default' | 'name' | 'radius' | 'mass' | 'period' | 'a' | 'eqt' | 'year' | 'method' | 'dist' | 'pnum' | 'hz'

export interface Sort<K extends string> {
  key: K
  desc: boolean
}

export const EMPTY_STAR_FILTER: StarFilter = {
  query: '',
  dist: [null, null],
  mag: [null, null],
  absmag: [null, null],
  ci: [null, null],
  classes: [],
  con: -1,
  hostsOnly: false,
  favoritesOnly: false,
}

export const EMPTY_PLANET_FILTER: PlanetFilter = {
  query: '',
  methods: [],
  year: [null, null],
  radius: [null, null],
  mass: [null, null],
  period: [null, null],
  a: [null, null],
  eqt: [null, null],
  dist: [null, null],
  pnum: [null, null],
  hz: 0,
  favoritesOnly: false,
}

const rangeActive = (r: Range): boolean => r[0] !== null || r[1] !== null

/** Number of active criteria, for the badge on the filter button (the search box is not counted). */
export function countStarFilters(f: StarFilter): number {
  return (
    [f.dist, f.mag, f.absmag, f.ci].filter(rangeActive).length +
    (f.classes.length > 0 ? 1 : 0) +
    (f.con >= 0 ? 1 : 0) +
    (f.hostsOnly ? 1 : 0) +
    (f.favoritesOnly ? 1 : 0)
  )
}

export function countPlanetFilters(f: PlanetFilter): number {
  return (
    [f.year, f.radius, f.mass, f.period, f.a, f.eqt, f.dist, f.pnum].filter(rangeActive).length +
    (f.methods.length > 0 ? 1 : 0) +
    (f.hz !== 0 ? 1 : 0) +
    (f.favoritesOnly ? 1 : 0)
  )
}

export interface StarTable {
  n: number
  dist: Float32Array
  mag: Float32Array
  absmag: Float32Array
  ci: Float32Array
  spectClass: Uint8Array
  /** Sortable spectral key: class·10 + subtype, NaN when unknown. */
  spectKey: Float32Array
  con: Uint8Array
  planets: Uint8Array
  names: string[]
  search: string[]
  nameRank: Uint32Array | null
}

export interface PlanetTable {
  n: number
  radius: Float32Array
  mass: Float32Array
  period: Float32Array
  a: Float32Array
  eqt: Float32Array
  year: Float32Array
  dist: Float32Array
  pnum: Float32Array
  method: Int16Array
  hz: Uint8Array
  names: string[]
  search: string[]
  nameRank: Uint32Array | null
}

export interface Tables {
  stars: StarTable
  planets: PlanetTable
}

/** "G2V" → 42, "M5.5Ve" → 65.5; falls back to mid-class when there is no subtype. */
function spectralSortKey(cls: number, spect: string): number {
  if (cls === SPECT_UNKNOWN) return NaN
  if (cls > 6) return 75
  const letter = 'OBAFGKM'[cls]
  const at = spect.search(new RegExp(letter, 'i'))
  if (at >= 0) {
    const m = /^(\d+(?:\.\d+)?)/.exec(spect.slice(at + 1).trim())
    if (m) return cls * 10 + Math.min(9.9, Number(m[1]))
  }
  return cls * 10 + 5
}

export function buildTables(atlas: Atlas): Tables {
  const n = atlas.count
  const spectKey = new Float32Array(n)
  const starSearch = new Array<string>(n)
  for (let i = 0; i < n; i++) {
    spectKey[i] = spectralSortKey(atlas.spectClass[i], atlas.meta.spectDict[atlas.spect[i]])
    starSearch[i] = starSearchText(atlas, i)
  }

  const pn = atlas.exoPlanetCount
  const f32 = () => new Float32Array(pn).fill(NaN)
  const planets: PlanetTable = {
    n: pn,
    radius: f32(), mass: f32(), period: f32(), a: f32(), eqt: f32(), year: f32(), dist: f32(), pnum: f32(),
    method: new Int16Array(pn),
    hz: new Uint8Array(pn),
    names: new Array<string>(pn),
    search: new Array<string>(pn),
    nameRank: null,
  }
  for (let i = 0; i < pn; i++) {
    const p = atlas.planets[i]
    const sys = atlas.systems[p.system]
    if (p.radius != null) planets.radius[i] = p.radius
    if (p.mass != null) planets.mass[i] = p.mass
    if (p.period != null) planets.period[i] = p.period
    if (p.a != null) planets.a[i] = p.a
    if (p.eqt != null) planets.eqt[i] = p.eqt
    if (p.year != null) planets.year[i] = p.year
    if (sys.dist != null) planets.dist[i] = sys.dist
    planets.pnum[i] = sys.pnum
    planets.method[i] = p.method
    planets.hz[i] = p.hz
    planets.names[i] = p.name
    planets.search[i] = planetSearchText(atlas, p)
  }

  return {
    stars: {
      n,
      dist: atlas.dist,
      mag: atlas.mag,
      absmag: atlas.absmag,
      ci: atlas.ci,
      spectClass: atlas.spectClass,
      spectKey,
      con: atlas.con,
      planets: atlas.planetCount,
      names: atlas.names,
      search: starSearch,
      nameRank: null,
    },
    planets,
  }
}

interface ColumnTest {
  col: ArrayLike<number>
  lo: number
  hi: number
}

/**
 * Collect the active range criteria; a NaN cell fails every one of them.
 *
 * The columns are 32-bit floats, so a catalogue value of 6.2 is stored as 6.19999981. Bounds are
 * rounded the same way, otherwise "at least 6.2" would exclude the very stars listed as 6.2.
 */
function rangeTests(pairs: Array<[ArrayLike<number>, Range]>): ColumnTest[] {
  const tests: ColumnTest[] = []
  for (const [col, r] of pairs) {
    if (rangeActive(r)) tests.push({ col, lo: r[0] === null ? -Infinity : Math.fround(r[0]), hi: r[1] === null ? Infinity : Math.fround(r[1]) })
  }
  return tests
}

function passes(tests: ColumnTest[], i: number): boolean {
  for (let t = 0; t < tests.length; t++) {
    const v = tests[t].col[i]
    if (!(v >= tests[t].lo && v <= tests[t].hi)) return false
  }
  return true
}

function tokensOf(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean)
}

function matchesText(text: string, tokens: string[]): boolean {
  for (let t = 0; t < tokens.length; t++) if (!text.includes(tokens[t])) return false
  return true
}

function candidates(n: number, favoritesOnly: boolean, favorites: Int32Array | null): Int32Array | null {
  if (!favoritesOnly) return null
  const list = favorites ? favorites.filter((i) => i >= 0 && i < n) : new Int32Array(0)
  return list.sort()
}

export function filterStars(t: StarTable, f: StarFilter, favorites: Int32Array | null): Int32Array {
  const tests = rangeTests([
    [t.dist, f.dist],
    [t.mag, f.mag],
    [t.absmag, f.absmag],
    [t.ci, f.ci],
  ])
  const tokens = tokensOf(f.query)
  const classMask = new Uint8Array(256)
  for (const c of f.classes) classMask[c] = 1
  const useClass = f.classes.length > 0
  const pool = candidates(t.n, f.favoritesOnly, favorites)
  const total = pool ? pool.length : t.n

  const out = new Int32Array(total)
  let k = 0
  for (let j = 0; j < total; j++) {
    const i = pool ? pool[j] : j
    if (f.hostsOnly && t.planets[i] === 0) continue
    if (useClass && classMask[t.spectClass[i]] === 0) continue
    if (f.con >= 0 && t.con[i] !== f.con) continue
    if (tests.length > 0 && !passes(tests, i)) continue
    if (tokens.length > 0 && !matchesText(t.search[i], tokens)) continue
    out[k++] = i
  }
  return out.slice(0, k)
}

export function filterPlanets(t: PlanetTable, f: PlanetFilter, favorites: Int32Array | null): Int32Array {
  const tests = rangeTests([
    [t.year, f.year],
    [t.radius, f.radius],
    [t.mass, f.mass],
    [t.period, f.period],
    [t.a, f.a],
    [t.eqt, f.eqt],
    [t.dist, f.dist],
    [t.pnum, f.pnum],
  ])
  const tokens = tokensOf(f.query)
  const methodMask = new Uint8Array(256)
  for (const m of f.methods) if (m >= 0 && m < 256) methodMask[m] = 1
  const useMethod = f.methods.length > 0
  const pool = candidates(t.n, f.favoritesOnly, favorites)
  const total = pool ? pool.length : t.n

  const out = new Int32Array(total)
  let k = 0
  for (let j = 0; j < total; j++) {
    const i = pool ? pool[j] : j
    if (f.hz === 1 && t.hz[i] === HZ_NONE) continue
    if (f.hz === 2 && t.hz[i] !== HZ_CONSERVATIVE) continue
    if (useMethod && (t.method[i] < 0 || methodMask[t.method[i]] === 0)) continue
    if (tests.length > 0 && !passes(tests, i)) continue
    if (tokens.length > 0 && !matchesText(t.search[i], tokens)) continue
    out[k++] = i
  }
  return out.slice(0, k)
}

/**
 * With a search active and no explicit sort, put the best name matches first: typing
 * "kepler-22" should show Kepler-22 b above Kepler-220 b. Order within each tier is preserved.
 *   0 exact name · 1 name starts with the query as a whole word · 2 name starts with it · 3 the rest
 */
export function rankByRelevance(rows: Int32Array, names: string[], query: string): Int32Array {
  const q = fold(query).trim().replace(/\s+/g, ' ')
  if (q === '' || rows.length < 2) return rows
  const tiers: number[][] = [[], [], [], []]
  for (let k = 0; k < rows.length; k++) {
    const name = fold(names[rows[k]])
    const tier = name === q ? 0 : name.startsWith(q) ? (name.charCodeAt(q.length) === 32 ? 1 : 2) : 3
    tiers[tier].push(rows[k])
  }
  return Int32Array.from(tiers.flat())
}

/** Rank of every row in natural, locale-aware name order ("HD 2" before "HD 10"). */
function nameRanks(names: string[]): Uint32Array {
  const collator = new Intl.Collator('tr', { numeric: true, sensitivity: 'base' })
  const order = Array.from(names, (_, i) => i).sort((a, b) => collator.compare(names[a], names[b]) || a - b)
  const rank = new Uint32Array(names.length)
  for (let r = 0; r < order.length; r++) rank[order[r]] = r
  return rank
}

/** Sort row indices by a numeric column. Rows with no value always sink to the bottom. */
export function sortRows(rows: Int32Array, col: ArrayLike<number>, desc: boolean): Int32Array {
  const known = rows.filter((i) => col[i] === col[i])
  const unknown = rows.filter((i) => col[i] !== col[i])
  known.sort((a, b) => col[a] - col[b] || a - b)
  if (desc) known.reverse()
  const out = new Int32Array(rows.length)
  out.set(known, 0)
  out.set(unknown, known.length)
  return out
}

export function queryStars(t: StarTable, f: StarFilter, sort: Sort<StarSortKey>, favorites: Int32Array | null): Int32Array {
  const rows = filterStars(t, f, favorites)
  switch (sort.key) {
    case 'default':
      return sort.desc ? rows.reverse() : rankByRelevance(rows, t.names, f.query)
    case 'name':
      t.nameRank ??= nameRanks(t.names)
      return sortRows(rows, t.nameRank, sort.desc)
    case 'spect':
      return sortRows(rows, t.spectKey, sort.desc)
    default:
      return sortRows(rows, t[sort.key], sort.desc)
  }
}

export function queryPlanets(t: PlanetTable, f: PlanetFilter, sort: Sort<PlanetSortKey>, favorites: Int32Array | null): Int32Array {
  const rows = filterPlanets(t, f, favorites)
  switch (sort.key) {
    case 'default':
      return sort.desc ? rows.reverse() : rankByRelevance(rows, t.names, f.query)
    case 'name':
      t.nameRank ??= nameRanks(t.names)
      return sortRows(rows, t.nameRank, sort.desc)
    default:
      return sortRows(rows, t[sort.key], sort.desc)
  }
}
