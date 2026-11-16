/**
 * Habitable-zone limits after Kopparapu et al. (2013, ApJ 765, 131; 2014, ApJL 787, L29).
 *
 * Each limit is an effective stellar flux (relative to what Earth receives)
 *   S_eff = S_eff☉ + a·T + b·T² + c·T³ + d·T⁴,   T = T_eff − 5780 K
 * and the corresponding distance is  d = √(L / S_eff)  in AU, with L in solar units.
 * The fit is valid for 2600 K ≤ T_eff ≤ 7200 K.
 */

import { HZ_CONSERVATIVE, HZ_NONE, HZ_OPTIMISTIC } from '../../src/data/schema'

interface Limit {
  seffSun: number
  a: number
  b: number
  c: number
  d: number
}

// Coefficients for a 1 Earth-mass planet (Kopparapu et al. 2014, Table 1).
const RECENT_VENUS: Limit = { seffSun: 1.776, a: 2.136e-4, b: 2.533e-8, c: -1.332e-11, d: -3.097e-15 }
const RUNAWAY_GREENHOUSE: Limit = { seffSun: 1.107, a: 1.332e-4, b: 1.58e-8, c: -8.308e-12, d: -1.931e-15 }
const MAXIMUM_GREENHOUSE: Limit = { seffSun: 0.356, a: 6.171e-5, b: 1.698e-9, c: -3.198e-12, d: -5.575e-16 }
const EARLY_MARS: Limit = { seffSun: 0.32, a: 5.547e-5, b: 1.526e-9, c: -2.874e-12, d: -5.011e-16 }

export const HZ_TEFF_MIN = 2600
export const HZ_TEFF_MAX = 7200
const TEFF_SUN = 5780

function seff(limit: Limit, teff: number): number {
  const t = teff - TEFF_SUN
  return limit.seffSun + limit.a * t + limit.b * t * t + limit.c * t ** 3 + limit.d * t ** 4
}

export interface HabitableZone {
  /** Optimistic inner edge (recent Venus), AU. */
  optInner: number
  /** Conservative inner edge (runaway greenhouse), AU. */
  inner: number
  /** Conservative outer edge (maximum greenhouse), AU. */
  outer: number
  /** Optimistic outer edge (early Mars), AU. */
  optOuter: number
  /** True when T_eff was missing or outside the fitted range and had to be clamped. */
  extrapolated: boolean
}

/**
 * @param lum   stellar luminosity in solar units (linear, not log)
 * @param teff  effective temperature in K; when unknown the solar value is assumed,
 *              which reduces the model to d = √(L / S_eff☉)
 */
export function habitableZone(lum: number | null | undefined, teff: number | null | undefined): HabitableZone | null {
  if (lum == null || !Number.isFinite(lum) || lum <= 0) return null
  const known = teff != null && Number.isFinite(teff) && teff > 0
  const t = known ? Math.min(HZ_TEFF_MAX, Math.max(HZ_TEFF_MIN, teff)) : TEFF_SUN
  const edge = (limit: Limit) => Math.sqrt(lum / seff(limit, t))
  return {
    optInner: edge(RECENT_VENUS),
    inner: edge(RUNAWAY_GREENHOUSE),
    outer: edge(MAXIMUM_GREENHOUSE),
    optOuter: edge(EARLY_MARS),
    extrapolated: !known || t !== teff,
  }
}

/** Where a planet with semi-major axis `a` (AU) sits relative to the zone. */
export function classifyHz(a: number | null | undefined, hz: HabitableZone | null): 0 | 1 | 2 {
  if (a == null || !Number.isFinite(a) || !hz) return HZ_NONE
  if (a >= hz.inner && a <= hz.outer) return HZ_CONSERVATIVE
  if (a >= hz.optInner && a <= hz.optOuter) return HZ_OPTIMISTIC
  return HZ_NONE
}

/** Stefan–Boltzmann: L/L☉ from radius (R☉) and effective temperature (K). */
export function luminosityFromRadiusTeff(rad: number, teff: number): number {
  return rad * rad * (teff / 5772) ** 4
}

/** Rough main-sequence mass–luminosity relation (piecewise power law), solar units. */
export function luminosityFromMass(mass: number): number {
  if (mass < 0.43) return 0.23 * mass ** 2.3
  if (mass < 2) return mass ** 4
  if (mass < 55) return 1.4 * mass ** 3.5
  return 32000 * mass
}

/** Kepler's third law: semi-major axis in AU from period (days) and stellar mass (M☉). */
export function semiMajorAxisFromPeriod(periodDays: number, stellarMass: number): number {
  const years = periodDays / 365.25
  return Math.cbrt(stellarMass * years * years)
}
