import { join } from 'node:path'
import { fetchCached } from './util'

/** Columns pulled from PSCompPars (one composite row per confirmed planet). */
const COLUMNS = [
  'pl_name', 'hostname', 'pl_letter', 'hd_name', 'hip_name',
  'sy_snum', 'sy_pnum', 'cb_flag',
  'discoverymethod', 'disc_year', 'disc_facility',
  'pl_orbper', 'pl_orbsmax', 'pl_orbeccen', 'pl_orbincl', 'pl_rade', 'pl_bmasse', 'pl_bmassprov',
  'pl_eqt', 'pl_insol', 'pl_controv_flag',
  'st_spectype', 'st_teff', 'st_lum', 'st_rad', 'st_mass',
  'sy_dist', 'ra', 'dec', 'sy_vmag', 'sy_bmag', 'sy_gaiamag',
] as const

export const TAP_QUERY = `select ${COLUMNS.join(',')} from pscomppars`
export const TAP_URL =
  'https://exoplanetarchive.ipac.caltech.edu/TAP/sync?format=json&query=' + encodeURIComponent(TAP_QUERY)

export interface NasaRow {
  pl_name: string
  hostname: string
  pl_letter: string | null
  hd_name: string | null
  hip_name: string | null
  sy_snum: number | null
  sy_pnum: number | null
  cb_flag: number | null
  discoverymethod: string | null
  disc_year: number | null
  disc_facility: string | null
  /** days */
  pl_orbper: number | null
  /** AU */
  pl_orbsmax: number | null
  pl_orbeccen: number | null
  /** Orbital inclination to the plane of the sky, degrees (90 = seen edge-on from the Sun). */
  pl_orbincl: number | null
  /** Earth radii */
  pl_rade: number | null
  /** Earth masses */
  pl_bmasse: number | null
  pl_bmassprov: string | null
  /** K */
  pl_eqt: number | null
  /** Earth flux */
  pl_insol: number | null
  pl_controv_flag: number | null
  st_spectype: string | null
  /** K */
  st_teff: number | null
  /** log10(L / L☉) — note the logarithm */
  st_lum: number | null
  /** R☉ */
  st_rad: number | null
  /** M☉ */
  st_mass: number | null
  /** parsec */
  sy_dist: number | null
  /** degrees */
  ra: number | null
  dec: number | null
  sy_vmag: number | null
  sy_bmag: number | null
  sy_gaiamag: number | null
}

export function parseExoplanets(json: string): NasaRow[] {
  const data: unknown = JSON.parse(json)
  if (!Array.isArray(data)) {
    throw new Error('NASA TAP yanıtı beklenen JSON dizisi değil (sorgu hatası olabilir).')
  }
  const rows: NasaRow[] = []
  for (const raw of data as Array<Record<string, unknown>>) {
    if (typeof raw.pl_name !== 'string' || typeof raw.hostname !== 'string') continue
    const row = {} as Record<string, unknown>
    for (const key of COLUMNS) {
      const v = raw[key]
      if (typeof v === 'string') row[key] = v.trim() === '' ? null : v.trim()
      else if (typeof v === 'number') row[key] = Number.isFinite(v) ? v : null
      else row[key] = null
    }
    rows.push(row as unknown as NasaRow)
  }
  return rows
}

export async function loadExoplanets(cacheDir: string, refresh: boolean): Promise<NasaRow[]> {
  const json = await fetchCached(TAP_URL, join(cacheDir, 'nasa', 'pscomppars.json'), refresh)
  return parseExoplanets(json)
}
