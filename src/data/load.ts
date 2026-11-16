import type { RawCatalog } from '../browser/filterClient'
import type { StarsMeta, SystemsFile } from './schema'

const dataUrl = (file: string): string => `${import.meta.env.BASE_URL}data/${file}`

async function fetchOk(file: string): Promise<Response> {
  const res = await fetch(dataUrl(file))
  if (!res.ok) throw new Error(`${file} yüklenemedi (HTTP ${res.status}).`)
  return res
}

/** Read a response body while reporting how many bytes have arrived. */
async function readWithProgress(res: Response, expected: number, onBytes: (loaded: number) => void): Promise<ArrayBuffer> {
  if (!res.body) return res.arrayBuffer()
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    onBytes(Math.min(loaded, expected))
  }
  const out = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out.buffer
}

/**
 * Fetch the three bundled catalogue files (same origin, generated at build time).
 * `onProgress` receives 0..1, weighted by the size of the star table.
 */
export async function loadCatalog(onProgress: (fraction: number) => void): Promise<RawCatalog> {
  const meta = (await (await fetchOk('stars.meta.json')).json()) as StarsMeta
  onProgress(0.05)
  const systemsPromise = fetchOk('systems.json').then((r) => r.json() as Promise<SystemsFile>)
  const binResponse = await fetchOk('stars.bin')
  const bin = await readWithProgress(binResponse, meta.byteLength, (loaded) =>
    onProgress(0.05 + 0.85 * (loaded / meta.byteLength)),
  )
  const systems = await systemsPromise
  onProgress(1)
  return { bin, meta, systems }
}
