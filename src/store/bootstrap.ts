/**
 * Start-up wiring: load the catalogue, start the filter worker, keep query results in the
 * store, and mirror the current selection into the URL hash (and back).
 */

import { FilterClient } from '../browser/filterClient'
import { buildKeyLookup, decodeAtlas, planetKey, starKey, systemKey, type Atlas, type KeyLookup } from '../data/atlas'
import { loadCatalog } from '../data/load'
import { useAtlas, type AtlasState } from './useAtlas'

let started = false
let lookup: KeyLookup | null = null
let disposers: Array<() => void> = []

/** Key → row lookups; available once the catalogue is ready. */
export function keyLookup(): KeyLookup | null {
  return lookup
}

/** Row indices of the favourites belonging to one table. */
function favoriteRows(atlas: Atlas, favorites: string[], table: 'stars' | 'planets'): Int32Array {
  if (!lookup) return new Int32Array(0)
  const rows: number[] = []
  for (const key of favorites) {
    if (table === 'stars' && key.startsWith('star-')) {
      const i = lookup.star(key)
      if (i >= 0) rows.push(i)
    } else if (table === 'planets' && key.startsWith('planet-')) {
      const i = lookup.planet(key)
      if (i >= 0 && i < atlas.exoPlanetCount) rows.push(i)
    }
  }
  return Int32Array.from(rows)
}

/** The hash that represents the current view: a planet, a system, a star, a star's sky, or nothing. */
export function stateToHash(s: AtlasState): string {
  const atlas = s.atlas
  if (!atlas) return ''
  if (s.mode === 'system' && s.systemIndex !== null) {
    if (s.selectedPlanet !== null) return `#${planetKey(atlas.planets[s.selectedPlanet])}`
    return `#${systemKey(atlas.systems[s.systemIndex])}`
  }
  if (s.mode === 'sky' && s.skyStar !== null) return `#sky-${starKey(atlas, s.skyStar)}`
  if (s.selectedStar !== null) return `#${starKey(atlas, s.selectedStar)}`
  return ''
}

/** Apply a URL hash to the store. Returns false when it does not name anything we know. */
export function applyHash(hash: string): boolean {
  const s = useAtlas.getState()
  const atlas = s.atlas
  if (!atlas || !lookup) return false
  const key = decodeURIComponent(hash.replace(/^#/, ''))
  if (key.startsWith('planet-')) {
    const p = lookup.planet(key)
    if (p < 0) return false
    s.openSystem(atlas.planets[p].system, p)
    return true
  }
  if (key.startsWith('system-')) {
    const si = lookup.system(key)
    if (si < 0) return false
    s.openSystem(si)
    return true
  }
  if (key.startsWith('sky-')) {
    const i = lookup.star(key.slice(4))
    if (i < 0) return false
    s.openSky(i)
    return true
  }
  if (key.startsWith('star-')) {
    const i = lookup.star(key)
    if (i < 0) return false
    s.selectStar(i, { fly: true })
    return true
  }
  return false
}

function wire(client: FilterClient, atlas: Atlas): void {
  let starTimer = 0
  let planetTimer = 0
  const queryStars = () => {
    const s = useAtlas.getState()
    client.queryStars(s.starFilter, s.starSort, s.starFilter.favoritesOnly ? favoriteRows(atlas, s.favorites, 'stars') : null)
  }
  const queryPlanets = () => {
    const s = useAtlas.getState()
    client.queryPlanets(
      s.planetFilter,
      s.planetSort,
      s.planetFilter.favoritesOnly ? favoriteRows(atlas, s.favorites, 'planets') : null,
    )
  }
  // A short debounce keeps typing smooth; sorting and toggles still feel instant.
  const scheduleStars = () => {
    window.clearTimeout(starTimer)
    starTimer = window.setTimeout(queryStars, 60)
  }
  const schedulePlanets = () => {
    window.clearTimeout(planetTimer)
    planetTimer = window.setTimeout(queryPlanets, 60)
  }

  disposers.push(
    useAtlas.subscribe((s) => s.starFilter, scheduleStars),
    useAtlas.subscribe((s) => s.starSort, queryStars),
    useAtlas.subscribe((s) => s.planetFilter, schedulePlanets),
    useAtlas.subscribe((s) => s.planetSort, queryPlanets),
    useAtlas.subscribe(
      (s) => s.favorites,
      () => {
        const s = useAtlas.getState()
        if (s.starFilter.favoritesOnly) queryStars()
        if (s.planetFilter.favoritesOnly) queryPlanets()
      },
    ),
  )
  queryStars()
  queryPlanets()

  // Selection → URL. replaceState keeps the back button from filling up with every click.
  const syncHash = () => {
    const wanted = stateToHash(useAtlas.getState())
    if (wanted === window.location.hash) return
    try {
      window.history.replaceState(null, '', wanted || window.location.pathname + window.location.search)
    } catch {
      /* sandboxed frames may forbid history changes; sharing then simply uses the copy button */
    }
  }
  disposers.push(
    useAtlas.subscribe((s) => s.mode, syncHash),
    useAtlas.subscribe((s) => s.selectedStar, syncHash),
    useAtlas.subscribe((s) => s.skyStar, syncHash),
    useAtlas.subscribe((s) => s.systemIndex, syncHash),
    useAtlas.subscribe((s) => s.selectedPlanet, syncHash),
  )

  // URL → selection (pasted links, manual edits, back/forward).
  const onHashChange = () => {
    if (window.location.hash === stateToHash(useAtlas.getState())) return
    if (window.location.hash.length > 1 && !applyHash(window.location.hash)) {
      useAtlas.getState().showToast('Bağlantıdaki nesne katalogda bulunamadı.')
    }
  }
  window.addEventListener('hashchange', onHashChange)
  disposers.push(() => window.removeEventListener('hashchange', onHashChange))
  disposers.push(() => client.dispose())
}

async function load(): Promise<void> {
  const store = useAtlas.getState()
  try {
    const raw = await loadCatalog(store.setProgress)
    const atlas = decodeAtlas(raw.bin, raw.meta, raw.systems)
    lookup = buildKeyLookup(atlas)
    const client = new FilterClient(raw, atlas, (table, rows) => useAtlas.getState().setRows(table, rows))
    useAtlas.getState().setReady(atlas)
    wire(client, atlas)
    if (window.location.hash.length > 1 && !applyHash(window.location.hash)) {
      useAtlas.getState().showToast('Bağlantıdaki nesne katalogda bulunamadı.')
    }
  } catch (err) {
    console.error(err)
    useAtlas.getState().setError(err instanceof Error ? err.message : String(err))
  }
}

/** Load everything once; safe to call from an effect that React runs twice in development. */
export function startAtlas(): void {
  if (started) return
  started = true
  void load()
}

/** Try again after a failed load. */
export function retryAtlas(): void {
  for (const dispose of disposers) dispose()
  disposers = []
  useAtlas.setState({ phase: 'loading', progress: 0, error: null })
  void load()
}

/** True when the page was opened with a link to a specific object (skips the intro fly-in). */
export function openedWithDeepLink(): boolean {
  return typeof window !== 'undefined' && /^#(star|system|planet|sky)-/.test(window.location.hash)
}
