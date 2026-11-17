import { useEffect, useMemo, useState } from 'react'
import type { Atlas } from '../data/atlas'
import { METHOD_GROUPS } from '../data/labels'
import { discoveryOf, milestoneFor } from '../lib/discovery'
import { count } from '../lib/format'
import { prefersReducedMotion } from '../lib/motion'
import { useAtlas } from '../store/useAtlas'
import { SECONDS_PER_DISCOVERY_YEAR } from '../three/view'
import { cx, IconButton, StripShell } from '../ui/controls'
import { PauseIcon, PlayIcon, TelescopeIcon } from '../ui/icons'

const CHART_HEIGHT = 54

/** Step the year forward while playing; stops at the last year. */
function usePlayback(lastYear: number): void {
  const playing = useAtlas((s) => s.discoveryPlaying)
  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => {
      const s = useAtlas.getState()
      const year = s.discoveryYear ?? lastYear
      if (year >= lastYear) {
        s.setDiscoveryPlaying(false)
        return
      }
      s.setDiscoveryYear(year + 1)
      if (year + 1 >= lastYear) s.setDiscoveryPlaying(false)
    }, SECONDS_PER_DISCOVERY_YEAR * 1000)
    return () => window.clearInterval(timer)
  }, [playing, lastYear])
}

/** Planets found per year, stacked by method; years after the chosen one fade back. */
function Histogram({ atlas, year }: { atlas: Atlas; year: number }) {
  const stats = discoveryOf(atlas)
  const [hover, setHover] = useState<number | null>(null)
  const n = stats.years.length
  const width = 100 / n
  // A square-root scale keeps the early years (a handful of planets) visible next to 2016's thousand-plus.
  const scale = (v: number) => (Math.sqrt(v) / Math.sqrt(Math.max(1, stats.maxTotal))) * CHART_HEIGHT
  const shown = hover ?? year
  const index = shown - stats.firstYear

  return (
    <div className="relative mt-2.5">
      <svg
        viewBox={`0 0 100 ${CHART_HEIGHT}`}
        preserveAspectRatio="none"
        className="block h-[54px] w-full cursor-pointer"
        role="img"
        aria-label={`Yıllara göre keşfedilen gezegen sayısı, ${stats.firstYear}–${stats.lastYear}`}
        onPointerLeave={() => setHover(null)}
      >
        {stats.years.map((y, k) => {
          const total = stats.totals[k]
          const future = y > year
          let top = CHART_HEIGHT
          return (
            <g
              key={y}
              opacity={future ? 0.22 : 1}
              onPointerEnter={() => setHover(y)}
              onClick={() => {
                useAtlas.getState().setDiscoveryPlaying(false)
                useAtlas.getState().setDiscoveryYear(y)
              }}
            >
              {/* Full-height hit area, so thin early bars are still easy to point at. */}
              <rect x={k * width} y={0} width={width} height={CHART_HEIGHT} fill="transparent" />
              {total > 0 &&
                METHOD_GROUPS.map((group, g) => {
                  const value = stats.counts[k][g]
                  if (value === 0) return null
                  // Stack in proportion to the bar's (square-rooted) height.
                  const h = (value / total) * scale(total)
                  top -= h
                  return <rect key={group.key} x={k * width + width * 0.14} y={top} width={width * 0.72} height={h} fill={group.color} />
                })}
              {y === year && <rect x={k * width} y={0} width={width} height={CHART_HEIGHT} fill="rgb(255 255 255 / 0.07)" />}
            </g>
          )
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10.5px] tabular-nums text-faint">
        <span>{stats.firstYear}</span>
        <span className="text-muted">
          {index >= 0 && index < n ? (
            <>
              <span className="font-medium text-ink">{shown}</span>: {count(stats.totals[index])} gezegen
            </>
          ) : null}
        </span>
        <span>{stats.lastYear}</span>
      </div>
    </div>
  )
}

/** The discovery timeline strip: replay thirty-odd years of exoplanet finds on the map. */
export function DiscoveryTimeline({ atlas }: { atlas: Atlas }) {
  const stats = useMemo(() => discoveryOf(atlas), [atlas])
  const year = useAtlas((s) => s.discoveryYear) ?? stats.lastYear
  const playing = useAtlas((s) => s.discoveryPlaying)
  const store = useAtlas.getState
  usePlayback(stats.lastYear)
  const index = Math.max(0, Math.min(stats.years.length - 1, year - stats.firstYear))
  const milestone = milestoneFor(year)
  const reduced = prefersReducedMotion()

  const togglePlay = () => {
    if (playing) {
      store().setDiscoveryPlaying(false)
      return
    }
    if (year >= stats.lastYear) store().setDiscoveryYear(stats.firstYear)
    store().setDiscoveryPlaying(true)
  }

  return (
    <StripShell
      label="Keşif tarihi"
      icon={<TelescopeIcon size={14} />}
      title="Keşif tarihi"
      onClose={() => store().setStrip(null)}
      status={
        <span data-discovery-year={year}>
          <span className="font-medium text-ink">{year}</span> sonuna dek {count(stats.cumulative[index])} gezegen ·{' '}
          {count(stats.cumulativeSystems[index])} sistem
        </span>
      }
    >
      <Histogram atlas={atlas} year={year} />

      <div className="mt-1.5 flex items-center gap-2">
        <IconButton label={playing ? 'Duraklat' : 'Yılları oynat'} size="sm" active={playing} disabled={reduced} onClick={togglePlay}>
          {playing ? <PauseIcon size={14} /> : <PlayIcon size={13} />}
        </IconButton>
        <input
          type="range"
          aria-label="Yıl"
          min={stats.firstYear}
          max={stats.lastYear}
          step={1}
          value={year}
          onChange={(e) => {
            store().setDiscoveryPlaying(false)
            store().setDiscoveryYear(Number(e.target.value))
          }}
          className="speed-slider min-w-0 flex-1"
          style={{ ['--fill' as string]: `${(index / Math.max(1, stats.years.length - 1)) * 100}%` }}
        />
      </div>

      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {METHOD_GROUPS.map((group, g) => (
          <li key={group.key} title={group.title} className="inline-flex items-center gap-1.5 text-[11px] text-muted">
            <span className="size-2 rounded-[2px]" style={{ background: group.color }} />
            {group.label}
            <span className="tabular-nums text-faint">{count(stats.cumulativeByGroup[index][g])}</span>
          </li>
        ))}
      </ul>

      <p className={cx('mt-2 min-h-[30px] text-[11.5px] leading-snug', milestone ? 'text-ink/85' : 'text-faint')}>
        {milestone ? (
          <>
            <span className="font-semibold text-gold">{milestone.year}</span> · {milestone.text}
          </>
        ) : (
          'Henüz bilinen ötegezegen yok.'
        )}
      </p>
    </StripShell>
  )
}
