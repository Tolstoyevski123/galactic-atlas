/**
 * The history of exoplanet discovery, derived from the catalogue: how many planets were found
 * each year and by which method, and the year each system first appeared. Pure and DOM-free.
 */

import { METHOD_GROUPS, methodGroup } from '../data/labels'

/** The parts of the catalogue this module reads (an Atlas satisfies it). */
export interface DiscoverySource {
  systems: ReadonlyArray<{
    builtin?: true
    planets: ReadonlyArray<{ year?: number; method: number }>
  }>
  methods: readonly string[]
}

export interface DiscoveryStats {
  /** First and last year with a discovery; every year in between has a slot. */
  firstYear: number
  lastYear: number
  years: number[]
  /** counts[year − firstYear][group]: planets found that year, per METHOD_GROUPS entry. */
  counts: number[][]
  /** Planets found that year, all methods. */
  totals: number[]
  /** The tallest year, for scaling a chart. */
  maxTotal: number
  /** Planets known by the end of each year. */
  cumulative: number[]
  /** The same, per method group. */
  cumulativeByGroup: number[][]
  /** Systems with at least one known planet by the end of each year. */
  cumulativeSystems: number[]
  /**
   * Per system: the year its first planet was found. 0 — "always known" — for the Solar System
   * and for a system none of whose planets carries a year.
   */
  systemFirstYear: Float32Array
}

export function discoveryStats(source: DiscoverySource): DiscoveryStats {
  const groups = METHOD_GROUPS.length
  const groupOfMethod = source.methods.map((name) => methodGroup(name))
  const systemFirstYear = new Float32Array(source.systems.length)

  let firstYear = Infinity
  let lastYear = -Infinity
  source.systems.forEach((system, index) => {
    if (system.builtin) return
    let earliest = Infinity
    for (const planet of system.planets) {
      if (planet.year == null || !Number.isFinite(planet.year)) continue
      if (planet.year < earliest) earliest = planet.year
      if (planet.year < firstYear) firstYear = planet.year
      if (planet.year > lastYear) lastYear = planet.year
    }
    if (Number.isFinite(earliest)) systemFirstYear[index] = earliest
  })
  if (!Number.isFinite(firstYear)) {
    return { firstYear: 0, lastYear: 0, years: [], counts: [], totals: [], maxTotal: 0, cumulative: [], cumulativeByGroup: [], cumulativeSystems: [], systemFirstYear }
  }

  const span = lastYear - firstYear + 1
  const years = Array.from({ length: span }, (_, k) => firstYear + k)
  const counts = years.map(() => new Array<number>(groups).fill(0))
  const newSystems = new Array<number>(span).fill(0)
  source.systems.forEach((system, index) => {
    if (system.builtin) return
    for (const planet of system.planets) {
      if (planet.year == null || !Number.isFinite(planet.year)) continue
      counts[planet.year - firstYear][groupOfMethod[planet.method] ?? groups - 1]++
    }
    if (systemFirstYear[index] > 0) newSystems[systemFirstYear[index] - firstYear]++
  })

  const totals = counts.map((row) => row.reduce((sum, v) => sum + v, 0))
  const cumulative: number[] = []
  const cumulativeByGroup: number[][] = []
  const cumulativeSystems: number[] = []
  let planets = 0
  let systems = 0
  const perGroup = new Array<number>(groups).fill(0)
  for (let k = 0; k < span; k++) {
    planets += totals[k]
    systems += newSystems[k]
    for (let g = 0; g < groups; g++) perGroup[g] += counts[k][g]
    cumulative.push(planets)
    cumulativeSystems.push(systems)
    cumulativeByGroup.push([...perGroup])
  }

  return { firstYear, lastYear, years, counts, totals, maxTotal: Math.max(...totals), cumulative, cumulativeByGroup, cumulativeSystems, systemFirstYear }
}

const cache = new WeakMap<object, DiscoveryStats>()

/** discoveryStats(), computed once per catalogue. */
export function discoveryOf(atlas: DiscoverySource): DiscoveryStats {
  let stats = cache.get(atlas)
  if (!stats) {
    stats = discoveryStats(atlas)
    cache.set(atlas, stats)
  }
  return stats
}

/**
 * First-discovery year for a list of star rows (the host markers' order), 0 where the star has
 * no dated system — which the timeline reads as "always known".
 */
export function firstYearOfStars(stats: DiscoveryStats, systemOfStar: Int32Array, stars: ArrayLike<number>): Float32Array {
  const out = new Float32Array(stars.length)
  for (let k = 0; k < stars.length; k++) {
    const system = systemOfStar[stars[k]]
    out[k] = system >= 0 ? stats.systemFirstYear[system] : 0
  }
  return out
}

/**
 * Has a system first found in `firstYear` appeared on a timeline standing at `timelineYear`?
 * The timeline value is fractional and runs one ahead of the calendar: Y + 1 means "the end of
 * year Y", so everything found in Y or earlier is known. The host-marker shader applies the same test.
 */
export function isDiscovered(firstYear: number, timelineYear: number): boolean {
  return firstYear < timelineYear
}

/** Moments worth a line on the timeline. */
export const MILESTONES: ReadonlyArray<{ year: number; text: string }> = [
  { year: 1992, text: 'İlk ötegezegenler: PSR B1257+12 pulsarının çevresinde iki gezegen.' },
  { year: 1995, text: '51 Pegasi b — Güneş benzeri bir yıldızın çevresinde bulunan ilk gezegen.' },
  { year: 1999, text: 'HD 209458 b — yıldızının önünden geçerken yakalanan ilk gezegen.' },
  { year: 2009, text: 'Kepler uzay teleskobu fırlatıldı; geçiş yöntemi öne geçiyor.' },
  { year: 2014, text: 'Kepler-186f — yaşanabilir bölgede Dünya boyutunda ilk gezegen.' },
  { year: 2016, text: 'Proxima b — Güneş’e en yakın yıldızın gezegeni; Kepler’den toplu doğrulama.' },
  { year: 2017, text: 'TRAPPIST-1 — tek bir yıldızın çevresinde yedi kayaç gezegen.' },
  { year: 2018, text: 'TESS uzay teleskobu fırlatıldı: bütün gökyüzünde geçiş avı.' },
]

/** The most recent milestone at or before `year`, if any. */
export function milestoneFor(year: number): { year: number; text: string } | null {
  let found: { year: number; text: string } | null = null
  for (const m of MILESTONES) if (m.year <= year) found = m
  return found
}
