/**
 * Main-thread side of the filter worker. Only the latest query per table is delivered; stale
 * answers are dropped. If the worker cannot start, the same engine runs synchronously instead.
 */

import type { Atlas } from '../data/atlas'
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
import type { WorkerRequest, WorkerResponse } from './filter.worker'

type Table = 'stars' | 'planets'

export interface RawCatalog {
  bin: ArrayBuffer
  meta: StarsMeta
  systems: SystemsFile
}

export class FilterClient {
  private worker: Worker | null = null
  private ready = false
  private fallback: Tables | null = null
  private nextId = 1
  private latest: Record<Table, number> = { stars: 0, planets: 0 }
  /** Most recent request per table; replayed when the worker becomes ready or is replaced. */
  private last: Partial<Record<Table, WorkerRequest>> = {}

  constructor(
    raw: RawCatalog,
    private readonly atlas: Atlas,
    private readonly onRows: (table: Table, rows: Int32Array) => void,
  ) {
    try {
      this.worker = new Worker(new URL('./filter.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.receive(event.data)
      this.worker.onerror = () => this.useFallback()
      // The worker gets its own copy of the binary so the main thread keeps its typed arrays.
      const copy = raw.bin.slice(0)
      const init: WorkerRequest = { type: 'init', bin: copy, meta: raw.meta, systems: raw.systems }
      this.worker.postMessage(init, [copy])
    } catch {
      this.useFallback()
    }
  }

  private receive(msg: WorkerResponse): void {
    if (msg.type === 'ready') {
      this.ready = true
      for (const request of Object.values(this.last)) this.worker?.postMessage(request)
    } else if (msg.type === 'error') {
      console.error('[filter worker]', msg.message)
      this.useFallback()
    } else if (msg.id === this.latest[msg.type]) {
      this.onRows(msg.type, msg.rows)
    }
  }

  /** Switch to in-thread filtering and re-answer the latest request of each table. */
  private useFallback(): void {
    if (this.fallback) return
    this.worker?.terminate()
    this.worker = null
    this.fallback = buildTables(this.atlas)
    for (const request of Object.values(this.last)) this.runLocally(request)
  }

  private runLocally(request: WorkerRequest): void {
    if (!this.fallback || request.type === 'init') return
    if (request.type === 'stars') {
      this.onRows('stars', queryStars(this.fallback.stars, request.filter, request.sort, request.favorites))
    } else {
      this.onRows('planets', queryPlanets(this.fallback.planets, request.filter, request.sort, request.favorites))
    }
  }

  private send(table: Table, request: WorkerRequest): void {
    this.last[table] = request
    if (this.fallback) this.runLocally(request)
    else if (this.ready && this.worker) this.worker.postMessage(request)
    // otherwise it is sent as soon as the worker reports ready
  }

  queryStars(filter: StarFilter, sort: Sort<StarSortKey>, favorites: Int32Array | null): void {
    const id = (this.latest.stars = this.nextId++)
    this.send('stars', { type: 'stars', id, filter, sort, favorites })
  }

  queryPlanets(filter: PlanetFilter, sort: Sort<PlanetSortKey>, favorites: Int32Array | null): void {
    const id = (this.latest.planets = this.nextId++)
    this.send('planets', { type: 'planets', id, filter, sort, favorites })
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
  }
}
