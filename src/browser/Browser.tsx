import { useEffect, useMemo, useRef } from 'react'
import type { Atlas } from '../data/atlas'
import { HZ_NONE } from '../data/schema'
import { count } from '../lib/format'
import { useAtlas, type Tab } from '../store/useAtlas'
import { Chip, cx, IconButton } from '../ui/controls'
import { CloseIcon, CollapseIcon, ExpandIcon, EyeIcon, ResetIcon, SearchIcon, SlidersIcon } from '../ui/icons'
import { planetColumns, starColumns } from './columns'
import { DataTable } from './DataTable'
import {
  countPlanetFilters,
  countStarFilters,
  EMPTY_PLANET_FILTER,
  EMPTY_STAR_FILTER,
  type PlanetFilter,
  type PlanetSortKey,
  type StarFilter,
  type StarSortKey,
} from './filterEngine'
import { PLANET_PRESETS, PlanetFilters, STAR_PRESETS, StarFilters } from './Filters'

/** Compare two filters ignoring the free-text query (used to light up the active preset). */
function sameCriteria(a: object, b: object): boolean {
  return JSON.stringify({ ...a, query: '' }) === JSON.stringify({ ...b, query: '' })
}

function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="px-6 py-12 text-center">
      <div className="mx-auto mb-3 grid size-11 place-items-center rounded-full border border-line bg-white/[0.03] text-faint">
        <SearchIcon size={18} />
      </div>
      <p className="font-display text-[14px] font-medium text-ink">Eşleşen kayıt yok</p>
      <p className="mx-auto mt-1 max-w-[260px] text-[12.5px] text-muted">
        Aramayı kısaltmayı ya da filtrelerden birini gevşetmeyi deneyin.
      </p>
      <button
        type="button"
        onClick={onReset}
        className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-[12.5px] font-medium text-ink transition-colors hover:bg-white/8"
      >
        <ResetIcon size={13} /> Filtreleri temizle
      </button>
    </div>
  )
}

function TabButton({ tab, active, label, shown, total }: { tab: Tab; active: boolean; label: string; shown: number | null; total: number }) {
  const setTab = useAtlas((s) => s.setTab)
  const filtered = shown !== null && shown < total
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => setTab(tab)}
      className={cx(
        'relative flex-1 rounded-lg px-3 py-1.5 text-left transition-colors duration-150',
        active ? 'bg-white/8 text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.07)]' : 'text-muted hover:bg-white/[0.04] hover:text-ink',
      )}
    >
      <div className="font-display text-[13.5px] font-semibold">{label}</div>
      <div className={cx('text-[11px] tabular-nums', filtered ? 'text-accent' : 'text-faint')}>
        {shown === null ? '…' : filtered ? `${count(shown)} / ${count(total)}` : count(total)}
      </div>
    </button>
  )
}

/** The right-hand panel: search, filter and sort the catalogue; every row is linked to the 3D view. */
export function Browser({ atlas }: { atlas: Atlas }) {
  const tab = useAtlas((s) => s.tab)
  const unit = useAtlas((s) => s.unit)
  const wide = useAtlas((s) => s.browserWide)
  const filtersOpen = useAtlas((s) => s.filtersOpen)
  const mirror = useAtlas((s) => s.mirrorFilter)
  const starFilter = useAtlas((s) => s.starFilter)
  const planetFilter = useAtlas((s) => s.planetFilter)
  const starSort = useAtlas((s) => s.starSort)
  const planetSort = useAtlas((s) => s.planetSort)
  const starRows = useAtlas((s) => s.starRows)
  const planetRows = useAtlas((s) => s.planetRows)
  const selectedStar = useAtlas((s) => s.selectedStar)
  const selectedPlanet = useAtlas((s) => s.selectedPlanet)
  const store = useAtlas.getState

  const stars = useMemo(() => starColumns(atlas, unit), [atlas, unit])
  const planets = useMemo(() => planetColumns(atlas, unit), [atlas, unit])

  const isStars = tab === 'stars'
  const query = isStars ? starFilter.query : planetFilter.query
  const activeCount = isStars ? countStarFilters(starFilter) : countPlanetFilters(planetFilter)
  const setQuery = (text: string) => (isStars ? store().patchStarFilter({ query: text }) : store().patchPlanetFilter({ query: text }))
  const resetAll = () => {
    store().resetFilter(tab)
    setQuery('')
  }

  // "/" jumps to the search box from anywhere.
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return
      event.preventDefault()
      searchRef.current?.focus()
      searchRef.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const applyStarPreset = (preset: Partial<StarFilter>) => {
    const next = { ...EMPTY_STAR_FILTER, ...preset }
    store().patchStarFilter(sameCriteria(starFilter, next) ? { ...EMPTY_STAR_FILTER, query: starFilter.query } : { ...next, query: starFilter.query })
  }
  const applyPlanetPreset = (preset: Partial<PlanetFilter>) => {
    const next = { ...EMPTY_PLANET_FILTER, ...preset }
    store().patchPlanetFilter(
      sameCriteria(planetFilter, next) ? { ...EMPTY_PLANET_FILTER, query: planetFilter.query } : { ...next, query: planetFilter.query },
    )
  }

  return (
    <aside
      aria-label="Veri tarayıcısı"
      className={cx(
        'glass pointer-events-auto absolute top-3 right-3 bottom-3 z-30 flex animate-slide-left flex-col rounded-[18px] transition-[width] duration-300 ease-out-soft',
        wide ? 'w-[min(880px,calc(100vw-24px))]' : 'w-[min(468px,calc(100vw-24px))]',
      )}
    >
      {/* Tabs */}
      <div className="flex items-center gap-1.5 p-2 pb-0">
        <div role="tablist" aria-label="Katalog" className="flex min-w-0 flex-1 gap-1">
          <TabButton tab="stars" active={isStars} label="Yıldızlar" shown={starRows ? starRows.length : null} total={atlas.count} />
          <TabButton tab="planets" active={!isStars} label="Gezegenler" shown={planetRows ? planetRows.length : null} total={atlas.exoPlanetCount} />
        </div>
        <div className="flex flex-col gap-0.5 sm:flex-row">
          <span className="hidden lg:block">
            <IconButton label={wide ? 'Paneli daralt' : 'Paneli genişlet'} tip="bottom" size="sm" onClick={() => store().setUi({ browserWide: !wide })}>
              {wide ? <CollapseIcon size={15} /> : <ExpandIcon size={15} />}
            </IconButton>
          </span>
          <IconButton label="Paneli kapat" tip="bottom" size="sm" onClick={() => store().setUi({ browserOpen: false })}>
            <CloseIcon size={15} />
          </IconButton>
        </div>
      </div>

      {/* Search + filter toggle */}
      <div className="flex items-center gap-1.5 px-2 pt-2">
        <div className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint">
            <SearchIcon size={15} />
          </span>
          <input
            ref={searchRef}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            aria-label={isStars ? 'Yıldız ara' : 'Gezegen ara'}
            placeholder={isStars ? 'Yıldız ara: Sirius, HD 209458, alfa Cen…' : 'Gezegen ya da yıldız ara: TRAPPIST-1, 51 Peg…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                if (query) setQuery('')
                else e.currentTarget.blur()
              }
            }}
            className="h-9 w-full rounded-lg border border-line bg-black/30 pr-8 pl-8 text-[13px] text-ink placeholder:text-faint transition-colors hover:border-line-strong focus:border-accent/60 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              aria-label="Aramayı temizle"
              onClick={() => {
                setQuery('')
                searchRef.current?.focus()
              }}
              className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-md text-faint transition-colors hover:bg-white/8 hover:text-ink"
            >
              <CloseIcon size={13} />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border border-line px-1.5 text-[10.5px] leading-[16px] text-faint sm:block">/</kbd>
          )}
        </div>
        <button
          type="button"
          aria-expanded={filtersOpen}
          aria-controls="browser-filters"
          onClick={() => store().setUi({ filtersOpen: !filtersOpen })}
          className={cx(
            'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-medium transition-colors duration-150',
            filtersOpen || activeCount > 0 ? 'border-accent/45 bg-accent/12 text-accent' : 'border-line text-muted hover:border-line-strong hover:text-ink',
          )}
        >
          <SlidersIcon size={15} />
          Filtreler
          {activeCount > 0 && (
            <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[10.5px] font-bold text-[#06121f]">{activeCount}</span>
          )}
        </button>
      </div>

      {/* Presets */}
      <div className="flex items-center gap-1.5 overflow-x-auto px-2 pt-2 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {isStars
          ? STAR_PRESETS.map((preset) => (
              <Chip
                key={preset.label}
                title={preset.title}
                tone={preset.filter.hostsOnly ? 'gold' : 'accent'}
                active={sameCriteria(starFilter, { ...EMPTY_STAR_FILTER, ...preset.filter })}
                onClick={() => applyStarPreset(preset.filter)}
              >
                <span className="whitespace-nowrap">{preset.label}</span>
              </Chip>
            ))
          : PLANET_PRESETS.map((preset) => (
              <Chip
                key={preset.label}
                title={preset.title}
                tone={preset.filter.hz ? 'hz' : 'accent'}
                active={sameCriteria(planetFilter, { ...EMPTY_PLANET_FILTER, ...preset.filter })}
                onClick={() => applyPlanetPreset(preset.filter)}
              >
                <span className="whitespace-nowrap">{preset.label}</span>
              </Chip>
            ))}
      </div>

      {/* Filters (collapsible) */}
      <div
        id="browser-filters"
        className={cx('grid transition-[grid-template-rows] duration-300 ease-out-soft', filtersOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}
      >
        <div className="min-h-0 overflow-hidden" inert={!filtersOpen}>
          <div className="mx-2 mt-2 max-h-[min(46vh,430px)] overflow-y-auto rounded-xl border border-line bg-black/20 p-3">
            {isStars ? <StarFilters atlas={atlas} /> : <PlanetFilters atlas={atlas} />}
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-2.5">
              <button
                type="button"
                role="switch"
                aria-checked={mirror}
                onClick={() => store().setPref('mirrorFilter', !mirror)}
                className={cx('inline-flex items-center gap-1.5 text-[12px] transition-colors', mirror ? 'text-accent' : 'text-muted hover:text-ink')}
                title="Açıkken haritada yalnız filtreye uyan yıldızlar parlak kalır"
              >
                <EyeIcon size={14} />
                Filtreyi haritaya yansıt
              </button>
              <button
                type="button"
                onClick={() => store().resetFilter(tab)}
                disabled={activeCount === 0}
                className="inline-flex items-center gap-1.5 text-[12px] text-muted transition-colors hover:text-ink disabled:opacity-40"
              >
                <ResetIcon size={13} /> Temizle
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div role="tabpanel" className="mt-2 min-h-0 flex-1 border-t border-line">
        {isStars ? (
          <DataTable<StarSortKey>
            key="stars"
            label="Yıldız listesi"
            rows={starRows}
            columns={stars.columns}
            layout={stars.layout}
            sort={starSort}
            onSort={store().setStarSort}
            defaultSortKey="default"
            selected={selectedStar}
            onActivate={(star) => store().selectStar(star, { fly: true })}
            onOpen={(star) => {
              const system = atlas.systemOfStar[star]
              if (system >= 0) store().openSystem(system)
            }}
            onHover={(star) => store().setHoverStar(star)}
            rowTone={(star) => (atlas.planetCount[star] > 0 ? 'gold' : null)}
            empty={<EmptyState onReset={resetAll} />}
          />
        ) : (
          <DataTable<PlanetSortKey>
            key="planets"
            label="Gezegen listesi"
            rows={planetRows}
            columns={planets.columns}
            layout={planets.layout}
            sort={planetSort}
            onSort={store().setPlanetSort}
            defaultSortKey="default"
            selected={selectedPlanet !== null && selectedPlanet < atlas.exoPlanetCount ? selectedPlanet : null}
            onActivate={(planet) => store().openSystem(atlas.planets[planet].system, planet)}
            onHover={(planet) => {
              const star = planet === null ? -1 : atlas.systems[atlas.planets[planet].system].star
              store().setHoverStar(star >= 0 ? star : null)
            }}
            rowTone={(planet) => (atlas.planets[planet].hz !== HZ_NONE ? 'hz' : null)}
            empty={<EmptyState onReset={resetAll} />}
          />
        )}
      </div>
    </aside>
  )
}
