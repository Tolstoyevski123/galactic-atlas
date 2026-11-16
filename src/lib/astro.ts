/** Astronomy helpers shared by the scene, the panels and the tests. Pure functions only. */

export const PC_TO_LY = 3.2615638
export const AU_PER_PC = 206264.806
/** Solar radius in AU. */
export const R_SUN_AU = 0.00465047
export const TEFF_SUN = 5772

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/**
 * Equatorial (ICRS/J2000) → Galactic rotation matrix (ESA 1997, Hipparcos vol. 1).
 * Rows are the Galactic axes expressed in equatorial coordinates.
 */
const EQ_TO_GAL = [
  -0.0548755604162154, -0.873437090234885, -0.4838350155487132,
  0.4941094278755837, -0.4448296299600112, 0.7469822444972189,
  -0.8676661490190047, -0.1980763734312015, 0.4559837761750669,
]

/**
 * Convert packed equatorial xyz (parsec) into the scene frame:
 *   +X → Galactic centre, +Y → north Galactic pole, +Z → Galactic longitude 270° (right-handed).
 * The Milky Way's disc is therefore the scene's horizontal plane.
 */
export function equatorialToScene(src: Float32Array, out: Float32Array = new Float32Array(src.length)): Float32Array {
  const m = EQ_TO_GAL
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i]
    const y = src[i + 1]
    const z = src[i + 2]
    const gx = m[0] * x + m[1] * y + m[2] * z
    const gy = m[3] * x + m[4] * y + m[5] * z
    const gz = m[6] * x + m[7] * y + m[8] * z
    out[i] = gx
    out[i + 1] = gz
    out[i + 2] = -gy
  }
  return out
}

/** Right ascension (hours, 0..24) and declination (degrees) of an equatorial vector. */
export function raDecOf(x: number, y: number, z: number): { raHours: number; decDeg: number } | null {
  const r = Math.hypot(x, y, z)
  if (!(r > 0)) return null
  let ra = (Math.atan2(y, x) * 12) / Math.PI
  if (ra < 0) ra += 24
  return { raHours: ra, decDeg: (Math.asin(clamp(z / r, -1, 1)) * 180) / Math.PI }
}

/** Ballesteros (2012): effective temperature (K) from the B−V colour index. */
export function teffFromBv(bv: number): number {
  const c = clamp(bv, -0.4, 2.2)
  return 4600 * (1 / (0.92 * c + 1.7) + 1 / (0.92 * c + 0.62))
}

/**
 * Approximate sRGB colour of a black body (Tanner Helland's fit to the CIE data), each channel 0..1.
 * 6600 K comes out white; cooler stars drift orange, hotter ones blue.
 */
export function teffToRgb(teff: number): [number, number, number] {
  const t = clamp(teff, 1000, 40000) / 100
  let r: number
  let g: number
  let b: number
  if (t <= 66) {
    r = 255
    g = 99.4708025861 * Math.log(t) - 161.1195681661
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
  } else {
    r = 329.698727446 * (t - 60) ** -0.1332047592
    g = 288.1221695283 * (t - 60) ** -0.0755148492
    b = 255
  }
  return [clamp(r, 0, 255) / 255, clamp(g, 0, 255) / 255, clamp(b, 0, 255) / 255]
}

/** Push a colour away from grey; star colours are subtle and benefit from a little help on screen. */
export function saturate(rgb: [number, number, number], amount: number): [number, number, number] {
  const l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
  return [
    clamp(l + (rgb[0] - l) * amount, 0, 1),
    clamp(l + (rgb[1] - l) * amount, 0, 1),
    clamp(l + (rgb[2] - l) * amount, 0, 1),
  ]
}

/** Display colour for a star from its B−V index (NaN → neutral white). */
export function starColor(bv: number, boost = 1.35): [number, number, number] {
  if (!Number.isFinite(bv)) return [0.92, 0.94, 1.0]
  return saturate(teffToRgb(teffFromBv(bv)), boost)
}

/** Luminosity in solar units from absolute V magnitude (no bolometric correction). */
export function luminosityFromAbsMag(absmag: number): number {
  return 10 ** (0.4 * (4.83 - absmag))
}

/** Solve Kepler's equation M = E − e·sin E for the eccentric anomaly E (radians). */
export function solveKepler(meanAnomaly: number, ecc: number): number {
  const tau = Math.PI * 2
  let m = meanAnomaly % tau
  if (m < 0) m += tau
  if (ecc <= 0) return m
  const e = Math.min(ecc, 0.97)
  let x = e < 0.8 ? m : Math.PI
  for (let i = 0; i < 12; i++) {
    const dx = (x - e * Math.sin(x) - m) / (1 - e * Math.cos(x))
    x -= dx
    if (Math.abs(dx) < 1e-9) break
  }
  return x
}

/** Radius (in units of the semi-major axis) and true anomaly for a given mean anomaly. */
export function orbitState(meanAnomaly: number, ecc: number): { r: number; nu: number } {
  const e = clamp(ecc, 0, 0.97)
  const big = solveKepler(meanAnomaly, e)
  const cosE = Math.cos(big)
  const nu = Math.atan2(Math.sqrt(1 - e * e) * Math.sin(big), cosE - e)
  return { r: 1 - e * cosE, nu }
}

/** Orbit radius (units of a) at true anomaly ν. */
export function orbitRadius(nu: number, ecc: number): number {
  const e = clamp(ecc, 0, 0.97)
  return (1 - e * e) / (1 + e * Math.cos(nu))
}

/**
 * Chen & Kipping (2017) mass–radius relation, Earth units. Only used to give a planet with no
 * measured radius a plausible size on screen; it is always labelled as an estimate.
 */
export function radiusFromMass(mass: number): number {
  if (mass < 2.04) return 1.008 * mass ** 0.279
  if (mass < 132) return 0.808 * mass ** 0.589
  return 17.74 * mass ** -0.044
}

export type PlanetClass = 'rocky' | 'subneptune' | 'neptunian' | 'jovian' | 'unknown'

/** Coarse size class from radius (Earth radii), falling back to a mass-based estimate. */
export function planetClass(radius: number | undefined, mass: number | undefined): PlanetClass {
  const r = radius ?? (mass != null ? radiusFromMass(mass) : undefined)
  if (r == null) return 'unknown'
  if (r < 1.6) return 'rocky'
  if (r < 4) return 'subneptune'
  if (r < 8) return 'neptunian'
  return 'jovian'
}

/** Deterministic pseudo-random number in [0, 1) from a string — stable orbit phases per planet. */
export function hash01(text: string, salt = 0): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  h ^= h >>> 13
  h = Math.imul(h, 0x5bd1e995)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}
