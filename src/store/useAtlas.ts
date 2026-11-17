/**
 * Single shared store: what is selected, which view is active, filters, results and UI
 * preferences. The 3D scene and the data browser both read and write here, which is what
 * keeps them linked in both directions.
 */

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import {
  EMPTY_PLANET_FILTER,
  EMPTY_STAR_FILTER,
  type PlanetFilter,
  type PlanetSortKey,
  type Sort,
  type StarFilter,
  type StarSortKey,
} from '../browser/filterEngine'
import type { Atlas } from '../data/atlas'
import { discoveryOf } from '../lib/discovery'
import { prefersReducedMotion } from '../lib/motion'
import { readJson, writeJson } from '../lib/storage'

/** The star map, one planetary system, or the sky as seen from a star. */
export type Mode = 'map' | 'system' | 'sky'
/** The two timelines share one strip along the bottom edge, so only one can be open. */
export type Strip = 'discovery' | 'time'
export type Tab = 'stars' | 'planets'
export type Unit = 'ly' | 'pc'
export type FlightKind = 'select' | 'dive' | 'home'

/** A request for the camera to travel somewhere; `nonce` makes repeated requests distinct. */
export interface FlightCommand {
  nonce: number
  kind: FlightKind
  star: number
}

interface Prefs {
  unit: Unit
  showLabels: boolean
  showMilkyWay: boolean
  showConstellations: boolean
  mirrorFilter: boolean
}

const DEFAULT_PREFS: Prefs = { unit: 'ly', showLabels: true, showMilkyWay: true, showConstellations: true, mirrorFilter: true }

/** Duration of the fade that hides the switch between the map and a system, ms. */
export const VEIL_MS = 380

/** How far the time machine reaches either way, years. */
export const EPOCH_LIMIT = 1_000_000

export interface AtlasState extends Prefs {
  phase: 'loading' | 'ready' | 'error'
  progress: number
  error: string | null
  atlas: Atlas | null

  mode: Mode
  /** Full-screen fade used while switching between the map and a system. */
  veil: boolean
  selectedStar: number | null
  /** The star whose sky is on screen in sky mode. The selection may then be another star, picked in that sky. */
  skyStar: number | null
  systemIndex: number | null
  selectedPlanet: number | null
  hoverStar: number | null
  hoverPlanet: number | null
  flight: FlightCommand | null

  tab: Tab
  starFilter: StarFilter
  planetFilter: PlanetFilter
  starSort: Sort<StarSortKey>
  planetSort: Sort<PlanetSortKey>
  /** Row indices matching the current filter; null until the first answer arrives. */
  starRows: Int32Array | null
  planetRows: Int32Array | null
  /** Keys of favourite stars and planets (see starKey / planetKey). */
  favorites: string[]

  browserOpen: boolean
  browserWide: boolean
  filtersOpen: boolean
  aboutOpen: boolean
  /** Simulated days per real second in the system view. */
  simSpeed: number
  simPaused: boolean
  toast: { text: string; nonce: number } | null

  /** Which timeline strip is open, if any. */
  strip: Strip | null
  /** Discovery timeline: the map shows what was known by the end of this year. Null while the strip is closed. */
  discoveryYear: number | null
  discoveryPlaying: boolean
  /** Time machine: years from today (negative = past). Always 0 while its strip is closed. */
  epoch: number
  /** Time machine playback: -1 backwards, 1 forwards, 0 paused. */
  epochPlay: -1 | 0 | 1
  /** Time machine playback speed, years per second. */
  epochSpeed: number

  setProgress: (fraction: number) => void
  setReady: (atlas: Atlas) => void
  setError: (message: string) => void
  selectStar: (star: number | null, options?: { fly?: boolean }) => void
  openSystem: (system: number, planet?: number | null) => void
  exitSystem: () => void
  /** Stand at a star and look out. Also how one moves from star to star while in sky mode. */
  openSky: (star: number) => void
  exitSky: () => void
  /** Select a star seen in the sky without leaving the star we are standing at. */
  pickSkyStar: (star: number | null) => void
  selectPlanet: (planet: number | null) => void
  diveArrived: (nonce: number) => void
  goHome: () => void
  setHoverStar: (star: number | null) => void
  setHoverPlanet: (planet: number | null) => void
  setTab: (tab: Tab) => void
  patchStarFilter: (patch: Partial<StarFilter>) => void
  patchPlanetFilter: (patch: Partial<PlanetFilter>) => void
  resetFilter: (tab: Tab) => void
  setStarSort: (sort: Sort<StarSortKey>) => void
  setPlanetSort: (sort: Sort<PlanetSortKey>) => void
  setRows: (table: Tab, rows: Int32Array) => void
  toggleFavorite: (key: string) => void
  setPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void
  setUi: (patch: Partial<Pick<AtlasState, 'browserOpen' | 'browserWide' | 'filtersOpen' | 'aboutOpen' | 'simSpeed' | 'simPaused'>>) => void
  showToast: (text: string) => void
  /** Open one timeline strip (closing the other) or, with null, close whichever is open. */
  setStrip: (strip: Strip | null) => void
  setDiscoveryYear: (year: number) => void
  setDiscoveryPlaying: (playing: boolean) => void
  setEpoch: (years: number) => void
  setEpochPlay: (direction: -1 | 0 | 1, speed?: number) => void
}

// Transition bookkeeping lives outside the store: it is plumbing, not state anyone renders.
let transition = 0
let nonce = 0
let pendingDive: { nonce: number; run: () => void } | null = null

const persistPrefs = (s: Prefs) =>
  writeJson('prefs', {
    unit: s.unit,
    showLabels: s.showLabels,
    showMilkyWay: s.showMilkyWay,
    showConstellations: s.showConstellations,
    mirrorFilter: s.mirrorFilter,
  })

export const useAtlas = create<AtlasState>()(
  subscribeWithSelector((set, get) => {
    /** Abort any dive/surface in progress and make sure the veil does not stay down. */
    const cancelTransition = (): number => {
      pendingDive = null
      if (get().veil) set({ veil: false })
      return ++transition
    }

    /** Fade out, apply `change`, fade back in — unless another transition started meanwhile. */
    const throughVeil = (token: number, change: () => void) => {
      set({ veil: true })
      window.setTimeout(() => {
        if (token !== transition) return
        change()
        // Give the scene a frame in its new state before revealing it.
        window.setTimeout(() => {
          if (token === transition) set({ veil: false })
        }, 80)
      }, VEIL_MS)
    }

    return {
      ...DEFAULT_PREFS,
      ...readJson<Partial<Prefs>>('prefs', {}),
      phase: 'loading',
      progress: 0,
      error: null,
      atlas: null,

      mode: 'map',
      veil: false,
      selectedStar: null,
      skyStar: null,
      systemIndex: null,
      selectedPlanet: null,
      hoverStar: null,
      hoverPlanet: null,
      flight: null,

      strip: null,
      discoveryYear: null,
      discoveryPlaying: false,
      epoch: 0,
      epochPlay: 0,
      epochSpeed: 10_000,

      tab: 'stars',
      starFilter: EMPTY_STAR_FILTER,
      planetFilter: EMPTY_PLANET_FILTER,
      starSort: { key: 'default', desc: false },
      planetSort: { key: 'default', desc: false },
      starRows: null,
      planetRows: null,
      favorites: readJson<string[]>('favorites', []).filter((k) => typeof k === 'string'),

      browserOpen: typeof window === 'undefined' || window.innerWidth >= 1100,
      browserWide: false,
      filtersOpen: false,
      aboutOpen: false,
      simSpeed: 1,
      simPaused: false,
      toast: null,

      setProgress: (fraction) => set({ progress: fraction }),
      setReady: (atlas) => set({ atlas, phase: 'ready', progress: 1 }),
      setError: (message) => set({ phase: 'error', error: message }),

      selectStar: (star, options) => {
        const token = cancelTransition()
        const fly = options?.fly === true && star !== null
        const apply = () =>
          set({
            mode: 'map',
            skyStar: null,
            systemIndex: null,
            selectedPlanet: null,
            hoverPlanet: null,
            selectedStar: star,
            flight: fly ? { nonce: ++nonce, kind: 'select', star } : get().flight,
          })
        if (get().mode !== 'map') throughVeil(token, apply)
        else apply()
      },

      openSystem: (system, planet = null) => {
        const state = get()
        const sys = state.atlas?.systems[system]
        if (!sys) return
        if (state.mode === 'system' && state.systemIndex === system) {
          set({ selectedPlanet: planet })
          return
        }
        const token = cancelTransition()
        const enter = () =>
          throughVeil(token, () =>
            set({
              mode: 'system',
              skyStar: null,
              systemIndex: system,
              selectedPlanet: planet,
              selectedStar: sys.star >= 0 ? sys.star : get().selectedStar,
              hoverStar: null,
              hoverPlanet: null,
              simPaused: false,
            }),
          )
        // Not on the map, nowhere to fly to, or motion is unwelcome: just cross-fade.
        if (state.mode !== 'map' || sys.star < 0 || prefersReducedMotion()) {
          enter()
          return
        }
        // Otherwise approach the star first; the camera reports back through diveArrived().
        const id = ++nonce
        pendingDive = { nonce: id, run: enter }
        set({ selectedStar: sys.star, flight: { nonce: id, kind: 'dive', star: sys.star } })
        window.setTimeout(() => get().diveArrived(id), 4500) // safety net if no camera is listening
      },

      diveArrived: (id) => {
        if (pendingDive?.nonce !== id) return
        const run = pendingDive.run
        pendingDive = null
        run()
      },

      exitSystem: () => {
        if (get().mode !== 'system') return
        const token = cancelTransition()
        throughVeil(token, () => set({ mode: 'map', systemIndex: null, selectedPlanet: null, hoverPlanet: null }))
      },

      openSky: (star) => {
        const state = get()
        if (!state.atlas || !(star >= 0 && star < state.atlas.count)) return
        if (state.mode === 'sky' && state.skyStar === star) {
          if (state.selectedStar !== star) set({ selectedStar: star })
          return
        }
        const token = cancelTransition()
        throughVeil(token, () =>
          set({
            mode: 'sky',
            skyStar: star,
            selectedStar: star,
            systemIndex: null,
            selectedPlanet: null,
            hoverStar: null,
            hoverPlanet: null,
          }),
        )
      },

      exitSky: () => {
        if (get().mode !== 'sky') return
        const token = cancelTransition()
        // Back on the map the star we were standing at is the selection again.
        throughVeil(token, () => set({ mode: 'map', selectedStar: get().skyStar, skyStar: null, hoverStar: null }))
      },

      pickSkyStar: (star) => {
        const state = get()
        if (state.mode !== 'sky') return
        set({ selectedStar: star ?? state.skyStar })
      },

      selectPlanet: (planet) => set({ selectedPlanet: planet }),

      goHome: () => {
        const token = cancelTransition()
        const apply = () =>
          set({
            mode: 'map',
            skyStar: null,
            systemIndex: null,
            selectedPlanet: null,
            hoverPlanet: null,
            selectedStar: null,
            flight: { nonce: ++nonce, kind: 'home', star: 0 },
          })
        if (get().mode !== 'map') throughVeil(token, apply)
        else apply()
      },

      setHoverStar: (star) => {
        if (get().hoverStar !== star) set({ hoverStar: star })
      },
      setHoverPlanet: (planet) => {
        if (get().hoverPlanet !== planet) set({ hoverPlanet: planet })
      },

      setTab: (tab) => set({ tab }),
      patchStarFilter: (patch) => set({ starFilter: { ...get().starFilter, ...patch } }),
      patchPlanetFilter: (patch) => set({ planetFilter: { ...get().planetFilter, ...patch } }),
      resetFilter: (tab) =>
        set(
          tab === 'stars'
            ? { starFilter: { ...EMPTY_STAR_FILTER, query: get().starFilter.query } }
            : { planetFilter: { ...EMPTY_PLANET_FILTER, query: get().planetFilter.query } },
        ),
      setStarSort: (sort) => set({ starSort: sort }),
      setPlanetSort: (sort) => set({ planetSort: sort }),
      setRows: (table, rows) => set(table === 'stars' ? { starRows: rows } : { planetRows: rows }),

      toggleFavorite: (key) => {
        const current = get().favorites
        const favorites = current.includes(key) ? current.filter((k) => k !== key) : [...current, key]
        set({ favorites })
        if (!writeJson('favorites', favorites)) {
          get().showToast('Favoriler bu tarayıcıda kaydedilemiyor; oturum boyunca geçerli.')
        }
      },

      setPref: (key, value) => {
        set({ [key]: value } as Pick<Prefs, typeof key>)
        persistPrefs(get())
      },

      setUi: (patch) => set(patch),
      showToast: (text) => set({ toast: { text, nonce: ++nonce } }),

      setStrip: (strip) => {
        const atlas = get().atlas
        // Each strip owns one dial; closing it (or opening the other) puts that dial back, so the
        // map never stays in a state whose control is no longer on screen.
        set({
          strip,
          discoveryYear: strip === 'discovery' && atlas ? discoveryOf(atlas).lastYear : null,
          discoveryPlaying: false,
          epoch: strip === 'time' ? get().epoch : 0,
          epochPlay: 0,
        })
      },

      setDiscoveryYear: (year) => {
        const state = get()
        if (state.strip !== 'discovery' || !state.atlas) return
        const stats = discoveryOf(state.atlas)
        const clamped = Math.min(stats.lastYear, Math.max(stats.firstYear, Math.round(year)))
        if (clamped !== state.discoveryYear) set({ discoveryYear: clamped })
      },
      setDiscoveryPlaying: (playing) => {
        if (get().strip === 'discovery' && get().discoveryPlaying !== playing) set({ discoveryPlaying: playing })
      },

      setEpoch: (years) => {
        if (get().strip !== 'time') return
        const clamped = Math.min(EPOCH_LIMIT, Math.max(-EPOCH_LIMIT, Number.isFinite(years) ? years : 0))
        if (clamped !== get().epoch) set({ epoch: clamped })
      },
      setEpochPlay: (direction, speed) => {
        if (get().strip !== 'time') return
        set({ epochPlay: direction, epochSpeed: speed ?? get().epochSpeed })
      },
    }
  }),
)
