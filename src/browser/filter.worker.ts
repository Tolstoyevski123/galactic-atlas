/**
 * Runs the filter engine off the main thread. The worker decodes its own copy of the
 * catalogue once, then answers queries with a transferable Int32Array of row indices.
 */

import { decodeAtlas } from '../data/atlas'
import type { StarsMeta, SystemsFile } from '../data/schema'
import {
  buildTables,
  queryPlanets,
  queryStars,
  type PlanetFilter,
  type PlanetSortKey,
  type Sort,
  type StarFilter,
  type StarSortKey,
  type Tables,
} from './filterEngine'

export type WorkerRequest =
  | { type: 'init'; bin: ArrayBuffer; meta: StarsMeta; systems: SystemsFile }
  | { type: 'stars'; id: number; filter: StarFilter; sort: Sort<StarSortKey>; favorites: Int32Array | null }
  | { type: 'planets'; id: number; filter: PlanetFilter; sort: Sort<PlanetSortKey>; favorites: Int32Array | null }

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'stars' | 'planets'; id: number; rows: Int32Array }
  | { type: 'error'; message: string }

let tables: Tables | null = null

const post = (message: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(message, { transfer })

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data
  try {
    if (msg.type === 'init') {
      tables = buildTables(decodeAtlas(msg.bin, msg.meta, msg.systems))
      post({ type: 'ready' })
      return
    }
    if (!tables) throw new Error('Filtre işçisi henüz hazır değil.')
    const rows =
      msg.type === 'stars'
        ? queryStars(tables.stars, msg.filter, msg.sort, msg.favorites)
        : queryPlanets(tables.planets, msg.filter, msg.sort, msg.favorites)
    post({ type: msg.type, id: msg.id, rows }, [rows.buffer])
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
