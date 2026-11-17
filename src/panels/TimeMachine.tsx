import { useEffect } from 'react'
import { EPOCH_LIMIT, useAtlas } from '../store/useAtlas'
import { cx, IconButton, Segmented, StripShell } from '../ui/controls'
import { BackwardIcon, ForwardIcon, HourglassIcon, PauseIcon } from '../ui/icons'

/** The calendar year of "today" for the time machine's labels. */
export const PRESENT_YEAR = new Date().getFullYear()
/** Straight-line motion is a fair guide this far either way; beyond it the labels say "roughly". */
export const LINEAR_RELIABLE_YEARS = 100_000

const DECADES = Math.log10(EPOCH_LIMIT + 1)
/** Slider position (−1..1) ↔ years: logarithmic either side of today, so ±1,000 and ±1,000,000 years both get room. */
export const sliderToYears = (u: number): number => Math.sign(u) * (10 ** (Math.abs(u) * DECADES) - 1)
export const yearsToSlider = (years: number): number => Math.sign(years) * (Math.log10(Math.abs(years) + 1) / DECADES)

const group = (n: number): string => Math.round(n).toLocaleString('tr-TR')

/** "MS 52.026" / "MÖ 97.974" for a date `years` from today. */
export function calendarLabel(years: number): string {
  const year = Math.round(PRESENT_YEAR + years)
  return year > 0 ? `MS ${group(year)}` : `MÖ ${group(1 - year)}`
}

/** "bugün" / "50.000 yıl sonra" / "≈ 10.000 yıl önce" — rounded to what the slider can really set. */
export function relativeLabel(years: number): string {
  const a = Math.abs(years)
  if (a < 0.5) return 'bugün'
  const step = a < 100 ? 1 : 10 ** Math.floor(Math.log10(a) - 1)
  const rounded = Math.round(a / step) * step
  return `${group(rounded)} yıl ${years > 0 ? 'sonra' : 'önce'}`
}

const PRESETS = [-100_000, -10_000, 0, 10_000, 100_000, 1_000_000]
const presetLabel = (years: number): string =>
  years === 0 ? 'Bugün' : `${years > 0 ? '+' : '−'}${Math.abs(years) >= 1_000_000 ? `${Math.abs(years) / 1_000_000} milyon` : `${Math.abs(years) / 1000} bin`}`

const SPEEDS = [1_000, 10_000, 100_000]

/** Advance the date while playback runs. */
function usePlayback(): void {
  const play = useAtlas((s) => s.epochPlay)
  useEffect(() => {
    if (play === 0) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const s = useAtlas.getState()
      const next = s.epoch + play * s.epochSpeed * dt
      if (Math.abs(next) >= EPOCH_LIMIT) {
        s.setEpoch(Math.sign(next) * EPOCH_LIMIT)
        s.setEpochPlay(0)
        return
      }
      s.setEpoch(next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [play])
}

/** The time machine strip: move every star along its measured velocity, up to a million years either way. */
export function TimeMachine() {
  const epoch = useAtlas((s) => s.epoch)
  const play = useAtlas((s) => s.epochPlay)
  const speed = useAtlas((s) => s.epochSpeed)
  const store = useAtlas.getState
  usePlayback()
  const position = yearsToSlider(epoch)
  const rough = Math.abs(epoch) > LINEAR_RELIABLE_YEARS

  return (
    <StripShell
      label="Zaman makinesi"
      icon={<HourglassIcon size={14} />}
      title="Zaman makinesi"
      onClose={() => store().setStrip(null)}
      status={
        <span data-epoch={Math.round(epoch)}>
          <span className="font-medium text-ink">{calendarLabel(epoch)}</span> · {relativeLabel(epoch)}
        </span>
      }
    >
      <div className="mt-2.5 flex items-center gap-2">
        <span className="w-7 shrink-0 text-[10.5px] text-faint">geçmiş</span>
        <input
          type="range"
          aria-label="Tarih"
          aria-valuetext={`${calendarLabel(epoch)}, ${relativeLabel(epoch)}`}
          min={-1}
          max={1}
          step={0.001}
          value={position}
          onChange={(e) => {
            const u = Number(e.target.value)
            // A small dead zone around the middle so "today" is easy to hit by hand.
            store().setEpoch(Math.abs(u) < 0.012 ? 0 : sliderToYears(u))
          }}
          className="speed-slider speed-slider--center min-w-0 flex-1"
          style={{ ['--fill' as string]: `${((position + 1) / 2) * 100}%` }}
        />
        <span className="w-9 shrink-0 text-right text-[10.5px] text-faint">gelecek</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {PRESETS.map((years) => (
          <button
            key={years}
            type="button"
            onClick={() => {
              store().setEpochPlay(0)
              store().setEpoch(years)
            }}
            aria-pressed={Math.abs(epoch - years) < 0.5}
            className={cx(
              'h-6 rounded-md border px-2 text-[11.5px] font-medium tabular-nums transition-colors',
              Math.abs(epoch - years) < 0.5 ? 'border-accent/50 bg-accent/15 text-accent' : 'border-line bg-white/[0.03] text-muted hover:border-line-strong hover:text-ink',
            )}
          >
            {presetLabel(years)}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-0.5">
          <IconButton label="Geriye oynat" size="sm" active={play === -1} onClick={() => store().setEpochPlay(play === -1 ? 0 : -1)}>
            <BackwardIcon size={13} />
          </IconButton>
          <IconButton label="Durdur" size="sm" disabled={play === 0} onClick={() => store().setEpochPlay(0)}>
            <PauseIcon size={14} />
          </IconButton>
          <IconButton label="İleriye oynat" size="sm" active={play === 1} onClick={() => store().setEpochPlay(play === 1 ? 0 : 1)}>
            <ForwardIcon size={13} />
          </IconButton>
          <Segmented
            label="Oynatma hızı"
            size="sm"
            value={speed}
            onChange={(value) => store().setEpochPlay(play, value)}
            options={SPEEDS.map((value) => ({ value, label: `${value / 1000} bin/sn`, title: `Saniyede ${group(value)} yıl` }))}
          />
        </span>
      </div>

      <p className={cx('mt-2 text-[11px] leading-snug', rough ? 'text-gold/90' : 'text-faint')}>
        {rough
          ? 'Bu kadar uzakta yalnızca kaba bir tahmin: yıldızlar düz çizgide gidiyor sayılıyor, Galaksi’nin çekimi hesaba katılmıyor.'
          : 'Her yıldız ölçülmüş uzay hızıyla düz çizgide ilerletilir. Dikine hızı ölçülmemiş yıldızlar yalnızca gökyüzünde kayar.'}
      </p>
    </StripShell>
  )
}
