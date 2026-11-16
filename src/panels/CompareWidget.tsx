import type { PlanetRow } from '../data/atlas'
import { HZ_NONE, type SystemRecord } from '../data/schema'
import { sig } from '../lib/format'
import { useAtlas } from '../store/useAtlas'

const WIDTH = 328
const HEIGHT = 136
const LEFT = 14
const RIGHT = 12
const ROW_A = 40
const ROW_B = 92
const BAND = 24

const dotRadius = (earthRadii: number | undefined): number => Math.max(2.2, Math.min(8.5, 2.2 + 2.1 * Math.log2(1 + (earthRadii ?? 1.5))))

interface RowProps {
  y: number
  title: string
  system: SystemRecord
  planets: PlanetRow[]
  x: (au: number) => number
  interactive: boolean
  initials?: boolean
}

function Row({ y, title, system, planets, x, interactive, initials }: RowProps) {
  const selected = useAtlas((s) => s.selectedPlanet)
  const hovered = useAtlas((s) => s.hoverPlanet)
  const hz = system.hz
  const clampX = (au: number) => Math.max(LEFT, Math.min(WIDTH - RIGHT, x(au)))
  return (
    <g>
      <text x={LEFT} y={y - BAND / 2 - 5} className="fill-muted text-[10px] font-medium">
        {title}
      </text>
      <line x1={LEFT} x2={WIDTH - RIGHT} y1={y} y2={y} className="stroke-white/10" />
      {hz && (
        <>
          <rect x={clampX(hz[0])} width={Math.max(0, clampX(hz[3]) - clampX(hz[0]))} y={y - BAND / 2} height={BAND} rx={3} className="fill-hz/10" />
          <rect x={clampX(hz[1])} width={Math.max(0, clampX(hz[2]) - clampX(hz[1]))} y={y - BAND / 2} height={BAND} rx={3} className="fill-hz/25" />
        </>
      )}
      {planets.map((p) => {
        if (p.a == null) return null
        const active = interactive && (p.index === selected || p.index === hovered)
        const inHz = p.hz !== HZ_NONE
        const r = dotRadius(p.radius)
        const cx = x(p.a)
        return (
          <g
            key={p.id}
            onClick={interactive ? () => useAtlas.getState().selectPlanet(p.index) : undefined}
            onMouseEnter={interactive ? () => useAtlas.getState().setHoverPlanet(p.index) : undefined}
            onMouseLeave={interactive ? () => useAtlas.getState().setHoverPlanet(null) : undefined}
            className={interactive ? 'cursor-pointer' : undefined}
          >
            <title>{`${p.name} — ${sig(p.a, 3)} AU${p.radius != null ? `, ${sig(p.radius, 3)} R⊕` : ''}`}</title>
            {/* wider invisible hit target */}
            {interactive && <circle cx={cx} cy={y} r={Math.max(r + 4, 9)} fill="transparent" />}
            {active && <circle cx={cx} cy={y} r={r + 3.5} fill="none" className="stroke-white" strokeWidth={1.2} />}
            <circle
              cx={cx}
              cy={y}
              r={r}
              className={inHz ? 'fill-hz' : interactive ? 'fill-[#dbe4f5]' : 'fill-[#8793ad]'}
              stroke="#090c15"
              strokeWidth={1}
            />
            {initials && (
              <text x={cx} y={y + BAND / 2 + 10} textAnchor="middle" className="fill-faint text-[8.5px] font-medium">
                {p.name[0]}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
}

interface Props {
  system: SystemRecord
  planets: PlanetRow[]
  solar: SystemRecord
  solarPlanets: PlanetRow[]
}

/**
 * The selected system and the Solar System on one logarithmic distance axis, each with its
 * habitable zone. Dot size follows planet radius (compressed); green means inside the zone.
 */
export function CompareWidget({ system, planets, solar, solarPlanets }: Props) {
  const distances = [...planets, ...solarPlanets].map((p) => p.a).filter((a): a is number => a != null)
  const zoneEdges = [...(system.hz ?? []), ...(solar.hz ?? [])]
  const lo = Math.log10(Math.min(...distances, ...zoneEdges) * 0.6)
  const hi = Math.log10(Math.max(...distances, ...zoneEdges) * 1.5)
  const x = (au: number) => LEFT + ((Math.log10(au) - lo) / (hi - lo)) * (WIDTH - LEFT - RIGHT)

  const ticks: number[] = []
  for (let e = Math.ceil(lo); e <= Math.floor(hi); e++) ticks.push(e)

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block w-full" role="img" aria-label={`${system.host} ile Güneş Sistemi'nin yörünge uzaklıkları karşılaştırması`}>
        {ticks.map((e) => (
          <g key={e}>
            <line x1={x(10 ** e)} x2={x(10 ** e)} y1={18} y2={HEIGHT - 16} className="stroke-white/[0.07]" strokeDasharray="2 3" />
            <text x={x(10 ** e)} y={HEIGHT - 4} textAnchor="middle" className="fill-faint text-[9px] tabular-nums">
              {sig(10 ** e, 1)} AU
            </text>
          </g>
        ))}
        <Row y={ROW_A} title={system.host} system={system} planets={planets} x={x} interactive />
        <Row y={ROW_B} title="Güneş Sistemi" system={solar} planets={solarPlanets} x={x} interactive={false} initials />
      </svg>
      <figcaption className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-faint">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-3.5 rounded-sm bg-hz/30" /> yaşanabilir bölge
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-full bg-hz" /> bölgedeki gezegen
        </span>
        <span>logaritmik eksen</span>
      </figcaption>
    </figure>
  )
}

/** Planet silhouette next to Earth (and Jupiter for the big ones), drawn to one scale. */
export function SizeComparison({ name, radius, estimated }: { name: string; radius: number; estimated: boolean }) {
  const JUPITER = 11.21
  const bodies = [
    { label: 'Dünya', r: 1, className: 'fill-[#5b93c7]' },
    { label: name, r: radius, className: 'fill-[#e9edf5]' },
    ...(radius > 2.6 ? [{ label: 'Jüpiter', r: JUPITER, className: 'fill-[#c9a27e]' }] : []),
  ].sort((a, b) => a.r - b.r)
  const largest = Math.max(...bodies.map((b) => b.r))
  const scale = 26 / largest
  const gap = 16
  let cursor = 4
  const placed = bodies.map((b) => {
    const r = Math.max(1.4, b.r * scale)
    const cx = cursor + r
    cursor += r * 2 + gap
    return { ...b, r, cx }
  })
  const width = cursor - gap + 4
  return (
    <svg viewBox={`0 0 ${width} 76`} height={76} style={{ width: Math.min(width, 300), maxWidth: '100%' }} role="img" aria-label={`${name} boyutu, Dünya ile karşılaştırma`}>
      {placed.map((b) => (
        <g key={b.label}>
          <circle cx={b.cx} cy={58 - b.r} r={b.r} className={b.className} opacity={b.label === name && estimated ? 0.55 : 1} strokeDasharray={b.label === name && estimated ? '2 2' : undefined} stroke={b.label === name && estimated ? '#e9edf5' : 'none'} />
          <text x={b.cx} y={71} textAnchor="middle" className={`text-[9px] ${b.label === name ? 'fill-ink font-semibold' : 'fill-faint'}`}>
            {b.label.length > 14 ? `${b.label.slice(0, 13)}…` : b.label}
          </text>
        </g>
      ))}
    </svg>
  )
}
