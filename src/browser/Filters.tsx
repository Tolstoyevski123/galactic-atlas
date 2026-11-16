import { useMemo, type ReactNode } from 'react'
import type { Atlas } from '../data/atlas'
import { CONSTELLATIONS } from '../data/constellations'
import { methodLabel, methodShort, SPECTRAL_CHIPS } from '../data/labels'
import { fromUnit, toUnit, UNIT_LABEL, type Unit } from '../lib/format'
import { useAtlas } from '../store/useAtlas'
import { Chip, RangeField, Segmented, Switch } from '../ui/controls'
import { ChevronDownIcon } from '../ui/icons'
import type { PlanetFilter, Range, StarFilter } from './filterEngine'

const round6 = (v: number | null): number | null => (v === null ? null : Number(v.toPrecision(6)))

/** Distances are filtered in parsec but edited in the viewer's unit. */
function DistanceField({ label, unit, value, onChange }: { label: string; unit: Unit; value: Range; onChange: (range: Range) => void }) {
  const shown: Range = [round6(value[0] === null ? null : toUnit(value[0], unit)), round6(value[1] === null ? null : toUnit(value[1], unit))]
  return (
    <RangeField
      label={label}
      unit={UNIT_LABEL[unit]}
      value={shown}
      onChange={(r) => onChange([r[0] === null ? null : fromUnit(r[0], unit), r[1] === null ? null : fromUnit(r[1], unit)])}
    />
  )
}

function toggle(list: number[], value: number): number[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="col-span-2">
      <div className="mb-1.5 text-[11.5px] font-medium text-muted">{title}</div>
      {children}
    </div>
  )
}

export function StarFilters({ atlas }: { atlas: Atlas }) {
  const filter = useAtlas((s) => s.starFilter)
  const patch = useAtlas((s) => s.patchStarFilter)
  const unit = useAtlas((s) => s.unit)

  const constellations = useMemo(
    () =>
      atlas.meta.constellations
        .map((abbr, index) => ({ abbr, index, name: CONSTELLATIONS[abbr]?.[0] ?? abbr }))
        .filter((c) => c.abbr !== '')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [atlas],
  )

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-3">
      <DistanceField label="Uzaklık" unit={unit} value={filter.dist} onChange={(dist) => patch({ dist })} />
      <RangeField label="Görünür kadir" unit="m" value={filter.mag} onChange={(mag) => patch({ mag })} />
      <RangeField label="Mutlak kadir" unit="M" value={filter.absmag} onChange={(absmag) => patch({ absmag })} />
      <RangeField label="Renk indeksi" unit="B−V" value={filter.ci} onChange={(ci) => patch({ ci })} />

      <Group title="Tayf sınıfı">
        <div className="flex flex-wrap gap-1.5">
          {SPECTRAL_CHIPS.map((c) => (
            <Chip key={c.code} active={filter.classes.includes(c.code)} title={c.title} onClick={() => patch({ classes: toggle(filter.classes, c.code) })}>
              <span className="size-2 rounded-full" style={{ background: c.color }} />
              {c.label}
            </Chip>
          ))}
        </div>
      </Group>

      <Group title="Takımyıldız">
        <div className="relative">
          <select
            aria-label="Takımyıldız"
            value={filter.con}
            onChange={(e) => patch({ con: Number(e.target.value) })}
            className={`h-8 w-full appearance-none rounded-md border bg-black/30 pr-8 pl-2.5 text-[12.5px] transition-colors hover:border-line-strong focus:border-accent/60 focus:outline-none ${
              filter.con >= 0 ? 'border-accent/50 text-accent' : 'border-line text-ink'
            }`}
          >
            <option value={-1}>Tümü</option>
            {constellations.map((c) => (
              <option key={c.abbr} value={c.index}>
                {c.name} ({c.abbr})
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-faint">
            <ChevronDownIcon size={14} />
          </span>
        </div>
      </Group>

      <div className="col-span-2 space-y-0.5 border-t border-line pt-2">
        <Switch checked={filter.hostsOnly} onChange={(hostsOnly) => patch({ hostsOnly })} tone="gold">
          Yalnız ötegezegeni olanlar
        </Switch>
        <Switch checked={filter.favoritesOnly} onChange={(favoritesOnly) => patch({ favoritesOnly })} tone="gold">
          Yalnız favorilerim
        </Switch>
      </div>
    </div>
  )
}

export function PlanetFilters({ atlas }: { atlas: Atlas }) {
  const filter = useAtlas((s) => s.planetFilter)
  const patch = useAtlas((s) => s.patchPlanetFilter)
  const unit = useAtlas((s) => s.unit)

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-3">
      <Group title="Yaşanabilir bölge">
        <Segmented<PlanetFilter['hz']>
          label="Yaşanabilir bölge"
          value={filter.hz}
          onChange={(hz) => patch({ hz })}
          options={[
            { value: 0, label: 'Tümü' },
            { value: 1, label: 'HZ içinde', title: 'İyimser sınırlar: yakın-geçmiş Venüs … erken Mars' },
            { value: 2, label: 'Yalnız muhafazakâr', title: 'Kaçak sera … azami sera sınırları arası' },
          ]}
        />
      </Group>

      <RangeField label="Yarıçap" unit="R⊕" value={filter.radius} onChange={(radius) => patch({ radius })} />
      <RangeField label="Kütle" unit="M⊕" value={filter.mass} onChange={(mass) => patch({ mass })} />
      <RangeField label="Yörünge periyodu" unit="gün" value={filter.period} onChange={(period) => patch({ period })} />
      <RangeField label="Yarı-büyük eksen" unit="AU" value={filter.a} onChange={(a) => patch({ a })} />
      <RangeField label="Denge sıcaklığı" unit="K" value={filter.eqt} onChange={(eqt) => patch({ eqt })} />
      <RangeField label="Keşif yılı" value={filter.year} onChange={(year) => patch({ year })} placeholder={['1992', 'bugün']} />
      <DistanceField label="Uzaklık" unit={unit} value={filter.dist} onChange={(dist) => patch({ dist })} />
      <RangeField label="Sistemdeki gezegen" unit="adet" value={filter.pnum} onChange={(pnum) => patch({ pnum })} placeholder={['1', '8']} />

      <Group title="Keşif yöntemi">
        <div className="flex flex-wrap gap-1.5">
          {atlas.methods.map((name, index) => (
            <Chip key={name} active={filter.methods.includes(index)} title={methodLabel(name)} onClick={() => patch({ methods: toggle(filter.methods, index) })}>
              {methodShort(name)}
            </Chip>
          ))}
        </div>
      </Group>

      <div className="col-span-2 border-t border-line pt-2">
        <Switch checked={filter.favoritesOnly} onChange={(favoritesOnly) => patch({ favoritesOnly })} tone="gold">
          Yalnız favorilerim
        </Switch>
      </div>
    </div>
  )
}

/** One-click starting points. Applying one replaces the current filters but keeps the search text. */
export const STAR_PRESETS: Array<{ label: string; title: string; filter: Partial<StarFilter> }> = [
  { label: 'Çıplak gözle', title: 'Görünür kadir ≤ 6,5', filter: { mag: [null, 6.5] } },
  { label: '50 ıy içinde', title: 'Güneş’e 50 ışık yılından yakın', filter: { dist: [null, 50 / 3.2615638] } },
  { label: 'Güneş benzeri', title: 'G tayf sınıfı', filter: { classes: [4] } },
  { label: 'Gezegenli', title: 'En az bir onaylı ötegezegeni olan yıldızlar', filter: { hostsOnly: true } },
]

export const PLANET_PRESETS: Array<{ label: string; title: string; filter: Partial<PlanetFilter> }> = [
  { label: 'HZ’de kayaç', title: 'Yaşanabilir bölgede, yarıçapı ≤ 1,6 R⊕', filter: { hz: 1, radius: [null, 1.6] } },
  { label: 'Dünya boyutunda', title: 'Yarıçap 0,8 – 1,25 R⊕', filter: { radius: [0.8, 1.25] } },
  { label: 'Sıcak Jüpiterler', title: 'Yarıçap ≥ 8 R⊕, periyot ≤ 10 gün', filter: { radius: [8, null], period: [null, 10] } },
  { label: '50 ıy içinde', title: 'Güneş’e 50 ışık yılından yakın sistemler', filter: { dist: [null, 50 / 3.2615638] } },
]
