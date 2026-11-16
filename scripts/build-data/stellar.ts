import { SPECT_OTHER, SPECT_UNKNOWN } from '../../src/data/schema'

/**
 * Reduce a spectral type string ("G2V", "sdM4", "K1/K2III", "DA2", "M8.0 V") to a class code:
 * 0..6 for O B A F G K M, SPECT_OTHER for classified-but-exotic, SPECT_UNKNOWN otherwise.
 */
export function spectralClass(spect: string | null | undefined): number {
  if (!spect) return SPECT_UNKNOWN
  let t = spect.trim()
  if (t === '') return SPECT_UNKNOWN
  // White dwarfs: DA, DB, DC, DO, DQ, DZ, DX …
  if (/^(D[ABCOQZX]|WD)/.test(t)) return SPECT_OTHER
  // Luminosity prefixes: sd/esd/usd (subdwarf), d (dwarf), g (giant), c (supergiant).
  t = t.replace(/^(esd|usd|sd|d|g|c)(?=[OBAFGKM])/, '')
  const first = t[0]
  const main = 'OBAFGKM'.indexOf(first)
  if (main >= 0) return main
  // Lower-case k/m appear in the Gliese catalogue for uncertain late types.
  if (first === 'k') return 5
  if (first === 'm') return 6
  if ('LTYWCSNR'.includes(first)) return SPECT_OTHER
  return SPECT_UNKNOWN
}

/** Class code from effective temperature (K), for stars with no published spectral type. */
export function classFromTeff(teff: number): number {
  if (!Number.isFinite(teff) || teff <= 0) return SPECT_UNKNOWN
  if (teff >= 30000) return 0
  if (teff >= 10000) return 1
  if (teff >= 7500) return 2
  if (teff >= 6000) return 3
  if (teff >= 5200) return 4
  if (teff >= 3700) return 5
  if (teff >= 2400) return 6
  return SPECT_OTHER
}

/** Ballesteros (2012): effective temperature from B−V. */
export function teffFromBv(bv: number): number {
  return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62))
}

/** Inverse of teffFromBv by bisection; B−V is clamped to the relation's useful range. */
export function bvFromTeff(teff: number): number {
  let lo = -0.4
  let hi = 2.2
  if (teff >= teffFromBv(lo)) return lo
  if (teff <= teffFromBv(hi)) return hi
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (teffFromBv(mid) > teff) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
