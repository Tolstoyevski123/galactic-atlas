import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { planetKey, starDesignations, starKey, type Atlas, type PlanetRow } from '../data/atlas'
import { constellationName } from '../data/constellations'
import { methodLabel, PLANET_CLASS_LABEL, spectralColor } from '../data/labels'
import {
  FLAG_ABSMAG_EST,
  FLAG_SYNTHETIC,
  HZ_CONSERVATIVE,
  HZ_NONE,
  HZ_OPTIMISTIC,
  SPECT_UNKNOWN,
  SPECTRAL_CLASSES,
  type SystemRecord,
} from '../data/schema'
import { luminosityFromAbsMag, planetClass, raDecOf, radiusFromMass, starColor, teffFromBv } from '../lib/astro'
import { DASH, fixed, formatDec, formatDistance, formatPeriod, formatRa, sig } from '../lib/format'
import { stateToHash } from '../store/bootstrap'
import { useAtlas } from '../store/useAtlas'
import { Badge, cx, IconButton, Stat } from '../ui/controls'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CloseIcon,
  CrosshairIcon,
  LeafIcon,
  LinkIcon,
  OrbitIcon,
  StarFilledIcon,
  StarIcon,
} from '../ui/icons'
import { CompareWidget, SizeComparison } from './CompareWidget'

async function copyShareLink(): Promise<void> {
  const store = useAtlas.getState()
  const url = window.location.origin + window.location.pathname + window.location.search + stateToHash(store)
  try {
    await navigator.clipboard.writeText(url)
    store.showToast('Bağlantı panoya kopyalandı.')
  } catch {
    store.showToast('Kopyalanamadı — bağlantıyı adres çubuğundan alabilirsiniz.')
  }
}

function FavoriteButton({ id }: { id: string }) {
  const on = useAtlas((s) => s.favorites.includes(id))
  return (
    <IconButton label={on ? 'Favorilerden çıkar' : 'Favorilere ekle'} tip="bottom" active={on} tone="gold" onClick={() => useAtlas.getState().toggleFavorite(id)}>
      {on ? <StarFilledIcon size={16} /> : <StarIcon size={16} />}
    </IconButton>
  )
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-t border-line px-4 py-3.5">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="eyebrow">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

function PrimaryButton({ onClick, children, tone = 'gold' }: { onClick: () => void; children: ReactNode; tone?: 'gold' | 'plain' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-[13px] font-semibold transition duration-150 active:scale-[0.98]',
        tone === 'gold'
          ? 'bg-gold text-[#1c1403] shadow-[0_6px_20px_-8px_rgb(246_196_83/0.7)] hover:brightness-110'
          : 'border border-line-strong text-ink hover:bg-white/8',
      )}
    >
      {children}
    </button>
  )
}

const approx = (text: string): string => `≈ ${text}`

// ─────────────────────────────────────────────────────────────── welcome

const SUGGESTIONS = [
  { key: 'system-trappist-1', title: 'TRAPPIST-1', note: '7 kayaç gezegen, 3’ü yaşanabilir bölgede' },
  { key: 'system-proxima-cen', title: 'Proxima Centauri', note: 'En yakın yıldız ve gezegenleri' },
  { key: 'system-toi-700', title: 'TOI-700', note: 'Yaşanabilir bölgede, Dünya boyutunda' },
  { key: 'system-gunes-sistemi', title: 'Güneş Sistemi', note: 'Kıyas için evimiz' },
]

function Welcome({ atlas }: { atlas: Atlas }) {
  const systems = useMemo(() => new Map(atlas.systems.map((s, i) => [`system-${s.id}`, i])), [atlas])
  return (
    <div className="animate-rise p-4">
      <h2 className="font-display text-[16px] font-semibold text-ink">Keşfe başla</h2>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
        Haritada <span className="font-medium text-gold">altın halkalı</span> yıldızların gezegenleri var. Birine tıkla, sonra sistemine
        dal — ya da buradan başla:
      </p>
      <ul className="mt-3 space-y-1">
        {SUGGESTIONS.filter((s) => systems.has(s.key)).map((s) => (
          <li key={s.key}>
            <button
              type="button"
              onClick={() => useAtlas.getState().openSystem(systems.get(s.key)!)}
              className="group flex w-full items-center gap-3 rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors hover:border-line hover:bg-white/[0.05]"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-gold/12 text-gold">
                <OrbitIcon size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-display text-[13px] font-semibold text-ink">{s.title}</span>
                <span className="block truncate text-[11.5px] text-muted">{s.note}</span>
              </span>
              <span className="text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink">
                <ArrowRightIcon size={14} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────── star

function PlanetListItem({ planet, onClick, active }: { planet: PlanetRow; onClick: () => void; active?: boolean }) {
  const facts = [planet.radius != null ? `${sig(planet.radius, 3)} R⊕` : null, planet.period != null ? formatPeriod(planet.period) : null]
    .filter(Boolean)
    .join(' · ')
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => useAtlas.getState().setHoverPlanet(planet.index)}
      onMouseLeave={() => useAtlas.getState().setHoverPlanet(null)}
      className={cx(
        'flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors',
        active ? 'border-white/25 bg-white/10' : 'border-transparent hover:border-line hover:bg-white/[0.05]',
      )}
    >
      <span className={cx('size-2 shrink-0 rounded-full', planet.hz === HZ_CONSERVATIVE ? 'bg-hz' : planet.hz === HZ_OPTIMISTIC ? 'border border-hz' : 'bg-white/30')} />
      <span className="min-w-0 flex-1 truncate font-display text-[13px] font-medium text-ink">{planet.name}</span>
      <span className="shrink-0 text-[11.5px] tabular-nums text-muted">{facts || 'veri yok'}</span>
    </button>
  )
}

function StarDetail({ atlas, star }: { atlas: Atlas; star: number }) {
  const unit = useAtlas((s) => s.unit)
  const store = useAtlas.getState
  const isSol = star === 0
  const systemIndex = atlas.systemOfStar[star]
  const system = systemIndex >= 0 ? atlas.systems[systemIndex] : null
  const planets = system ? atlas.planets.slice(atlas.planetStart[systemIndex], atlas.planetStart[systemIndex] + system.planets.length) : []

  const con = atlas.meta.constellations[atlas.con[star]]
  const cls = atlas.spectClass[star]
  const spect = atlas.meta.spectDict[atlas.spect[star]] || (cls < 7 ? `~${SPECTRAL_CLASSES[cls]}` : cls === SPECT_UNKNOWN ? '' : 'diğer')
  const ci = atlas.ci[star]
  const [r, g, b] = starColor(ci, 1.2)
  const color = `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`
  const synthetic = (atlas.flags[star] & FLAG_SYNTHETIC) !== 0
  const absEstimated = (atlas.flags[star] & FLAG_ABSMAG_EST) !== 0
  const equatorial = raDecOf(atlas.posEq[star * 3], atlas.posEq[star * 3 + 1], atlas.posEq[star * 3 + 2])
  const teff = system?.teff ?? (Number.isFinite(ci) ? teffFromBv(ci) : null)
  const lum = system?.lum ?? luminosityFromAbsMag(atlas.absmag[star])
  const others = starDesignations(atlas, star).slice(1)

  const subtitle = isSol
    ? 'Yıldızımız · her şeyin ölçüsü'
    : [con ? `${constellationName(con)} takımyıldızı` : null, formatDistance(atlas.dist[star], unit)].filter(Boolean).join(' · ')

  return (
    <div className="animate-rise">
      <header className="flex items-start gap-3 p-4 pb-3">
        <span className="mt-1.5 size-3.5 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 14px 3px ${color}` }} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-[19px] leading-tight font-semibold text-white">{atlas.names[star]}</h2>
          <p className="mt-0.5 truncate text-[12.5px] text-muted">{subtitle}</p>
        </div>
        <div className="-mt-1 -mr-1.5 flex shrink-0">
          <FavoriteButton id={starKey(atlas, star)} />
          <IconButton label="Bağlantıyı kopyala" tip="bottom" onClick={() => void copyShareLink()}>
            <LinkIcon size={16} />
          </IconButton>
          <IconButton label="Seçimi kapat" tip="bottom" onClick={() => store().selectStar(null)}>
            <CloseIcon size={16} />
          </IconButton>
        </div>
      </header>

      {(planets.length > 0 || synthetic) && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-3">
          {system && !isSol && (
            <Badge tone="gold">
              <OrbitIcon size={12} /> {planets.length} onaylı gezegen
            </Badge>
          )}
          {isSol && <Badge tone="accent">8 gezegen</Badge>}
          {planets.some((p) => p.hz !== HZ_NONE) && (
            <Badge tone="hz">
              <LeafIcon size={11} /> yaşanabilir bölgede gezegen
            </Badge>
          )}
          {synthetic && (
            <Badge tone="muted" title="Bu yıldız HYG kataloğunda yok; konumu NASA Exoplanet Archive'ın sağ açıklık, dik açıklık ve uzaklık değerlerinden hesaplandı.">
              HYG dışı · NASA konumu
            </Badge>
          )}
        </div>
      )}

      <div className="px-4 pb-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-line bg-black/20 p-3">
          <Stat label="Uzaklık" hint={isSol ? undefined : `${sig(atlas.dist[star], 4)} pc = ${sig(atlas.dist[star] * 3.2615638, 4)} ıy`}>
            {isSol ? DASH : formatDistance(atlas.dist[star], unit)}
          </Stat>
          <Stat label="Tayf tipi">
            {spect ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: spectralColor(cls) }} />
                {spect}
              </span>
            ) : (
              DASH
            )}
          </Stat>
          <Stat label="Görünür kadir" hint="Dünya'dan görünen parlaklık (V). Küçük sayı daha parlak; çıplak göz sınırı ≈ 6,5.">
            {fixed(atlas.mag[star], 2)}
          </Stat>
          <Stat label="Mutlak kadir" hint="10 parsek uzaktan görünecek parlaklık.">
            {absEstimated ? approx(fixed(atlas.absmag[star], 1)) : fixed(atlas.absmag[star], 2)}
          </Stat>
          <Stat label="Sıcaklık" hint={system?.teff ? 'NASA Exoplanet Archive' : 'B−V renk indeksinden tahmin (Ballesteros 2012)'}>
            {teff ? `${system?.teff ? '' : '≈ '}${fixed(teff, 0)} K` : DASH}
          </Stat>
          <Stat label="Işıtma" hint={system?.lum ? 'NASA Exoplanet Archive' : 'Mutlak kadirden tahmin (bolometrik düzeltme yok)'}>
            {`${system?.lum ? '' : '≈ '}${sig(lum, 3)} L☉`}
          </Stat>
          {equatorial && !isSol && (
            <>
              <Stat label="Sağ açıklık">{formatRa(equatorial.raHours)}</Stat>
              <Stat label="Dik açıklık">{formatDec(equatorial.decDeg)}</Stat>
            </>
          )}
        </dl>

        {others.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {others.map((name) => (
              <span key={name} className="rounded-md border border-line bg-white/[0.03] px-1.5 py-0.5 text-[11px] tabular-nums text-muted">
                {name}
              </span>
            ))}
          </div>
        )}

        <div className="mt-3.5 flex gap-2">
          {system && (
            <PrimaryButton onClick={() => store().openSystem(systemIndex)}>
              <OrbitIcon size={16} /> {isSol ? 'Güneş Sistemi’ne dal' : 'Sisteme dal'}
            </PrimaryButton>
          )}
          <PrimaryButton tone="plain" onClick={() => store().selectStar(star, { fly: true })}>
            <CrosshairIcon size={15} /> Yıldıza uç
          </PrimaryButton>
        </div>
      </div>

      {system && planets.length > 0 && (
        <Section title={isSol ? 'Gezegenler' : 'Onaylı gezegenler'}>
          <div className="-mx-1.5 space-y-0.5">
            {planets.map((p) => (
              <PlanetListItem key={p.id} planet={p} onClick={() => store().openSystem(systemIndex, p.index)} />
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────── system + planet

function HabitableZoneNote({ system }: { system: SystemRecord }) {
  const hz = system.hz
  return (
    <div className="mt-2.5 flex items-start gap-2.5 rounded-xl border border-hz/20 bg-hz/[0.06] px-3 py-2.5">
      <span className="mt-0.5 text-hz">
        <LeafIcon size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium text-hz/90">Yaşanabilir bölge</div>
        {hz ? (
          <>
            <div className="font-display text-[14px] font-medium tabular-nums text-ink">
              {sig(hz[1], 3)} – {sig(hz[2], 3)} AU
            </div>
            <div className="text-[11.5px] tabular-nums text-muted">
              iyimser sınırlar: {sig(hz[0], 3)} – {sig(hz[3], 3)} AU
            </div>
            {system.hzExtrap && (
              <div className="mt-1 text-[11px] leading-snug text-faint">Yıldız sıcaklığı modelin 2.600–7.200 K aralığı dışında; sınırlar yaklaşık.</div>
            )}
          </>
        ) : (
          <div className="text-[12px] text-muted">Yıldızın ışıtması bilinmediği için hesaplanamadı.</div>
        )}
      </div>
    </div>
  )
}

/** Compact planet picker for the system view: one chip per planet, innermost first. */
function PlanetChips({ planets, selected }: { planets: PlanetRow[]; selected: number | null }) {
  const hovered = useAtlas((s) => s.hoverPlanet)
  return (
    <div className="flex flex-wrap gap-1.5">
      {planets.map((p) => {
        const active = p.index === selected
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={active}
            title={p.name}
            onClick={() => useAtlas.getState().selectPlanet(active ? null : p.index)}
            onMouseEnter={() => useAtlas.getState().setHoverPlanet(p.index)}
            onMouseLeave={() => useAtlas.getState().setHoverPlanet(null)}
            className={cx(
              'inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-lg border px-2.5 font-display text-[13px] font-semibold transition-colors duration-150',
              active
                ? 'border-transparent bg-ink text-[#0b0e18]'
                : p.index === hovered
                  ? 'border-line-strong bg-white/10 text-ink'
                  : 'border-line bg-white/[0.03] text-ink/85 hover:border-line-strong hover:bg-white/8',
            )}
          >
            {p.hz !== HZ_NONE && <span className={cx('size-1.5 rounded-full', p.hz === HZ_CONSERVATIVE ? 'bg-hz' : 'border border-hz')} />}
            {p.letter || p.name}
          </button>
        )
      })}
    </div>
  )
}

function PlanetCard({ atlas, planet }: { atlas: Atlas; planet: PlanetRow }) {
  const cls = planetClass(planet.radius, planet.mass)
  const radius = planet.radius ?? (planet.mass != null ? radiusFromMass(planet.mass) : null)
  const massNote = planet.massProv === 'Msini' ? 'M·sin i (alt sınır)' : planet.massProv === 'M-R relationship' ? 'kütle–yarıçap bağıntısından' : undefined
  const discovery = [planet.year, planet.method >= 0 ? methodLabel(atlas.methods[planet.method]) : null].filter(Boolean).join(' · ')
  const facility = planet.fac != null ? atlas.facilities[planet.fac] : null

  return (
    <div className="animate-rise rounded-xl border border-line-strong bg-white/[0.035] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate font-display text-[16px] font-semibold text-white">{planet.name}</h4>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge tone="muted">{PLANET_CLASS_LABEL[cls]}</Badge>
            {planet.hz === HZ_CONSERVATIVE && (
              <Badge tone="hz" title="Yörüngesi muhafazakâr yaşanabilir bölgenin içinde (kaçak sera – azami sera sınırları).">
                <LeafIcon size={11} /> Yaşanabilir bölgede
              </Badge>
            )}
            {planet.hz === HZ_OPTIMISTIC && (
              <Badge tone="hz" title="Yalnızca iyimser sınırların (yakın-geçmiş Venüs – erken Mars) içinde.">
                <LeafIcon size={11} /> İyimser HZ’de
              </Badge>
            )}
            {planet.controversial && (
              <Badge tone="danger" title="Arşivde varlığı tartışmalı olarak işaretlenmiş.">
                Tartışmalı
              </Badge>
            )}
          </div>
        </div>
        <div className="-mt-1 -mr-1 flex shrink-0">
          <FavoriteButton id={planetKey(planet)} />
          <IconButton label="Bağlantıyı kopyala" tip="bottom" onClick={() => void copyShareLink()}>
            <LinkIcon size={16} />
          </IconButton>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
        <Stat label="Yarıçap" hint={planet.radius != null ? `${sig(planet.radius / 11.21, 3)} Jüpiter yarıçapı` : 'Ölçülmemiş'}>
          {planet.radius != null ? `${sig(planet.radius, 3)} R⊕` : radius != null ? <span className="text-muted">{approx(`${sig(radius, 2)} R⊕`)}</span> : DASH}
        </Stat>
        <Stat label="Kütle" hint={massNote ?? (planet.mass != null ? `${sig(planet.mass / 317.8, 3)} Jüpiter kütlesi` : 'Ölçülmemiş')}>
          {planet.mass != null ? `${planet.massProv === 'Msini' ? '≥ ' : ''}${sig(planet.mass, 3)} M⊕` : DASH}
        </Stat>
        <Stat label="Yörünge periyodu" hint={planet.period != null ? `${sig(planet.period, 6)} gün` : undefined}>
          {formatPeriod(planet.period)}
        </Stat>
        <Stat label="Yarı-büyük eksen" hint={planet.aEst ? 'Periyot ve yıldız kütlesinden Kepler\'in 3. yasasıyla hesaplandı.' : undefined}>
          {planet.a != null ? `${planet.aEst ? '≈ ' : ''}${sig(planet.a, 3)} AU` : DASH}
        </Stat>
        <Stat label="Denge sıcaklığı" hint={planet.eqt != null ? `${fixed(planet.eqt - 273.15, 0)} °C` : undefined}>
          {planet.eqt != null ? `${fixed(planet.eqt, 0)} K` : DASH}
        </Stat>
        <Stat label="Aldığı ışınım" hint="Dünya'nın Güneş'ten aldığı ışınım = 1">
          {planet.insol != null ? `${sig(planet.insol, 3)} S⊕` : DASH}
        </Stat>
        <Stat label="Dış merkezlik">{planet.ecc != null ? sig(planet.ecc, 2) : DASH}</Stat>
        <Stat label="Keşif" hint={facility ?? undefined}>
          {discovery || DASH}
        </Stat>
      </dl>

      {radius != null && (
        <div className="mt-3 flex items-end justify-between gap-3 border-t border-line pt-3">
          <SizeComparison name={planet.name} radius={radius} estimated={planet.radius == null} />
          <p className="max-w-[118px] pb-1 text-right text-[10.5px] leading-snug text-faint">
            {planet.radius == null ? 'Yarıçap kütleden tahmin edildi.' : 'Gerçek oranlarla.'}
          </p>
        </div>
      )}
      {planet.a == null && planet.period == null && (
        <p className="mt-3 rounded-lg bg-white/5 px-2.5 py-2 text-[11.5px] text-muted">Yörüngesi bilinmediği için sahnede çizilmiyor.</p>
      )}
    </div>
  )
}

function SystemDetail({ atlas, systemIndex }: { atlas: Atlas; systemIndex: number }) {
  const unit = useAtlas((s) => s.unit)
  const selected = useAtlas((s) => s.selectedPlanet)
  const store = useAtlas.getState
  const system = atlas.systems[systemIndex]
  const start = atlas.planetStart[systemIndex]
  const planets = useMemo(() => atlas.planets.slice(start, start + system.planets.length), [atlas, start, system])
  const solar = atlas.systems[atlas.solSystem]
  const solarPlanets = useMemo(() => {
    const s = atlas.planetStart[atlas.solSystem]
    return atlas.planets.slice(s, s + solar.planets.length)
  }, [atlas, solar])
  const planet = selected !== null && selected >= start && selected < start + planets.length ? atlas.planets[selected] : null

  const title = system.builtin ? 'Güneş Sistemi' : system.host
  const subtitle = [
    `${planets.length} gezegen`,
    system.builtin ? 'evimiz' : system.dist != null ? formatDistance(system.dist, unit) : 'uzaklık bilinmiyor',
    system.snum > 1 ? `${system.snum} yıldızlı` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="animate-rise">
      <header className="p-4 pb-3">
        <button
          type="button"
          onClick={() => store().exitSystem()}
          className="-ml-1 mb-2 inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-white/8 hover:text-ink"
        >
          <ArrowLeftIcon size={14} /> Yıldız haritası
        </button>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-[19px] leading-tight font-semibold text-white">{title}</h2>
            <p className="mt-0.5 truncate text-[12.5px] text-muted">{subtitle}</p>
          </div>
          {!planet && (
            <div className="-mt-1 -mr-1.5 flex shrink-0">
              {system.star >= 0 && <FavoriteButton id={starKey(atlas, system.star)} />}
              <IconButton label="Bağlantıyı kopyala" tip="bottom" onClick={() => void copyShareLink()}>
                <LinkIcon size={16} />
              </IconButton>
            </div>
          )}
        </div>
        {(system.circumbinary || system.star < 0) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {system.circumbinary && <Badge tone="accent" title="Gezegen iki yıldızın ortak kütle merkezi etrafında dolanıyor; sahnede tek yıldız çizilir.">Çift yıldız etrafında</Badge>}
            {system.star < 0 && <Badge tone="muted" title="Arşivde uzaklık değeri olmadığından yıldız 3B haritaya yerleştirilemiyor.">Haritada konumu yok</Badge>}
          </div>
        )}
      </header>

      <div className="px-4 pb-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-line bg-black/20 p-3">
          <Stat label="Yıldız sıcaklığı">{system.teff != null ? `${fixed(system.teff, 0)} K` : DASH}</Stat>
          <Stat label="Işıtma" hint={system.lumSrc === 'mass' ? 'Kütle–ışıtma bağıntısından tahmin' : system.lumSrc === 'rt' ? 'Yarıçap ve sıcaklıktan hesaplandı' : undefined}>
            {system.lum != null ? `${system.lumSrc === 'cat' ? '' : '≈ '}${sig(system.lum, 2)} L☉` : DASH}
          </Stat>
          <Stat label="Yarıçap">{system.rad != null ? `${sig(system.rad, 2)} R☉` : DASH}</Stat>
          <Stat label="Kütle">{system.mass != null ? `${sig(system.mass, 2)} M☉` : DASH}</Stat>
        </dl>
        <HabitableZoneNote system={system} />
      </div>

      <Section
        title="Gezegenler"
        aside={<span className="text-[11px] text-faint">{planet ? 'içten dışa' : 'birini seçin'}</span>}
      >
        <PlanetChips planets={planets} selected={planet ? planet.index : null} />
        {planet ? (
          <div className="mt-3">
            <PlanetCard key={planet.id} atlas={atlas} planet={planet} />
          </div>
        ) : (
          <p className="mt-2.5 text-[12px] leading-relaxed text-muted">
            Ölçülen değerlerini görmek için bir gezegen seçin — buradan ya da sahnede üzerine tıklayarak.
          </p>
        )}
      </Section>

      {!system.builtin && planets.some((p) => p.a != null) && (
        <Section title="Güneş Sistemi ile karşılaştır">
          <CompareWidget system={system} planets={planets} solar={solar} solarPlanets={solarPlanets} />
        </Section>
      )}

      <p className="border-t border-line px-4 py-3 text-[11px] leading-relaxed text-faint">
        Sahnede uzaklıklar √ ölçeğindedir, gezegen küreleri görünürlük için büyütülmüştür. Yörünge yönelimleri ve gezegen görünümleri
        temsilidir; ölçülen değerler bu paneldedir.
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────── shell

/** Left-hand card: what is selected right now — a star, a system with its planets, or a welcome. */
export function DetailPanel({ atlas }: { atlas: Atlas }) {
  const mode = useAtlas((s) => s.mode)
  const systemIndex = useAtlas((s) => s.systemIndex)
  const selectedStar = useAtlas((s) => s.selectedStar)
  // On phones the panel is a bottom sheet that can be folded down to its title.
  const [collapsed, setCollapsed] = useState(false)
  const subject = mode === 'system' && systemIndex !== null ? `system-${systemIndex}` : selectedStar !== null ? `star-${selectedStar}` : 'welcome'
  useEffect(() => setCollapsed(false), [subject])

  let content: ReactNode
  let title: string
  if (mode === 'system' && systemIndex !== null) {
    content = <SystemDetail key={subject} atlas={atlas} systemIndex={systemIndex} />
    title = atlas.systems[systemIndex].builtin ? 'Güneş Sistemi' : atlas.systems[systemIndex].host
  } else if (selectedStar !== null) {
    content = <StarDetail key={subject} atlas={atlas} star={selectedStar} />
    title = atlas.names[selectedStar]
  } else {
    content = <Welcome atlas={atlas} />
    title = 'Keşfe başla'
  }

  return (
    <section
      aria-label="Seçim ayrıntıları"
      className="detail-panel glass pointer-events-auto absolute z-20 flex animate-slide-right flex-col overflow-hidden rounded-[18px]"
    >
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Paneli aç' : 'Paneli küçült'}
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full shrink-0 flex-col items-center gap-1.5 pt-2 pb-1 sm:hidden"
      >
        <span className="h-1 w-9 rounded-full bg-white/25" />
        {collapsed && <span className="max-w-full truncate px-4 pb-1.5 font-display text-[14px] font-semibold text-ink">{title}</span>}
      </button>
      <div className={cx('min-h-0 overflow-y-auto overscroll-contain', collapsed && 'max-sm:hidden')}>{content}</div>
    </section>
  )
}
