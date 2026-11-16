/**
 * Data contract shared by the build-time pipeline (scripts/build-data) and the app.
 *
 * Three files are emitted into public/data:
 *   stars.bin        column-oriented typed arrays (layout described by StarsMeta.columns)
 *   stars.meta.json  StarsMeta: layout, dictionaries and sparse name tables
 *   systems.json     SystemsFile: planetary systems and their planets
 */

export const DATA_VERSION = 3

/** Spectral class codes stored in the `spectClass` column. 0..6 = O B A F G K M. */
export const SPECTRAL_CLASSES = ['O', 'B', 'A', 'F', 'G', 'K', 'M'] as const
/** Anything classified but outside OBAFGKM: white dwarfs, L/T/Y dwarfs, Wolf–Rayet, carbon stars. */
export const SPECT_OTHER = 7
export const SPECT_UNKNOWN = 255

/** Bits of the `flags` column. */
export const FLAG_SYNTHETIC = 1 // not in HYG; placed from NASA ra/dec/distance
export const FLAG_HOST = 2 // has at least one confirmed planet
export const FLAG_ABSMAG_EST = 4 // absolute magnitude is an estimate (no V magnitude published)
export const FLAG_DIST_NASA = 8 // HYG had no usable parallax; distance taken from NASA

export type ColumnType = 'f32' | 'i32' | 'u16' | 'u8'

export interface ColumnSpec {
  name: StarColumnName
  type: ColumnType
  /** Values per star (3 for `pos`, otherwise 1). */
  components: number
  /** Byte offset into stars.bin. */
  offset: number
}

export type StarColumnName =
  | 'pos' // equatorial J2000 Cartesian, parsec: +X vernal equinox, +Y RA 6h, +Z north celestial pole
  | 'mag' // apparent V magnitude (NaN when unknown)
  | 'absmag' // absolute V magnitude (always finite; see FLAG_ABSMAG_EST)
  | 'ci' // B−V colour index (NaN when unknown)
  | 'hip' // Hipparcos number, 0 when absent
  | 'hd' // Henry Draper number, 0 when absent
  | 'hygId' // HYG row id, −1 for synthetic stars
  | 'spect' // index into StarsMeta.spectDict
  | 'spectClass' // see SPECTRAL_CLASSES / SPECT_OTHER / SPECT_UNKNOWN
  | 'con' // index into StarsMeta.constellations
  | 'flags'

/** Sparse table: [star index, text]. */
export type SparseStrings = Array<[number, string]>

export interface StarsMeta {
  version: number
  generatedAt: string
  /** Total number of star rows. */
  count: number
  /**
   * Rows [0, hygCount) come from HYG sorted by apparent magnitude (brightest first, Sol is row 0),
   * so any prefix of the table is a magnitude-limited sample. Rows after that are synthetic hosts.
   */
  hygCount: number
  byteLength: number
  columns: ColumnSpec[]
  /** IAU abbreviations; the last entry is '' (unknown). */
  constellations: string[]
  /** Spectral type strings; entry 0 is '' (unknown). */
  spectDict: string[]
  proper: SparseStrings
  bayer: SparseStrings
  flamsteed: SparseStrings
  gliese: SparseStrings
  stats: Record<string, number>
  sources: Array<{ name: string; url: string; license: string; retrieved: string }>
}

/** How a planet relates to its star's habitable zone. */
export const HZ_NONE = 0 // outside, or not enough data to tell
export const HZ_CONSERVATIVE = 1 // between runaway greenhouse and maximum greenhouse
export const HZ_OPTIMISTIC = 2 // only inside the wider recent-Venus .. early-Mars limits

export interface PlanetRecord {
  /** URL-safe slug, unique across the file. */
  id: string
  name: string
  letter: string
  /** Index into SystemsFile.methods; −1 for the Solar System. */
  method: number
  year?: number
  /** Index into SystemsFile.facilities (discovery facility). */
  fac?: number
  /** Orbital period, days. */
  period?: number
  /** Semi-major axis, AU. */
  a?: number
  /** `a` was derived here from Kepler's third law (period + stellar mass). */
  aEst?: true
  ecc?: number
  /** Radius, Earth radii. */
  radius?: number
  /** Mass (or M·sin i, see massProv), Earth masses. */
  mass?: number
  massProv?: string
  /** Equilibrium temperature, K. */
  eqt?: number
  /** Insolation relative to Earth. */
  insol?: number
  hz: 0 | 1 | 2
  controversial?: true
}

export interface SystemRecord {
  /** URL-safe slug, unique across the file. */
  id: string
  /** Host name as published by the NASA Exoplanet Archive. */
  host: string
  /** Row in the star table, −1 when the system has no published distance. */
  star: number
  /** The Solar System, bundled as a reference; not part of the exoplanet tables. */
  builtin?: true
  /** ICRS, degrees. */
  ra: number
  dec: number
  /** Parsec. */
  dist?: number
  /** Number of stars / planets in the system. */
  snum: number
  pnum: number
  circumbinary?: true
  /**
   * Orbital inclination to the plane of the sky, degrees (median over the system's planets).
   * 90 means the orbits are seen edge-on from the Sun — true of every transiting system.
   */
  incl?: number
  teff?: number
  /** Luminosity in solar units (linear). */
  lum?: number
  /** Where `lum` came from: catalogue, radius+temperature, or mass–luminosity relation. */
  lumSrc?: 'cat' | 'rt' | 'mass'
  rad?: number
  mass?: number
  spect?: string
  /** Habitable-zone limits in AU: [recent Venus, runaway greenhouse, maximum greenhouse, early Mars]. */
  hz?: [number, number, number, number]
  /** Stellar temperature was outside the model's 2600–7200 K range and got clamped. */
  hzExtrap?: true
  planets: PlanetRecord[]
}

export interface SystemsFile {
  version: number
  generatedAt: string
  methods: string[]
  facilities: string[]
  /** Systems [0, exoSystemCount) are exoplanet systems; the Solar System follows. */
  exoSystemCount: number
  exoPlanetCount: number
  systems: SystemRecord[]
}
