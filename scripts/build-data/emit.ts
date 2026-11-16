import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DATA_VERSION,
  type ColumnSpec,
  type ColumnType,
  type SparseStrings,
  type StarColumnName,
  type StarsMeta,
  type SystemsFile,
} from '../../src/data/schema'

/** One star as assembled by the pipeline, before packing into columns. */
export interface StarRow {
  x: number
  y: number
  z: number
  mag: number
  absmag: number
  ci: number
  hip: number
  hd: number
  hygId: number
  spect: string
  spectClass: number
  con: string
  flags: number
  proper: string
  bayer: string
  flam: string
  gl: string
}

const BYTES: Record<ColumnType, number> = { f32: 4, i32: 4, u16: 2, u8: 1 }

// Widest types first so every column starts on a suitably aligned offset.
const LAYOUT: Array<{ name: StarColumnName; type: ColumnType; components: number }> = [
  { name: 'pos', type: 'f32', components: 3 },
  { name: 'mag', type: 'f32', components: 1 },
  { name: 'absmag', type: 'f32', components: 1 },
  { name: 'ci', type: 'f32', components: 1 },
  { name: 'hip', type: 'i32', components: 1 },
  { name: 'hd', type: 'i32', components: 1 },
  { name: 'hygId', type: 'i32', components: 1 },
  { name: 'spect', type: 'u16', components: 1 },
  { name: 'spectClass', type: 'u8', components: 1 },
  { name: 'con', type: 'u8', components: 1 },
  { name: 'flags', type: 'u8', components: 1 },
]

export interface PackedStars {
  buffer: ArrayBuffer
  meta: Omit<StarsMeta, 'stats' | 'sources' | 'generatedAt' | 'hygCount'>
}

/** Pack star rows into a single column-oriented buffer plus the metadata needed to read it back. */
export function packStars(rows: readonly StarRow[]): PackedStars {
  const n = rows.length
  const columns: ColumnSpec[] = []
  let offset = 0
  for (const col of LAYOUT) {
    const size = BYTES[col.type]
    offset = Math.ceil(offset / size) * size
    columns.push({ ...col, offset })
    offset += size * col.components * n
  }
  const byteLength = Math.ceil(offset / 4) * 4
  const buffer = new ArrayBuffer(byteLength)

  const view = <T extends ColumnType>(name: StarColumnName, type: T) => {
    const spec = columns.find((c) => c.name === name)!
    const length = n * spec.components
    if (type === 'f32') return new Float32Array(buffer, spec.offset, length)
    if (type === 'i32') return new Int32Array(buffer, spec.offset, length)
    if (type === 'u16') return new Uint16Array(buffer, spec.offset, length)
    return new Uint8Array(buffer, spec.offset, length)
  }

  const pos = view('pos', 'f32')
  const mag = view('mag', 'f32')
  const absmag = view('absmag', 'f32')
  const ci = view('ci', 'f32')
  const hip = view('hip', 'i32')
  const hd = view('hd', 'i32')
  const hygId = view('hygId', 'i32')
  const spect = view('spect', 'u16')
  const spectClass = view('spectClass', 'u8')
  const con = view('con', 'u8')
  const flags = view('flags', 'u8')

  // Dictionaries: entry 0 of spectDict is '' and the last constellation is '' (unknown).
  const spectDict: string[] = ['']
  const spectIndex = new Map<string, number>([['', 0]])
  const conNames = [...new Set(rows.map((r) => r.con).filter((c) => c !== ''))].sort()
  conNames.push('')
  const conIndex = new Map(conNames.map((c, i) => [c, i]))

  const proper: SparseStrings = []
  const bayer: SparseStrings = []
  const flamsteed: SparseStrings = []
  const gliese: SparseStrings = []

  for (let i = 0; i < n; i++) {
    const r = rows[i]
    pos[i * 3] = r.x
    pos[i * 3 + 1] = r.y
    pos[i * 3 + 2] = r.z
    mag[i] = r.mag
    absmag[i] = r.absmag
    ci[i] = r.ci
    hip[i] = r.hip
    hd[i] = r.hd
    hygId[i] = r.hygId
    let si = spectIndex.get(r.spect)
    if (si === undefined) {
      si = spectDict.length
      if (si > 0xffff) throw new Error('Tayf sözlüğü 65535 girdiyi aştı.')
      spectDict.push(r.spect)
      spectIndex.set(r.spect, si)
    }
    spect[i] = si
    spectClass[i] = r.spectClass
    con[i] = conIndex.get(r.con)!
    flags[i] = r.flags
    if (r.proper) proper.push([i, r.proper])
    if (r.bayer) bayer.push([i, r.bayer])
    if (r.flam) flamsteed.push([i, r.flam])
    if (r.gl) gliese.push([i, r.gl])
  }

  return {
    buffer,
    meta: {
      version: DATA_VERSION,
      count: n,
      byteLength,
      columns,
      constellations: conNames,
      spectDict,
      proper,
      bayer,
      flamsteed,
      gliese,
    },
  }
}

export function writeOutputs(outDir: string, bin: ArrayBuffer, meta: StarsMeta, systems: SystemsFile): void {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'stars.bin'), new Uint8Array(bin))
  writeFileSync(join(outDir, 'stars.meta.json'), JSON.stringify(meta))
  writeFileSync(join(outDir, 'systems.json'), JSON.stringify(systems))
}
