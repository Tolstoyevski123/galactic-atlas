import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BASE_CELL, tileCorners, tilesInField, tileUrl, toTangent } from '../lib/hips'
import { cx, IconButton, Segmented } from '../ui/controls'
import { ZoomInIcon, ZoomOutIcon } from '../ui/icons'

/**
 * Real photographs for the detail panel.
 *
 * Stars: the Digitized Sky Survey — photographic plates of the whole sky taken with the Palomar
 * and UK Schmidt telescopes, digitised at STScI under a NASA grant. Its colour composite is served
 * as HiPS tiles by NASA/IPAC's Infrared Science Archive; a few tiles around the star are stitched
 * here into a north-up picture. If the tiles cannot be had, the single-band scan from STScI's own
 * archive (MAST) stands in.
 *
 * The Sun: today's image from NASA's Solar Dynamics Observatory.
 */

const DSS_COLOR = 'https://irsa.ipac.caltech.edu/data/hips/CDS/DSS2/color'
const DSS_MAX_ORDER = 9
const TILE = 512
const WIDTH = 640
const HEIGHT = 400
const ARCMIN = Math.PI / 180 / 60

/** Field widths on offer, arcminutes. */
const FIELDS = [4, 8, 15, 30, 60, 120]

/** Bright stars bloom across the plate, so they start with a wider field. */
function defaultField(mag: number): number {
  if (!Number.isFinite(mag)) return 1
  if (mag < -1) return 5
  if (mag < 1) return 4
  if (mag < 3) return 3
  if (mag < 6) return 2
  return 1
}

const fieldLabel = (arcmin: number): string => (arcmin >= 60 ? `${arcmin / 60}°` : `${arcmin}′`)

/** Load one tile; a single hiccup on the way is retried once before giving up. */
function loadImage(url: string, attempt = 0): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => {
      if (attempt > 0) reject(new Error(url))
      else window.setTimeout(() => loadImage(url, 1).then(resolve, reject), 700)
    }
    image.src = url
  })
}

/** Stitch the survey tiles covering the field into `canvas`: north up, east to the left. */
async function drawField(canvas: HTMLCanvasElement, ra: number, dec: number, fieldArcmin: number, isCurrent: () => boolean): Promise<void> {
  const width = fieldArcmin * ARCMIN
  const height = (width * HEIGHT) / WIDTH
  // Sharpest order that the picture can actually show (a little upscaling is fine).
  const wanted = (width / WIDTH) * 1.5
  let order = DSS_MAX_ORDER
  while (order > 1 && BASE_CELL / 2 ** (order - 1) / TILE <= wanted) order--

  const cells = tilesInField(order, ra, dec, width, height)
  const images = await Promise.all(cells.map((cell) => loadImage(tileUrl(DSS_COLOR, cell))))
  if (!isCurrent()) return

  const context = canvas.getContext('2d')
  if (!context) throw new Error('2d context')
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.fillStyle = '#000'
  context.fillRect(0, 0, WIDTH, HEIGHT)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  const scale = WIDTH / 2 / Math.tan(width / 2)
  cells.forEach((cell, index) => {
    const corners = tileCorners(cell).map((corner) => {
      const t = toTangent(corner.ra, corner.dec, ra, dec)
      return t ? { x: WIDTH / 2 - t.xi * scale, y: HEIGHT / 2 - t.eta * scale } : null
    })
    if (corners.some((c) => c === null)) return
    const [p00, p10, p01, p11] = corners as Array<{ x: number; y: number }>
    // A tile this small is a parallelogram on the tangent plane to well under a pixel:
    // fit one through the four corners and let the canvas do the resampling.
    const k = (1 + 1.2 / TILE) / TILE // a hair of overlap hides the seams between tiles
    const ax = ((p10.x - p00.x + p11.x - p01.x) / 2) * k
    const ay = ((p10.y - p00.y + p11.y - p01.y) / 2) * k
    const bx = ((p01.x - p00.x + p11.x - p10.x) / 2) * k
    const by = ((p01.y - p00.y + p11.y - p10.y) / 2) * k
    const cx0 = (p00.x + p10.x + p01.x + p11.x) / 4
    const cy0 = (p00.y + p10.y + p01.y + p11.y) / 4
    context.setTransform(ax, ay, bx, by, cx0 - (ax + bx) * (TILE / 2), cy0 - (ay + by) * (TILE / 2))
    context.drawImage(images[index], 0, 0)
  })
  context.setTransform(1, 0, 0, 1, 0, 0)
}

type Status = 'loading' | 'tiles' | 'scan' | 'failed'

function Frame({ children, busy }: { children: ReactNode; busy?: boolean }) {
  return (
    <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl border border-line bg-black">
      {children}
      {busy && <div className="photo-shimmer absolute inset-0" aria-hidden="true" />}
    </div>
  )
}

interface StarPhotoProps {
  name: string
  /** ICRS, degrees. */
  raDeg: number
  decDeg: number
  /** Apparent magnitude, for the starting field of view. */
  mag: number
  /** Distance in parsec: the nearest stars have drifted visibly since the plates were taken. */
  dist: number
}

export function StarPhoto({ name, raDeg, decDeg, mag, dist }: StarPhotoProps) {
  const [field, setField] = useState(() => defaultField(mag))
  const [status, setStatus] = useState<Status>('loading')
  const canvas = useRef<HTMLCanvasElement>(null)
  const arcmin = FIELDS[field]

  useEffect(() => {
    let current = true
    setStatus((s) => (s === 'tiles' ? s : 'loading')) // while zooming, the previous picture stays up
    const target = canvas.current
    if (!target) return
    drawField(target, (raDeg * Math.PI) / 180, (decDeg * Math.PI) / 180, arcmin, () => current).then(
      () => current && setStatus('tiles'),
      () => current && setStatus('scan'),
    )
    return () => {
      current = false
    }
  }, [raDeg, decDeg, arcmin])

  // The single-band scan is served at about 1″ per pixel, so keep the request modest.
  const scanWidth = Math.min(arcmin, 14)
  const scan =
    'https://archive.stsci.edu/cgi-bin/dss_search?v=poss2ukstu_red&e=J2000&f=gif' +
    `&r=${raDeg.toFixed(5)}&d=${decDeg.toFixed(5)}&w=${scanWidth}&h=${((scanWidth * HEIGHT) / WIDTH).toFixed(2)}`
  const shown = status === 'scan' ? scanWidth : arcmin
  const fieldText = `${fieldLabel(shown)} × ${fieldLabel(Math.round(((shown * HEIGHT) / WIDTH) * 10) / 10)}`

  return (
    <figure className="m-0" data-photo={status}>
      <Frame busy={status === 'loading'}>
        <canvas
          ref={canvas}
          width={WIDTH}
          height={HEIGHT}
          role="img"
          aria-label={`${name}: Digitized Sky Survey fotoğrafı`}
          className={cx('absolute inset-0 size-full transition-opacity duration-500', status === 'tiles' ? 'opacity-100' : 'opacity-0')}
        />
        {status === 'scan' && (
          <img
            src={scan}
            alt={`${name}: Digitized Sky Survey fotoğrafı (kırmızı bant)`}
            className="absolute inset-0 size-full animate-fade object-cover"
            onError={() => setStatus('failed')}
          />
        )}
        {status === 'failed' ? (
          <p className="absolute inset-0 grid place-items-center px-6 text-center text-[12px] leading-relaxed text-muted">
            Gökyüzü taraması şu an yanıt vermiyor. Bağlantınızı kontrol edip yeniden deneyin.
          </p>
        ) : (
          status !== 'loading' && (
            <>
              {/* The star is at the centre: four ticks point at it without covering it. */}
              <span className="photo-ticks" aria-hidden="true" />
              <span className="absolute bottom-1.5 left-2 text-[10px] font-medium tracking-wide text-white/70 [text-shadow:0_0_4px_#000]" aria-hidden="true">
                K ↑ · D ←
              </span>
            </>
          )
        )}
        <div className="absolute top-1.5 right-1.5 flex gap-1">
          <IconButton label="Yakınlaş" tip="bottom" size="sm" className="bg-black/55 backdrop-blur-sm" disabled={field === 0} onClick={() => setField(field - 1)}>
            <ZoomInIcon size={14} />
          </IconButton>
          <IconButton label="Uzaklaş" tip="bottom" size="sm" className="bg-black/55 backdrop-blur-sm" disabled={field === FIELDS.length - 1} onClick={() => setField(field + 1)}>
            <ZoomOutIcon size={14} />
          </IconButton>
        </div>
      </Frame>
      <figcaption className="mt-1.5 flex items-baseline justify-between gap-3 text-[10.5px] leading-snug text-faint">
        <span>
          <a href="https://archive.stsci.edu/dss/" target="_blank" rel="noreferrer" className="text-muted underline-offset-2 hover:text-ink hover:underline">
            Digitized Sky Survey
          </a>{' '}
          · STScI/NASA{status === 'scan' ? ' · kırmızı bant' : ''}
        </span>
        <span className="shrink-0 tabular-nums" title="Görüş alanı (genişlik × yükseklik)">
          {fieldText}
        </span>
      </figcaption>
      {dist < 8 && status !== 'failed' && (
        <p className="mt-1.5 text-[10.5px] leading-snug text-faint">
          Bu kadar yakın yıldızlar gökyüzünde gözle izlenecek hızda kayar: plakalar 1980–90’larda çekildiği için yıldız, işaretin biraz
          dışında görünebilir.
        </p>
      )}
    </figure>
  )
}

const SDO = 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_'
const SUN_VIEWS = [
  { value: 'HMIIC', label: 'Görünür ışık', title: 'Işıkküre ve güneş lekeleri (HMI, renklendirilmiş)' },
  { value: '0171', label: '171 Å', title: 'Aşırı morötesi: taç ilmekleri, yaklaşık 600.000 K' },
  { value: '0304', label: '304 Å', title: 'Aşırı morötesi: renkküre ve fışkırmalar, yaklaşık 50.000 K' },
] as const

/** The Sun as NASA's Solar Dynamics Observatory sees it right now. */
export function SunPhoto() {
  const [channel, setChannel] = useState<(typeof SUN_VIEWS)[number]['value']>('HMIIC')
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  useEffect(() => setStatus('loading'), [channel])
  return (
    <figure className="m-0" data-photo={status}>
      <Frame busy={status === 'loading'}>
        {status === 'failed' ? (
          <p className="absolute inset-0 grid place-items-center px-6 text-center text-[12px] leading-relaxed text-muted">
            Güneş gözlemevi şu an yanıt vermiyor. Bağlantınızı kontrol edip yeniden deneyin.
          </p>
        ) : (
          <img
            key={channel}
            src={`${SDO}${channel}.jpg`}
            alt="Güneş'in güncel görüntüsü (NASA SDO)"
            className={cx('absolute inset-0 size-full object-contain transition-opacity duration-500', status === 'ready' ? 'opacity-100' : 'opacity-0')}
            onLoad={() => setStatus('ready')}
            onError={() => setStatus('failed')}
          />
        )}
      </Frame>
      <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-[10.5px] leading-snug text-faint">
        <Segmented label="Dalga boyu" size="sm" value={channel} onChange={setChannel} options={[...SUN_VIEWS]} />
        <span>
          <a href="https://sdo.gsfc.nasa.gov/data/" target="_blank" rel="noreferrer" className="text-muted underline-offset-2 hover:text-ink hover:underline">
            NASA SDO
          </a>{' '}
          · en güncel görüntü
        </span>
      </figcaption>
    </figure>
  )
}
