import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Atlas } from '../data/atlas'
import { count } from '../lib/format'
import { retryAtlas } from '../store/bootstrap'
import { useAtlas, VEIL_MS } from '../store/useAtlas'
import { cx, IconButton } from '../ui/controls'
import { CloseIcon, InfoIcon, Logo, ResetIcon, TableIcon } from '../ui/icons'

/** Brand mark and catalogue size, top-left; opens the About dialog. */
export function TopBar({ atlas }: { atlas: Atlas }) {
  return (
    <div className="pointer-events-none absolute top-3 left-3 z-20 flex items-center gap-2">
      <button
        type="button"
        onClick={() => useAtlas.getState().setUi({ aboutOpen: true })}
        aria-label="Galaktik Atlas hakkında"
        className="glass group pointer-events-auto flex h-[52px] items-center gap-2.5 rounded-[16px] pr-3.5 pl-2.5 text-left transition-colors hover:border-line-strong"
      >
        <Logo size={32} />
        <span>
          <span className="block font-display text-[15px] leading-tight font-bold tracking-tight text-white">Galaktik Atlas</span>
          <span className="block text-[11px] tabular-nums text-muted">
            {count(atlas.count)} yıldız · {count(atlas.exoPlanetCount)} ötegezegen
          </span>
        </span>
        <span className="ml-1 text-faint transition-colors group-hover:text-ink">
          <InfoIcon size={15} />
        </span>
      </button>
    </div>
  )
}

/** Shown top-right while the data browser is closed. */
export function BrowserToggle() {
  return (
    <button
      type="button"
      onClick={() => useAtlas.getState().setUi({ browserOpen: true })}
      className="glass pointer-events-auto absolute top-3 right-3 z-20 inline-flex h-[52px] animate-fade items-center gap-2 rounded-[16px] px-4 text-[13px] font-semibold text-ink transition-colors hover:border-line-strong"
    >
      <TableIcon size={17} className="text-accent" />
      <span className="hidden sm:inline">Veri tarayıcısı</span>
    </button>
  )
}

/** Fade that hides the hand-over between the star map and a system. Sits above the canvas, below the panels. */
export function Veil() {
  const veil = useAtlas((s) => s.veil)
  return (
    <div
      aria-hidden="true"
      className={cx('pointer-events-none absolute inset-0 z-10 bg-space transition-opacity ease-in-out', veil ? 'opacity-100' : 'opacity-0')}
      style={{ transitionDuration: `${VEIL_MS}ms` }}
    />
  )
}

export function Toast() {
  const toast = useAtlas((s) => s.toast)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!toast) return
    setVisible(true)
    const timer = window.setTimeout(() => setVisible(false), 3400)
    return () => window.clearTimeout(timer)
  }, [toast])
  return (
    <div
      role="status"
      aria-live="polite"
      className={cx(
        'glass pointer-events-none absolute bottom-[72px] left-1/2 z-50 max-w-[min(92vw,420px)] -translate-x-1/2 rounded-xl px-3.5 py-2 text-center text-[12.5px] text-ink transition duration-300 ease-out-soft',
        visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
      )}
    >
      {toast?.text}
    </div>
  )
}

/** Full-screen cover while the catalogue downloads; also the error state. */
export function Loading() {
  const phase = useAtlas((s) => s.phase)
  const progress = useAtlas((s) => s.progress)
  const error = useAtlas((s) => s.error)
  // Keep the cover mounted through its fade-out.
  const [gone, setGone] = useState(false)
  useEffect(() => {
    if (phase !== 'ready') {
      setGone(false)
      return
    }
    const timer = window.setTimeout(() => setGone(true), 900)
    return () => window.clearTimeout(timer)
  }, [phase])
  if (gone) return null

  return (
    <div
      className={cx(
        'absolute inset-0 z-[60] grid place-items-center bg-space transition-opacity duration-700 ease-out',
        phase === 'ready' ? 'pointer-events-none opacity-0' : 'opacity-100',
      )}
    >
      <div className="flex w-[min(320px,80vw)] flex-col items-center text-center">
        <div className="relative grid size-24 place-items-center">
          <span className="absolute inset-0 animate-orbit rounded-full border border-white/10 border-t-accent/80" />
          <Logo size={58} />
        </div>
        <h1 className="mt-5 font-display text-[22px] font-bold tracking-tight text-white">Galaktik Atlas</h1>
        {phase === 'error' ? (
          <>
            <p className="mt-2 text-[13px] text-danger">Katalog yüklenemedi.</p>
            <p className="mt-1 text-[12.5px] text-muted">{error}</p>
            <p className="mt-1 text-[12px] text-faint">
              Veri dosyaları eksikse proje klasöründe <code className="rounded bg-white/8 px-1">npm run data</code> çalıştırın.
            </p>
            <button
              type="button"
              onClick={retryAtlas}
              className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong px-3.5 text-[13px] font-medium text-ink transition-colors hover:bg-white/8"
            >
              <ResetIcon size={14} /> Tekrar dene
            </button>
          </>
        ) : (
          <>
            <p className="mt-1.5 text-[13px] text-muted">Yıldız kataloğu yükleniyor…</p>
            <div
              role="progressbar"
              aria-label="Yükleme"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
              className="mt-5 h-[3px] w-full overflow-hidden rounded-full bg-white/8"
            >
              <div className="h-full rounded-full bg-gradient-to-r from-accent to-gold transition-[width] duration-300 ease-out" style={{ width: `${Math.max(4, progress * 100)}%` }} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Source({ name, href, children }: { name: string; href: string; children: ReactNode }) {
  return (
    <li className="rounded-xl border border-line bg-black/20 p-3">
      <a href={href} target="_blank" rel="noreferrer" className="font-display text-[13.5px] font-semibold text-accent underline-offset-2 hover:underline">
        {name}
      </a>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{children}</p>
    </li>
  )
}

/** What this is, where the data comes from, and what is real versus illustrative. */
export function About({ atlas }: { atlas: Atlas }) {
  const open = useAtlas((s) => s.aboutOpen)
  const close = () => useAtlas.getState().setUi({ aboutOpen: false })
  const closeButton = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (open) closeButton.current?.querySelector('button')?.focus()
  }, [open])
  if (!open) return null
  const stats = atlas.meta.stats
  const built = new Date(atlas.meta.generatedAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div className="absolute inset-0 z-[55] grid animate-fade place-items-center bg-black/70 p-4" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onClick={(e) => e.stopPropagation()}
        className="glass flex max-h-[min(88dvh,720px)] w-[min(600px,100%)] animate-rise flex-col overflow-hidden rounded-[20px]"
      >
        <header className="flex items-center gap-3 border-b border-line p-4">
          <Logo size={34} />
          <div className="min-w-0 flex-1">
            <h2 id="about-title" className="font-display text-[17px] font-bold text-white">
              Galaktik Atlas
            </h2>
            <p className="text-[12px] text-muted">3B yıldız ve ötegezegen kâşifi · veri: {built}</p>
          </div>
          <div ref={closeButton}>
            <IconButton label="Kapat" tip="none" onClick={close}>
              <CloseIcon size={17} />
            </IconButton>
          </div>
        </header>
        <div className="space-y-4 overflow-y-auto p-4 text-[13px] leading-relaxed text-ink/90">
          <p>
            Güneş çevresindeki <strong className="text-white">{count(atlas.count)}</strong> yıldızın gerçek konumları içinde uçun.{' '}
            <span className="font-medium text-gold">Altın işaretli</span> {count(atlas.hosts.length)} yıldızın onaylı gezegenleri var: birine dalın,
            yörüngeleri ve <span className="font-medium text-hz">yaşanabilir bölgeyi</span> görün.
          </p>

          <div>
            <h3 className="eyebrow mb-2">Veri kaynakları</h3>
            <ul className="space-y-2">
              <Source name="HYG Database v4.1 — astronexus" href="https://github.com/astronexus/HYG-Database">
                {count(stats.hygKept)} yıldızın konumu, parlaklığı, tayf tipi ve adları. Lisans: CC BY-SA 4.0. Uzaklığı ölçülememiş{' '}
                {count(stats.hygDroppedNoDistance)} yıldız 3B haritaya alınmadı.
              </Source>
              <Source name="NASA Exoplanet Archive — Planetary Systems Composite Parameters" href="https://exoplanetarchive.ipac.caltech.edu/">
                {count(atlas.exoPlanetCount)} onaylı gezegen ve yıldızlarının parametreleri (DOI 10.26133/NEA13). Bu çalışma, NASA’nın Ötegezegen
                Keşif Programı kapsamında Caltech tarafından işletilen NASA Exoplanet Archive’ı kullanmıştır.
              </Source>
              <Source name="Digitized Sky Survey — STScI / NASA" href="https://archive.stsci.edu/dss/">
                Yıldız panellerindeki gökyüzü fotoğrafları: Palomar ve UK Schmidt teleskoplarının fotoğraf plakaları, STScI’de NASA desteğiyle
                sayısallaştırıldı. Renkli bileşim CDS tarafından hazırlandı; NASA/IPAC IRSA üzerinden, seçtiğiniz yıldız için o an istenir.
              </Source>
              <Source name="NASA Science 3B modelleri ve Solar Dynamics Observatory" href="https://science.nasa.gov/3d-resources/">
                Güneş Sistemi’ndeki Güneş, gezegen ve Satürn halkası dokuları NASA’nın uzay aracı görüntülerinden derlediği haritalardır. Güneş
                panelindeki görüntü, SDO uydusunun en güncel karesidir.
              </Source>
              <Source name="Stellarium — takımyıldız çizgileri" href="https://github.com/Stellarium/stellarium/tree/master/skycultures/modern">
                88 takımyıldızın çubuk figürleri ("modern" gök kültürü). Lisans: CC BY-SA 4.0.
              </Source>
            </ul>
          </div>

          <div>
            <h3 className="eyebrow mb-2">Neyi nasıl gösteriyoruz</h3>
            <ul className="list-disc space-y-1.5 pl-4 text-[12.5px] text-muted marker:text-faint">
              <li>
                Yıldız parlaklığı fizikseldir: her yıldız, kameranın bulunduğu noktadan görüneceği kadirle çizilir. Yaklaştıkça parlar.
              </li>
              <li>
                HYG’de olmayan {count(stats.syntheticHosts)} gezegenli yıldız, NASA’nın sağ açıklık / dik açıklık / uzaklık değerlerinden haritaya eklendi.
              </li>
              <li>
                Yaşanabilir bölge Kopparapu ve ark. (2013, 2014) modeliyle hesaplanır: muhafazakâr (kaçak sera – azami sera) ve iyimser
                (yakın-geçmiş Venüs – erken Mars) sınırlar.
              </li>
              <li>
                Haritadaki altın halkalar o yıldızın gezegen yörüngeleridir: halka sayısı ve oranları gerçek, yörünge düzleminin eğimi
                ölçülmüşse gerçektir (geçiş yapan sistemler Güneş’ten bakınca kenardan görünür). Boyutları büyütülmüş, hızları sıkıştırılmıştır.
              </li>
              <li>
                Sistem görünümünde uzaklıklar √ ölçeğindedir; gezegen küreleri büyütülmüş, yörünge yönelimleri temsilidir. Güneş Sistemi’nin
                yüzeyleri gerçektir; ötegezegenlerin ise fotoğrafı yoktur — hiçbirinin yüzeyi bugüne dek görüntülenemedi — o yüzden küreleri
                ölçülen boyut ve sıcaklıktan üretilen temsillerdir.
              </li>
              <li>
                Yıldız fotoğraflarında parlak yıldızların çevresindeki hale ve haç, teleskop optiğinin ve fotoğraf plakasının izidir; yıldızın
                kendisi oradaki tek bir noktadır.
              </li>
              <li>
                Takımyıldız çizgileri yıldızların gerçek 3B konumları arasındadır: Güneş’in yanından tanıdık görünür, uzaklaştıkça yakın
                yıldızlardan başlayarak çözülürler.
              </li>
              <li>Samanyolu bandı katalog verisi değil, doğru yönlendirilmiş prosedürel bir arka plandır.</li>
            </ul>
          </div>

          <div>
            <h3 className="eyebrow mb-2">Kısayollar</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12.5px] text-muted">
              {[
                ['/', 'Aramaya odaklan'],
                ['Esc', 'Sistemden çık / seçimi kaldır'],
                ['H', 'Güneş’e dön'],
                ['Çift tık', 'Gezegenli yıldızın sistemine dal'],
                ['↑ ↓', 'Listede gezin (liste odaktayken)'],
              ].map(([key, action]) => (
                <div key={key} className="contents">
                  <dt>
                    <kbd className="rounded border border-line-strong bg-white/5 px-1.5 py-0.5 text-[11px] font-medium text-ink">{key}</kbd>
                  </dt>
                  <dd>{action}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </div>
  )
}
