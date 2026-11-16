/**
 * Real surface maps for the Solar System:  npm run textures   (add --refresh to re-download)
 *
 * NASA publishes a 3D model of the Sun and of every planet (science.nasa.gov, by NASA
 * Visualization Technology Applications and Development). Each .glb carries a colour map built
 * from spacecraft imagery. The models do not agree on how that map is laid out — some wrap a
 * cube around the globe, some a cylinder — so instead of guessing, this script reads each model's
 * own geometry and re-projects its map into the usual longitude × latitude image, at a
 * web-friendly size, into public/textures.
 *
 * Decoding and encoding run in the Chrome or Edge already installed on the machine (the same one
 * the e2e check drives), so no image library is needed.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright-core'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const cacheDir = join(root, '.cache', 'textures')
const outDir = join(root, 'public', 'textures')
const refresh = process.argv.includes('--refresh')

const NASA_MODELS = 'https://assets.science.nasa.gov/content/dam/science/psd/solar/2023/09'

interface Source {
  /** Output file name (without extension); matches the planet slug used by the app. */
  id: string
  url: string
  /** For a .glb: which material's map to take, and whether to re-project it through the mesh. */
  glb?: { material: number; slot: 'base' | 'emissive'; unwrap: boolean }
  /** Width of the output, px (never larger than the source). */
  width: number
  format: 'jpeg' | 'png'
}

const globe = (id: string, path: string, slot: 'base' | 'emissive' = 'base'): Source => ({
  id,
  url: `${NASA_MODELS}/${path}`,
  glb: { material: 0, slot, unwrap: true },
  width: 2048,
  format: 'jpeg',
})

const SOURCES: Source[] = [
  globe('gunes', 's/Sun_1_1391000.glb', 'emissive'),
  globe('merkur', 'm/Mercury_1_4878.glb'),
  globe('venus', 'v/Venus_1_12103.glb'),
  globe('dunya', 'e/Earth_1_12756.glb'),
  // NASA's Mars model is not in the same place; the Viking mosaic it uses is in NASA's 3D Resources repository.
  { id: 'mars', url: 'https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/Images%20and%20Textures/Mars/Mars.jpg', width: 2048, format: 'jpeg' },
  globe('jupiter', 'j/Jupiter_1_142984.glb'),
  globe('saturn', 's/Saturn_1_120536.glb'),
  // A radial strip: inner edge of the rings on the left, outer edge on the right, with transparency.
  { id: 'saturn-halkalar', url: `${NASA_MODELS}/s/Saturn_1_120536.glb`, glb: { material: 1, slot: 'base', unwrap: false }, width: 1024, format: 'png' },
  globe('uranus', 'u/Uranus_1_51118.glb'),
  globe('neptun', 'n/Neptune_1_49528.glb'),
]

async function download(url: string): Promise<Buffer> {
  const file = join(cacheDir, decodeURIComponent(url.slice(url.lastIndexOf('/') + 1)))
  if (!refresh && existsSync(file)) return readFileSync(file)
  mkdirSync(cacheDir, { recursive: true })
  const res = await fetch(url)
  if (!res.ok) throw new Error(`İndirilemedi (HTTP ${res.status}): ${url}`)
  const body = Buffer.from(await res.arrayBuffer())
  writeFileSync(file, body)
  return body
}

// ───────────────────────────────────────────────────────────── binary glTF

interface Gltf {
  nodes?: Array<{ mesh?: number; rotation?: [number, number, number, number] }>
  meshes?: Array<{ primitives: Array<{ material?: number; indices: number; attributes: { POSITION: number; TEXCOORD_0: number } }> }>
  materials?: Array<{ pbrMetallicRoughness?: { baseColorTexture?: { index: number } }; emissiveTexture?: { index: number } }>
  textures?: Array<{ source: number }>
  images?: Array<{ bufferView: number }>
  accessors?: Array<{ bufferView: number; byteOffset?: number; componentType: number; count: number }>
  bufferViews?: Array<{ byteOffset?: number; byteLength: number; byteStride?: number }>
}

interface Mesh {
  /** xyz per vertex, in the model's Y-up frame. */
  positions: number[]
  /** uv per vertex, origin at the image's top-left corner. */
  uvs: number[]
  indices: number[]
}

function parseGlb(glb: Buffer): { gltf: Gltf; bin: Buffer } {
  if (glb.readUInt32LE(0) !== 0x46546c67) throw new Error('Beklenen .glb dosyası değil.')
  const jsonLength = glb.readUInt32LE(12)
  const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8')) as Gltf
  return { gltf, bin: glb.subarray(20 + jsonLength + 8) } // the BIN chunk's 8-byte header follows the JSON chunk
}

/** The encoded image (PNG or JPEG bytes) behind one material slot. */
function imageOf(gltf: Gltf, bin: Buffer, material: number, slot: 'base' | 'emissive'): Buffer {
  const m = gltf.materials?.[material]
  const texture = slot === 'base' ? m?.pbrMetallicRoughness?.baseColorTexture : m?.emissiveTexture
  const image = texture ? gltf.images?.[gltf.textures?.[texture.index]?.source ?? -1] : undefined
  const view = image ? gltf.bufferViews?.[image.bufferView] : undefined
  if (!view) throw new Error('Modelde beklenen doku bulunamadı.')
  return bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)
}

function readAccessor(gltf: Gltf, bin: Buffer, index: number, components: number): number[] {
  const accessor = gltf.accessors![index]
  const view = gltf.bufferViews![accessor.bufferView]
  const size = accessor.componentType === 5126 || accessor.componentType === 5125 ? 4 : accessor.componentType === 5123 ? 2 : 1
  const stride = view.byteStride ?? size * components
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  const out: number[] = []
  for (let i = 0; i < accessor.count; i++) {
    for (let c = 0; c < components; c++) {
      const at = start + i * stride + c * size
      out.push(
        accessor.componentType === 5126 ? bin.readFloatLE(at) : accessor.componentType === 5125 ? bin.readUInt32LE(at) : accessor.componentType === 5123 ? bin.readUInt16LE(at) : bin.readUInt8(at),
      )
    }
  }
  return out
}

/** The triangles that use `material`, with the owning node's rotation applied. */
function meshOf(gltf: Gltf, bin: Buffer, material: number): Mesh {
  for (const node of gltf.nodes ?? []) {
    const primitive = node.mesh === undefined ? undefined : gltf.meshes?.[node.mesh].primitives.find((p) => (p.material ?? 0) === material)
    if (!primitive) continue
    const positions = readAccessor(gltf, bin, primitive.attributes.POSITION, 3)
    if (node.rotation) {
      const [qx, qy, qz, qw] = node.rotation
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i]
        const y = positions[i + 1]
        const z = positions[i + 2]
        // v' = v + 2·q × (q × v + w·v)
        const cx = qy * z - qz * y + qw * x
        const cy = qz * x - qx * z + qw * y
        const cz = qx * y - qy * x + qw * z
        positions[i] = x + 2 * (qy * cz - qz * cy)
        positions[i + 1] = y + 2 * (qz * cx - qx * cz)
        positions[i + 2] = z + 2 * (qx * cy - qy * cx)
      }
    }
    return { positions, uvs: readAccessor(gltf, bin, primitive.attributes.TEXCOORD_0, 2), indices: readAccessor(gltf, bin, primitive.indices, 1) }
  }
  throw new Error('Modelde beklenen geometri bulunamadı.')
}

// ───────────────────────────────────────────────────────────── re-projection (runs in the browser)

interface Job {
  base64: string
  width: number
  type: 'jpeg' | 'png'
  mesh: Mesh | null
}

/**
 * Decode the image, optionally re-project it through `mesh`, scale it and encode it again.
 *
 * Re-projection asks, for every pixel of the longitude × latitude output, "which point of the
 * model lies in this direction, and what does its map say there?" — a ray from the centre against
 * the model's triangles, found through a coarse grid so each pixel only tests a handful of them.
 * Longitude 0 is the model's −Z axis and east is +longitude, the convention of NASA's Earth model.
 */
async function convertInPage(job: Job): Promise<{ base64: string; width: number; height: number }> {
  const raw = Uint8Array.from(atob(job.base64), (c) => c.charCodeAt(0))
  const full = await createImageBitmap(new Blob([raw]))
  let canvas: OffscreenCanvas
  let w: number
  let h: number

  if (job.mesh) {
    // Source pixels, capped so a 16k map does not need a gigabyte of memory.
    const shrink = Math.min(1, 4096 / full.width)
    const sw = Math.round(full.width * shrink)
    const sh = Math.round(full.height * shrink)
    const sheet = new OffscreenCanvas(sw, sh)
    const sheetContext = sheet.getContext('2d', { willReadFrequently: true })!
    sheetContext.drawImage(shrink < 1 ? await createImageBitmap(full, { resizeWidth: sw, resizeHeight: sh, resizeQuality: 'high' }) : full, 0, 0)
    const source = sheetContext.getImageData(0, 0, sw, sh).data

    const { positions: P, uvs: T, indices: I } = job.mesh
    const triangles = I.length / 3
    w = job.width
    h = w / 2
    const CELL = 32
    const gridW = Math.ceil(w / CELL)
    const gridH = Math.ceil(h / CELL)
    const buckets: number[][] = Array.from({ length: gridW * gridH }, () => [])

    // Ray from the origin along (dx, dy, dz) against triangle t; writes barycentric (u, v) into `hit`.
    const hit = [0, 0]
    const intersects = (t: number, dx: number, dy: number, dz: number, slack: number): boolean => {
      const a = I[t * 3] * 3
      const b = I[t * 3 + 1] * 3
      const c = I[t * 3 + 2] * 3
      const e1x = P[b] - P[a]
      const e1y = P[b + 1] - P[a + 1]
      const e1z = P[b + 2] - P[a + 2]
      const e2x = P[c] - P[a]
      const e2y = P[c + 1] - P[a + 1]
      const e2z = P[c + 2] - P[a + 2]
      const px = dy * e2z - dz * e2y
      const py = dz * e2x - dx * e2z
      const pz = dx * e2y - dy * e2x
      const det = e1x * px + e1y * py + e1z * pz
      if (Math.abs(det) < 1e-12) return false
      const tx = -P[a]
      const ty = -P[a + 1]
      const tz = -P[a + 2]
      const u = (tx * px + ty * py + tz * pz) / det
      if (u < -slack || u > 1 + slack) return false
      const qx = ty * e1z - tz * e1y
      const qy = tz * e1x - tx * e1z
      const qz = tx * e1y - ty * e1x
      const v = (dx * qx + dy * qy + dz * qz) / det
      if (v < -slack || u + v > 1 + slack) return false
      if ((e2x * qx + e2y * qy + e2z * qz) / det <= 0) return false
      hit[0] = u
      hit[1] = v
      return true
    }

    // Register every triangle with the grid cells it may cover (generously; the ray test is exact).
    const PAD = (3 * Math.PI) / 180
    for (let t = 0; t < triangles; t++) {
      let latMin = Infinity
      let latMax = -Infinity
      let lonMin = Infinity
      let lonMax = -Infinity
      for (let k = 0; k < 3; k++) {
        const at = I[t * 3 + k] * 3
        const r = Math.hypot(P[at], P[at + 1], P[at + 2])
        const lat = Math.asin(P[at + 1] / r)
        const lon = Math.atan2(-P[at], -P[at + 2])
        latMin = Math.min(latMin, lat)
        latMax = Math.max(latMax, lat)
        lonMin = Math.min(lonMin, lon)
        lonMax = Math.max(lonMax, lon)
      }
      const north = intersects(t, 0, 1, 0, 1e-6)
      const south = intersects(t, 0, -1, 0, 1e-6)
      latMin = south ? -Math.PI / 2 : latMin - PAD
      latMax = north ? Math.PI / 2 : latMax + PAD
      const steep = Math.max(Math.abs(latMin), Math.abs(latMax)) > (80 * Math.PI) / 180
      const everyLongitude = north || south || steep || lonMax - lonMin > Math.PI // the last: straddles ±180°
      const lonPad = PAD / Math.cos(Math.min(Math.max(Math.abs(latMin), Math.abs(latMax)), 1.4))
      const row0 = Math.max(0, Math.floor(((Math.PI / 2 - latMax) / Math.PI) * gridH))
      const row1 = Math.min(gridH - 1, Math.floor(((Math.PI / 2 - latMin) / Math.PI) * gridH))
      const col0 = everyLongitude ? 0 : Math.max(0, Math.floor(((lonMin - lonPad + Math.PI) / (2 * Math.PI)) * gridW))
      const col1 = everyLongitude ? gridW - 1 : Math.min(gridW - 1, Math.floor(((lonMax + lonPad + Math.PI) / (2 * Math.PI)) * gridW))
      for (let row = row0; row <= row1; row++) for (let col = col0; col <= col1; col++) buckets[row * gridW + col].push(t)
    }

    canvas = new OffscreenCanvas(w, h)
    const context = canvas.getContext('2d')!
    const image = context.createImageData(w, h)
    const colour = [0, 0, 0]
    const lookUp = (t: number) => {
      const a = I[t * 3] * 2
      const b = I[t * 3 + 1] * 2
      const c = I[t * 3 + 2] * 2
      const k = 1 - hit[0] - hit[1]
      const x = Math.min(sw - 1.001, Math.max(0, (k * T[a] + hit[0] * T[b] + hit[1] * T[c]) * sw - 0.5))
      const y = Math.min(sh - 1.001, Math.max(0, (k * T[a + 1] + hit[0] * T[b + 1] + hit[1] * T[c + 1]) * sh - 0.5))
      const x0 = Math.floor(x)
      const y0 = Math.floor(y)
      const fx = x - x0
      const fy = y - y0
      const at = (y0 * sw + x0) * 4
      for (let ch = 0; ch < 3; ch++) {
        const top = source[at + ch] * (1 - fx) + source[at + 4 + ch] * fx
        const bottom = source[at + sw * 4 + ch] * (1 - fx) + source[at + sw * 4 + 4 + ch] * fx
        colour[ch] = top * (1 - fy) + bottom * fy
      }
    }
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const bucket = buckets[Math.floor(j / CELL) * gridW + Math.floor(i / CELL)]
        let r = 0
        let g = 0
        let b = 0
        // 2×2 samples per pixel: the source is usually sharper than the output.
        for (let s = 0; s < 4; s++) {
          const lon = ((i + 0.25 + 0.5 * (s & 1)) / w) * 2 * Math.PI - Math.PI
          const lat = Math.PI / 2 - ((j + 0.25 + 0.5 * (s >> 1)) / h) * Math.PI
          const dx = -Math.cos(lat) * Math.sin(lon)
          const dy = Math.sin(lat)
          const dz = -Math.cos(lat) * Math.cos(lon)
          let found = -1
          for (let k = 0; k < bucket.length && found < 0; k++) if (intersects(bucket[k], dx, dy, dz, 1e-6)) found = bucket[k]
          // A ray can slip between two triangles; accept a near miss rather than leave a hole.
          for (let k = 0; k < bucket.length && found < 0; k++) if (intersects(bucket[k], dx, dy, dz, 2e-2)) found = bucket[k]
          if (found >= 0) lookUp(found) // otherwise keep the previous sample's colour
          r += colour[0]
          g += colour[1]
          b += colour[2]
        }
        const at = (j * w + i) * 4
        image.data[at] = r / 4
        image.data[at + 1] = g / 4
        image.data[at + 2] = b / 4
        image.data[at + 3] = 255
      }
    }
    context.putImageData(image, 0, 0)
  } else {
    const scale = Math.min(1, job.width / full.width)
    w = Math.round(full.width * scale)
    h = Math.max(1, Math.round(full.height * scale))
    canvas = new OffscreenCanvas(w, h)
    canvas.getContext('2d')!.drawImage(scale < 1 ? await createImageBitmap(full, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' }) : full, 0, 0)
  }

  const blob = await canvas.convertToBlob({ type: `image/${job.type}`, quality: 0.86 })
  const out = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < out.length; i += 0x8000) binary += String.fromCharCode(...out.subarray(i, i + 0x8000))
  return { base64: btoa(binary), width: w, height: h }
}

async function launch(): Promise<Browser> {
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launch({ channel, headless: true })
    } catch {
      /* try the next installed browser */
    }
  }
  throw new Error('Chrome ya da Edge bulunamadı (dokuları yeniden kodlamak için gerekli).')
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const browser = await launch()
  try {
    for (const source of SOURCES) {
      const file = await download(source.url)
      let encoded = file
      let mesh: Mesh | null = null
      if (source.glb) {
        const { gltf, bin } = parseGlb(file)
        encoded = imageOf(gltf, bin, source.glb.material, source.glb.slot)
        if (source.glb.unwrap) mesh = meshOf(gltf, bin, source.glb.material)
      }
      const page = await browser.newPage()
      try {
        // tsx wraps named functions in a __name() helper that does not exist inside the page.
        await page.evaluate('globalThis.__name = (fn) => fn')
        const job: Job = { base64: encoded.toString('base64'), width: source.width, type: source.format, mesh }
        const out = await page.evaluate(convertInPage, job)
        const name = `${source.id}.${source.format === 'jpeg' ? 'jpg' : 'png'}`
        const data = Buffer.from(out.base64, 'base64')
        writeFileSync(join(outDir, name), data)
        console.log(`  ${name.padEnd(22)} ${out.width}×${out.height}  ${(data.length / 1024).toFixed(0)} KB`)
      } finally {
        await page.close()
      }
    }
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error('\n✖ Dokular hazırlanamadı:\n', error)
  process.exit(1)
})
