/**
 * Match NASA Exoplanet Archive host stars to HYG catalogue rows.
 *
 * Order of preference:
 *   1. Hipparcos number        (hip_name ↔ HYG hip)
 *   2. Henry Draper number     (hd_name  ↔ HYG hd)
 *   3. Gliese designation      (hostname "GJ 667 C" ↔ HYG gl)
 *   4. Position: nearest HYG star within a proper-motion-aware radius whose distance
 *      (or, failing that, V magnitude) agrees.
 *
 * Identifier matches are sanity-checked against the sky position so that a wrong
 * catalogue number cannot teleport a host across the sky. Hosts that match nothing
 * become synthetic stars downstream.
 */

import { HYG_NO_DISTANCE, normalizeGliese } from './fetch_hyg'
import { SkyIndex, separationArcsec, unitVector } from './util'

export interface HostInput {
  host: string
  /** Hipparcos / Henry Draper numbers, 0 when absent. */
  hip: number
  hd: number
  /** Degrees; NaN when unknown. */
  ra: number
  dec: number
  /** Parsec; NaN when unknown. */
  dist: number
  /** V magnitude; NaN when unknown. */
  vmag: number
}

export interface CatalogStar {
  hip: number
  hd: number
  /** Normalised Gliese designation ("GJ 667 C") or ''. */
  gl: string
  raDeg: number
  decDeg: number
  /** Parsec; HYG_NO_DISTANCE when unknown. */
  dist: number
  mag: number
  /** Total proper motion, mas/yr. */
  pm: number
}

export type MatchMethod = 'hip' | 'hd' | 'gj' | 'position'

export interface Match {
  index: number
  method: MatchMethod
  sepArcsec: number
}

/** "HIP 113357" / "HD 133131 A" → 113357 / 133131 (0 when the text does not parse). */
export function parseCatalogNumber(text: string | null | undefined, prefix: 'HIP' | 'HD'): number {
  if (!text) return 0
  const m = new RegExp(`^${prefix}\\s*(\\d+)`, 'i').exec(text.trim())
  return m ? Number(m[1]) : 0
}

/** Years between HYG's J2000.0 positions and the (mostly Gaia-epoch) NASA positions, with margin. */
const EPOCH_SPAN_YEARS = 30

/** How far an identifier-matched star may sit from the NASA position before the match is distrusted. */
function idMatchLimitArcsec(star: CatalogStar): number {
  return 90 + (star.pm * EPOCH_SPAN_YEARS) / 1000
}

/** Search radius for the position-only fallback. */
function positionLimitArcsec(star: CatalogStar): number {
  return 12 + (star.pm * 18) / 1000
}

function distanceAgrees(host: HostInput, star: CatalogStar): boolean {
  if (!Number.isFinite(host.dist) || star.dist >= HYG_NO_DISTANCE) return false
  return Math.abs(host.dist - star.dist) / Math.max(host.dist, star.dist) < 0.35
}

function magnitudeAgrees(host: HostInput, star: CatalogStar): boolean {
  return Number.isFinite(host.vmag) && Math.abs(host.vmag - star.mag) < 0.8
}

export function crossmatch(hosts: readonly HostInput[], catalog: readonly CatalogStar[]): Array<Match | null> {
  const byHip = new Map<number, number>()
  const byHd = new Map<number, number>()
  const byGl = new Map<string, number>()
  const vectors: Array<[number, number, number]> = new Array(catalog.length)
  for (let i = 0; i < catalog.length; i++) {
    const s = catalog[i]
    if (s.hip && !byHip.has(s.hip)) byHip.set(s.hip, i)
    if (s.hd && !byHd.has(s.hd)) byHd.set(s.hd, i)
    if (s.gl && !byGl.has(s.gl)) byGl.set(s.gl, i)
    vectors[i] = unitVector(s.raDeg, s.decDeg)
  }
  const sky = new SkyIndex(vectors)
  const claimed = new Set<number>()

  const results: Array<Match | null> = []
  for (const host of hosts) {
    const hasPosition = Number.isFinite(host.ra) && Number.isFinite(host.dec)
    const v = hasPosition ? unitVector(host.ra, host.dec) : null

    const tryId = (index: number | undefined, method: MatchMethod): Match | null => {
      if (index === undefined || claimed.has(index)) return null
      const sep = v ? separationArcsec(v, vectors[index]) : 0
      if (v && sep > idMatchLimitArcsec(catalog[index])) return null
      return { index, method, sepArcsec: sep }
    }

    let match: Match | null = null
    if (host.hip) match = tryId(byHip.get(host.hip), 'hip')
    if (!match && host.hd) match = tryId(byHd.get(host.hd), 'hd')
    if (!match) {
      const gl = normalizeGliese(host.host)
      if (gl) {
        // "GJ 876" may be listed as "GJ 876 A" on the other side, and vice versa.
        const bare = gl.replace(/ [A-Z]{1,2}$/, '')
        match = tryId(byGl.get(gl), 'gj')
        if (!match && gl === bare) match = tryId(byGl.get(`${gl} A`), 'gj')
        if (!match && gl.endsWith(' A')) match = tryId(byGl.get(bare), 'gj')
      }
    }
    if (!match && v) {
      let best: Match | null = null
      // 400" comfortably covers the fastest-moving star's search radius.
      for (const hit of sky.within(v, 400)) {
        const star = catalog[hit.index]
        if (claimed.has(hit.index) || hit.sep > positionLimitArcsec(star)) continue
        if (!distanceAgrees(host, star) && !(magnitudeAgrees(host, star) && hit.sep < 10)) continue
        if (!best || hit.sep < best.sepArcsec) best = { index: hit.index, method: 'position', sepArcsec: hit.sep }
      }
      match = best
    }

    if (match) claimed.add(match.index)
    results.push(match)
  }
  return results
}
