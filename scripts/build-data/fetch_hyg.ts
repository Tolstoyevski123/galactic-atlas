import { join } from 'node:path'
import { fetchCached, parseCsv } from './util'

export const HYG_URL =
  'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv'

/** HYG marks stars without a usable parallax with this distance (parsec). */
export const HYG_NO_DISTANCE = 100000

export interface HygStar {
  id: number
  /** 0 when absent. */
  hip: number
  hd: number
  /** Normalised Gliese designation, e.g. "GJ 667 C"; '' when absent. */
  gl: string
  proper: string
  /** Raw Bayer token, e.g. "Alp" or "Alp-1". */
  bayer: string
  /** Flamsteed number as text. */
  flam: string
  /** IAU constellation abbreviation. */
  con: string
  raDeg: number
  decDeg: number
  /** Parsec; HYG_NO_DISTANCE when unknown. */
  dist: number
  /** Total proper motion, mas/yr. */
  pm: number
  mag: number
  absmag: number
  spect: string
  /** B−V; NaN when unknown. */
  ci: number
  x: number
  y: number
  z: number
}

function num(s: string | undefined): number {
  if (s === undefined || s === '') return NaN
  const v = Number(s)
  return Number.isFinite(v) ? v : NaN
}

function int(s: string | undefined): number {
  const v = num(s)
  return Number.isFinite(v) ? Math.trunc(v) : 0
}

/**
 * "Gl 667C" / "GJ 1214" / "Gl 4.1B" → "GJ 667 C" / "GJ 1214" / "GJ 4.1 B".
 * Gliese, Gliese–Jahreiss and later supplements share one number space, so a single
 * "GJ" prefix is unambiguous.
 */
export function normalizeGliese(raw: string): string {
  const m = /^(?:GJ|Gl|Gliese|NN|Wo)\s*(\d+(?:\.\d+)?)\s*([A-Za-z]{0,2})$/.exec(raw.trim())
  if (!m) return ''
  return m[2] ? `GJ ${m[1]} ${m[2].toUpperCase()}` : `GJ ${m[1]}`
}

export function parseHyg(csv: string): HygStar[] {
  const rows = parseCsv(csv)
  const header = rows[0]
  const col = (name: string): number => {
    const i = header.indexOf(name)
    if (i < 0) throw new Error(`HYG CSV'de "${name}" kolonu yok — dosya biçimi değişmiş olabilir.`)
    return i
  }
  const c = {
    id: col('id'), hip: col('hip'), hd: col('hd'), gl: col('gl'), proper: col('proper'),
    ra: col('ra'), dec: col('dec'), dist: col('dist'), pmra: col('pmra'), pmdec: col('pmdec'),
    mag: col('mag'), absmag: col('absmag'), spect: col('spect'), ci: col('ci'),
    x: col('x'), y: col('y'), z: col('z'), bayer: col('bayer'), flam: col('flam'), con: col('con'),
  }

  const stars: HygStar[] = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    if (row.length < header.length) continue
    const mag = num(row[c.mag])
    const dist = num(row[c.dist])
    if (!Number.isFinite(mag) || !Number.isFinite(dist)) continue
    const pmra = num(row[c.pmra])
    const pmdec = num(row[c.pmdec])
    stars.push({
      id: int(row[c.id]),
      hip: int(row[c.hip]),
      hd: int(row[c.hd]),
      gl: normalizeGliese(row[c.gl]),
      proper: row[c.proper].trim(),
      bayer: row[c.bayer].trim(),
      flam: row[c.flam].trim(),
      con: row[c.con].trim(),
      raDeg: num(row[c.ra]) * 15, // HYG stores right ascension in hours
      decDeg: num(row[c.dec]),
      dist,
      pm: Math.hypot(Number.isFinite(pmra) ? pmra : 0, Number.isFinite(pmdec) ? pmdec : 0),
      mag,
      absmag: num(row[c.absmag]),
      spect: row[c.spect].trim(),
      ci: num(row[c.ci]),
      x: num(row[c.x]),
      y: num(row[c.y]),
      z: num(row[c.z]),
    })
  }
  return stars
}

export async function loadHyg(cacheDir: string, refresh: boolean): Promise<HygStar[]> {
  const csv = await fetchCached(HYG_URL, join(cacheDir, 'hyg', 'hygdata_v41.csv'), refresh)
  return parseHyg(csv)
}
