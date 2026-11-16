/**
 * Geometry of the system view (orrery).
 *
 * Real systems span orders of magnitude (0.01 AU to hundreds of AU), so distances are drawn on a
 * square-root scale: display radius = scale · √(distance in AU), normalised so the system fills
 * a frame of FRAME_RADIUS units. The star's radius goes through the same mapping; planet globes
 * are exaggerated (they would be sub-pixel otherwise) and the UI says so.
 */

import type { PlanetRow } from '../data/atlas'
import type { SystemRecord } from '../data/schema'
import { clamp, hash01, R_SUN_AU, radiusFromMass } from '../lib/astro'

export const FRAME_RADIUS = 10

export interface PlanetLayout {
  planet: PlanetRow
  /** False when neither a semi-major axis nor a period is known: listed, but not drawn. */
  drawn: boolean
  /** Semi-major axis in AU (possibly estimated here from the period). */
  a: number
  ecc: number
  /** Orientation of the ellipse (radians). Not in the data: a stable pseudo-random value. */
  omega: number
  /** Mean anomaly at t = 0 (radians); also pseudo-random but stable. */
  phase: number
  /** Orbital period in days (possibly estimated here from the semi-major axis). */
  period: number
  /** Globe radius in display units. */
  size: number
  /** Radius in Earth radii used for the globe, and whether it is an estimate. */
  radius: number
  radiusEstimated: boolean
}

export interface SystemLayout {
  /** Display units per √AU. */
  scale: number
  /** Distance (AU) that maps to FRAME_RADIUS. */
  frameAu: number
  starRadius: number
  /** Habitable-zone edges in display units: [recent Venus, runaway, maximum greenhouse, early Mars]. */
  hz: [number, number, number, number] | null
  planets: PlanetLayout[]
  /** Shortest / longest drawn period, days (for the time-speed control). */
  minPeriod: number
  maxPeriod: number
}

export const displayRadius = (au: number, scale: number): number => scale * Math.sqrt(Math.max(au, 0))

export function layoutSystem(system: SystemRecord, planets: PlanetRow[]): SystemLayout {
  const stellarMass = system.mass ?? 1

  const items: PlanetLayout[] = planets.map((planet) => {
    let a = planet.a ?? NaN
    let period = planet.period ?? NaN
    if (!Number.isFinite(a) && Number.isFinite(period)) a = Math.cbrt(stellarMass * (period / 365.25) ** 2)
    if (!Number.isFinite(period) && Number.isFinite(a)) period = 365.25 * Math.sqrt(a ** 3 / stellarMass)
    const drawn = Number.isFinite(a) && a > 0
    const radiusEstimated = planet.radius == null
    const radius = planet.radius ?? (planet.mass != null ? radiusFromMass(planet.mass) : 2)
    return {
      planet,
      drawn,
      a,
      ecc: clamp(planet.ecc ?? 0, 0, 0.95),
      omega: hash01(planet.id, 1) * Math.PI * 2,
      phase: hash01(planet.id, 2) * Math.PI * 2,
      period,
      size: clamp(0.19 * Math.sqrt(radius), 0.13, 0.6),
      radius,
      radiusEstimated,
    }
  })

  const drawn = items.filter((p) => p.drawn)
  const apoapsis = drawn.length > 0 ? Math.max(...drawn.map((p) => p.a * (1 + p.ecc))) : NaN
  const periapsis = drawn.length > 0 ? Math.min(...drawn.map((p) => p.a * (1 - p.ecc))) : NaN
  const hzOuter = system.hz ? system.hz[3] : NaN

  // Frame the planets; include the habitable zone unless it is absurdly far outside their orbits.
  let frameAu: number
  if (Number.isFinite(apoapsis)) {
    frameAu = Number.isFinite(hzOuter) ? Math.max(apoapsis, Math.min(hzOuter, apoapsis * 12)) : apoapsis
  } else {
    frameAu = Number.isFinite(hzOuter) ? hzOuter : 1
  }
  const scale = FRAME_RADIUS / Math.sqrt(frameAu)

  const starAu = (system.rad ?? 1) * R_SUN_AU
  let starRadius = Math.max(0.16, displayRadius(starAu, scale))
  if (Number.isFinite(periapsis)) starRadius = Math.min(starRadius, 0.55 * displayRadius(periapsis, scale))

  // Keep exaggerated globes from swallowing a tight innermost orbit.
  if (Number.isFinite(periapsis)) {
    const cap = Math.max(0.05, 0.45 * displayRadius(periapsis, scale))
    for (const p of items) p.size = Math.min(p.size, cap)
  }

  const periods = drawn.map((p) => p.period).filter((p) => Number.isFinite(p) && p > 0)
  return {
    scale,
    frameAu,
    starRadius,
    hz: system.hz ? (system.hz.map((au) => displayRadius(au, scale)) as [number, number, number, number]) : null,
    planets: items,
    minPeriod: periods.length > 0 ? Math.min(...periods) : 365.25,
    maxPeriod: periods.length > 0 ? Math.max(...periods) : 365.25,
  }
}

/** A comfortable default time speed (days per second): the innermost planet laps in ~9 s. */
export function defaultSimSpeed(layout: SystemLayout): number {
  return layout.minPeriod / 9
}
