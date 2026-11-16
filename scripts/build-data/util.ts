import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export const DEG = Math.PI / 180
export const ARCSEC = DEG / 3600

/**
 * Download `url` into `cachePath` unless a cached copy exists (or `refresh` is set),
 * then return the file's text. Network errors are retried a few times.
 */
export async function fetchCached(url: string, cachePath: string, refresh: boolean): Promise<string> {
  if (!refresh && existsSync(cachePath)) return readFileSync(cachePath, 'utf8')
  mkdirSync(dirname(cachePath), { recursive: true })
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
      const text = await res.text()
      writeFileSync(cachePath, text)
      return text
    } catch (err) {
      lastError = err
      console.warn(`  indirme denemesi ${attempt}/3 başarısız: ${String(err)}`)
      await new Promise((r) => setTimeout(r, 1500 * attempt))
    }
  }
  throw new Error(`İndirilemedi: ${url}\n${String(lastError)}`)
}

/** RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). Returns rows of raw strings. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const n = text.length
  while (i < n) {
    const ch = text.charCodeAt(i)
    if (inQuotes) {
      if (ch === 34 /* " */) {
        if (text.charCodeAt(i + 1) === 34) {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      // Copy the run up to the next quote in one go.
      const end = text.indexOf('"', i)
      const stop = end === -1 ? n : end
      field += text.slice(i, stop)
      i = stop
      continue
    }
    if (ch === 34) {
      inQuotes = true
      i++
    } else if (ch === 44 /* , */) {
      row.push(field)
      field = ''
      i++
    } else if (ch === 10 /* \n */ || ch === 13 /* \r */) {
      row.push(field)
      field = ''
      rows.push(row)
      row = []
      i += ch === 13 && text.charCodeAt(i + 1) === 10 ? 2 : 1
    } else {
      // Copy the run up to the next delimiter in one go.
      let j = i + 1
      while (j < n) {
        const c = text.charCodeAt(j)
        if (c === 44 || c === 10 || c === 13 || c === 34) break
        j++
      }
      field += text.slice(i, j)
      i = j
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** "TRAPPIST-1 e" → "trappist-1-e". */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\+/g, 'p')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Hand out unique slugs, suffixing duplicates with -2, -3, … */
export function makeSlugger(): (name: string) => string {
  const used = new Map<string, number>()
  return (name) => {
    const base = slugify(name) || 'x'
    const seen = used.get(base) ?? 0
    used.set(base, seen + 1)
    return seen === 0 ? base : `${base}-${seen + 1}`
  }
}

/** Round to `digits` significant figures (keeps the JSON small without losing catalogue precision). */
export function sig(x: number, digits: number): number {
  if (!Number.isFinite(x) || x === 0) return x
  return Number(x.toPrecision(digits))
}

/** Unit vector for right ascension / declination given in degrees. */
export function unitVector(raDeg: number, decDeg: number): [number, number, number] {
  const ra = raDeg * DEG
  const dec = decDeg * DEG
  const c = Math.cos(dec)
  return [c * Math.cos(ra), c * Math.sin(ra), Math.sin(dec)]
}

/** Angular separation in arcseconds between two unit vectors. */
export function separationArcsec(a: readonly number[], b: readonly number[]): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  const chord = Math.sqrt(dx * dx + dy * dy + dz * dz)
  return (2 * Math.asin(Math.min(1, chord / 2))) / ARCSEC
}

/**
 * Spatial hash over points on the unit sphere. Cells are cubes in 3D, so there are no
 * pole or RA-wraparound special cases.
 */
export class SkyIndex {
  private readonly cells = new Map<number, number[]>()
  private readonly cell = 0.01 // ≈ 0.57° on the sphere
  private readonly span = 256

  constructor(private readonly vectors: ReadonlyArray<readonly number[]>) {
    for (let i = 0; i < vectors.length; i++) {
      const key = this.key(this.coord(vectors[i][0]), this.coord(vectors[i][1]), this.coord(vectors[i][2]))
      const bucket = this.cells.get(key)
      if (bucket) bucket.push(i)
      else this.cells.set(key, [i])
    }
  }

  private coord(v: number): number {
    return Math.floor(v / this.cell) + 128
  }

  private key(ix: number, iy: number, iz: number): number {
    return (ix * this.span + iy) * this.span + iz
  }

  /** Indices of all points within `radiusArcsec` of the unit vector `v`, with their separations. */
  within(v: readonly number[], radiusArcsec: number): Array<{ index: number; sep: number }> {
    const chord = 2 * Math.sin((radiusArcsec * ARCSEC) / 2)
    const reach = Math.ceil(chord / this.cell)
    const cx = this.coord(v[0])
    const cy = this.coord(v[1])
    const cz = this.coord(v[2])
    const out: Array<{ index: number; sep: number }> = []
    for (let ix = cx - reach; ix <= cx + reach; ix++) {
      for (let iy = cy - reach; iy <= cy + reach; iy++) {
        for (let iz = cz - reach; iz <= cz + reach; iz++) {
          const bucket = this.cells.get(this.key(ix, iy, iz))
          if (!bucket) continue
          for (const index of bucket) {
            const sep = separationArcsec(v, this.vectors[index])
            if (sep <= radiusArcsec) out.push({ index, sep })
          }
        }
      }
    }
    return out
  }

  /** Nearest point to `v`, searching outward up to `maxDeg` degrees. */
  nearest(v: readonly number[], maxDeg = 16): { index: number; sep: number } | null {
    for (let deg = 0.5; deg <= maxDeg; deg *= 2) {
      const hits = this.within(v, deg * 3600)
      if (hits.length === 0) continue
      let best = hits[0]
      for (const h of hits) if (h.sep < best.sep) best = h
      return best
    }
    return null
  }
}
