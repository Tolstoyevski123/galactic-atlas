import { useEffect, useMemo, useRef, useState } from 'react'
import type { Atlas } from '../data/atlas'
import { AU_PER_PC, PC_TO_LY } from '../lib/astro'
import { sig, UNIT_LABEL } from '../lib/format'
import { useAtlas, type Mode } from '../store/useAtlas'
import { layoutSystem } from '../three/systemLayout'
import { view } from '../three/view'
import { cx, IconButton, Segmented } from '../ui/controls'
import { ArrowLeftIcon, ConstellationIcon, GalaxyIcon, HomeIcon, HourglassIcon, PauseIcon, PlayIcon, TagIcon, TelescopeIcon } from '../ui/icons'
import { DiscoveryTimeline } from './DiscoveryTimeline'
import { TimeMachine } from './TimeMachine'

const FOV_TAN = Math.tan((50 * Math.PI) / 360)

/** Like a map's scale bar: how much space a short ruler spans at the depth you are looking at. */
function ScaleBar() {
  const unit = useAtlas((s) => s.unit)
  const bar = useRef<HTMLDivElement>(null)
  const text = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let raf = 0
    let last = 0
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (now - last < 120 || !bar.current || !text.current) return
      last = now
      const distance = view.camera.distanceTo(view.target)
      const parsecPerPixel = (2 * distance * FOV_TAN) / Math.max(1, view.height)
      // Pick the unit that gives a readable number, then a 1–2–5 value that fits 56–140 px.
      let perPixel = parsecPerPixel * (unit === 'ly' ? PC_TO_LY : 1)
      let label = UNIT_LABEL[unit]
      if (perPixel * 100 < 0.02) {
        perPixel = parsecPerPixel * AU_PER_PC
        label = 'AU'
      }
      const target = perPixel * 96
      const power = 10 ** Math.floor(Math.log10(target))
      const mantissa = target / power
      const nice = (mantissa < 1.5 ? 1 : mantissa < 3.5 ? 2 : mantissa < 7.5 ? 5 : 10) * power
      bar.current.style.width = `${(nice / perPixel).toFixed(1)}px`
      const value = `${sig(nice, 2)} ${label}`
      if (text.current.textContent !== value) text.current.textContent = value
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [unit])

  return (
    <div className="hidden items-center gap-2 pr-1 pl-1.5 sm:flex" title="Baktığınız noktanın derinliğinde bu çizginin karşılık geldiği uzaklık">
      <div ref={bar} className="h-[5px] rounded-[1px] border border-t-0 border-ink/55 transition-[width] duration-150" style={{ width: 96 }} />
      <span ref={text} className="min-w-[52px] text-[11.5px] tabular-nums text-muted" />
    </div>
  )
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-line" />
}

/** Buttons that open the two timeline strips. The discovery timeline is about the map's gold hosts, so it is map-only. */
function StripToggles({ discovery }: { discovery: boolean }) {
  const strip = useAtlas((s) => s.strip)
  const toggle = (which: 'discovery' | 'time') => useAtlas.getState().setStrip(strip === which ? null : which)
  return (
    <>
      {discovery && (
        <IconButton label={strip === 'discovery' ? 'Keşif tarihini kapat' : 'Keşif tarihi'} active={strip === 'discovery'} onClick={() => toggle('discovery')}>
          <TelescopeIcon size={16} />
        </IconButton>
      )}
      <IconButton label={strip === 'time' ? 'Zaman makinesini kapat' : 'Zaman makinesi'} active={strip === 'time'} onClick={() => toggle('time')}>
        <HourglassIcon size={16} />
      </IconButton>
    </>
  )
}

function LayerToggles() {
  const showLabels = useAtlas((s) => s.showLabels)
  const showMilkyWay = useAtlas((s) => s.showMilkyWay)
  const showConstellations = useAtlas((s) => s.showConstellations)
  const store = useAtlas.getState
  return (
    <>
      <IconButton label={showLabels ? 'Etiketleri gizle' : 'Etiketleri göster'} active={showLabels} onClick={() => store().setPref('showLabels', !showLabels)}>
        <TagIcon size={16} />
      </IconButton>
      <IconButton
        label={showConstellations ? 'Takımyıldız çizgilerini gizle' : 'Takımyıldız çizgilerini göster'}
        active={showConstellations}
        onClick={() => store().setPref('showConstellations', !showConstellations)}
      >
        <ConstellationIcon size={16} />
      </IconButton>
      <IconButton
        label={showMilkyWay ? 'Samanyolu bandını gizle' : 'Samanyolu bandını göster'}
        active={showMilkyWay}
        onClick={() => store().setPref('showMilkyWay', !showMilkyWay)}
      >
        <GalaxyIcon size={16} />
      </IconButton>
    </>
  )
}

/** Standing at a star: the way back, the layers, and the time machine. */
function SkyControls() {
  return (
    <>
      <button
        type="button"
        onClick={() => useAtlas.getState().exitSky()}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium text-ink transition-colors hover:bg-white/8"
      >
        <ArrowLeftIcon size={15} /> Haritaya dön
      </button>
      <Divider />
      <LayerToggles />
      <Divider />
      <StripToggles discovery={false} />
    </>
  )
}

function MapControls() {
  const unit = useAtlas((s) => s.unit)
  const store = useAtlas.getState
  return (
    <>
      <IconButton label="Güneş'e dön" onClick={() => store().goHome()}>
        <HomeIcon size={16} />
      </IconButton>
      <Divider />
      <LayerToggles />
      <Divider />
      <StripToggles discovery />
      <Divider />
      <Segmented
        label="Uzaklık birimi"
        size="sm"
        value={unit}
        onChange={(value) => store().setPref('unit', value)}
        options={[
          { value: 'ly', label: 'ıy', title: 'Işık yılı' },
          { value: 'pc', label: 'pc', title: 'Parsek (1 pc = 3,26 ıy)' },
        ]}
      />
      <Divider />
      <ScaleBar />
    </>
  )
}

/** Human wording for the time speed: "1 sn = 2,3 gün". */
function speedLabel(daysPerSecond: number): string {
  if (daysPerSecond < 1) return `1 sn = ${sig(daysPerSecond * 24, 2)} saat`
  if (daysPerSecond < 600) return `1 sn = ${sig(daysPerSecond, 2)} gün`
  return `1 sn = ${sig(daysPerSecond / 365.25, 2)} yıl`
}

function TimeControls({ atlas, systemIndex }: { atlas: Atlas; systemIndex: number }) {
  const speed = useAtlas((s) => s.simSpeed)
  const paused = useAtlas((s) => s.simPaused)
  const showMilkyWay = useAtlas((s) => s.showMilkyWay)
  const showConstellations = useAtlas((s) => s.showConstellations)
  const store = useAtlas.getState

  // Slider range: from a slow crawl of the innermost planet to a brisk lap of the outermost.
  const [min, max] = useMemo(() => {
    const system = atlas.systems[systemIndex]
    const start = atlas.planetStart[systemIndex]
    const layout = layoutSystem(system, atlas.planets.slice(start, start + system.planets.length))
    const lo = layout.minPeriod / 90
    return [lo, Math.max(layout.maxPeriod / 5, lo * 50)]
  }, [atlas, systemIndex])
  const position = Math.max(0, Math.min(1, Math.log(speed / min) / Math.log(max / min)))

  return (
    <>
      <IconButton label={paused ? 'Devam ettir' : 'Duraklat'} active={paused} onClick={() => store().setUi({ simPaused: !paused })}>
        {paused ? <PlayIcon size={15} /> : <PauseIcon size={16} />}
      </IconButton>
      <input
        type="range"
        aria-label="Zaman hızı"
        min={0}
        max={1}
        step={0.005}
        value={position}
        onChange={(e) => store().setUi({ simSpeed: min * (max / min) ** Number(e.target.value), simPaused: false })}
        className="speed-slider mx-1 w-28 sm:w-40"
        style={{ ['--fill' as string]: `${position * 100}%` }}
      />
      <span className={cx('min-w-[104px] text-[12px] tabular-nums', paused ? 'text-faint' : 'text-muted')}>{paused ? 'duraklatıldı' : speedLabel(speed)}</span>
      <Divider />
      <IconButton
        label={showConstellations ? 'Takımyıldız çizgilerini gizle' : 'Takımyıldız çizgilerini göster'}
        active={showConstellations}
        onClick={() => store().setPref('showConstellations', !showConstellations)}
      >
        <ConstellationIcon size={16} />
      </IconButton>
      <IconButton
        label={showMilkyWay ? 'Samanyolu bandını gizle' : 'Samanyolu bandını göster'}
        active={showMilkyWay}
        onClick={() => store().setPref('showMilkyWay', !showMilkyWay)}
      >
        <GalaxyIcon size={16} />
      </IconButton>
    </>
  )
}

/** First-visit reminder of the controls; steps aside after a few seconds or the first gesture. */
function Hint({ mode }: { mode: Mode }) {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    setVisible(true)
    const hide = () => setVisible(false)
    const timer = window.setTimeout(hide, 14000)
    window.addEventListener('wheel', hide, { once: true, passive: true })
    window.addEventListener('pointerdown', hide, { once: true })
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('wheel', hide)
      window.removeEventListener('pointerdown', hide)
    }
  }, [mode])
  const items =
    mode === 'map'
      ? [['Sürükle', 'döndür'], ['Tekerlek', 'yakınlaş'], ['Sağ tık', 'kaydır'], ['Çift tık', 'sisteme dal']]
      : mode === 'sky'
        ? [['Sürükle', 'etrafa bak'], ['Tıkla', 'yıldızı seç'], ['Çift tık', 'o yıldıza geç'], ['Esc', 'haritaya dön']]
        : [['Sürükle', 'döndür'], ['Tekerlek', 'yakınlaş'], ['Gezegene tıkla', 'ayrıntılar'], ['Esc', 'haritaya dön']]
  return (
    <div
      aria-hidden={!visible}
      className={cx(
        'pointer-events-none mb-2 hidden flex-wrap gap-x-3 gap-y-1 pl-1 text-[11.5px] text-muted transition-opacity duration-700 md:flex',
        visible ? 'opacity-100' : 'opacity-0',
      )}
    >
      {items.map(([key, action]) => (
        <span key={key} className="[text-shadow:0_0_8px_rgb(0_0_0/0.9)]">
          <span className="font-semibold text-ink/90">{key}</span> {action}
        </span>
      ))}
    </div>
  )
}

/** Bottom-left control strip: navigation and layers on the map, time controls inside a system, plus an open timeline strip. */
export function Hud({ atlas }: { atlas: Atlas }) {
  const mode = useAtlas((s) => s.mode)
  const systemIndex = useAtlas((s) => s.systemIndex)
  const strip = useAtlas((s) => s.strip)
  // The discovery timeline belongs to the map; the time machine also works from a star's sky.
  const shown = mode === 'map' ? strip : mode === 'sky' && strip === 'time' ? strip : null
  return (
    <div className="hud pointer-events-none absolute bottom-3 left-3 z-20">
      {shown === 'discovery' ? <DiscoveryTimeline atlas={atlas} /> : shown === 'time' ? <TimeMachine /> : <Hint mode={mode} />}
      <div className="glass pointer-events-auto inline-flex h-11 items-center gap-0.5 rounded-[14px] px-1.5">
        {mode === 'system' && systemIndex !== null ? <TimeControls atlas={atlas} systemIndex={systemIndex} /> : mode === 'sky' ? <SkyControls /> : <MapControls />}
      </div>
    </div>
  )
}
