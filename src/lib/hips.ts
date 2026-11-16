/**
 * Just enough HEALPix (nested scheme) and HiPS to find the sky-survey image tiles around a
 * position and to know where each tile's corners lie on the sky.
 *
 * A HiPS survey cuts the sky into HEALPix cells; at "order" k there are 12·4^k of them and each
 * is stored as one 512×512 image at  Norder{k}/Dir{⌊n/10000⌋·10000}/Npix{n}.jpg.
 * The formulas follow Górski et al. (2005) as implemented in the HEALPix C++ library.
 * All angles are radians.
 */

const JRLL = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]
const JPLL = [1, 3, 5, 7, 0, 2, 4, 6, 1, 3, 5, 7]
const HALF_PI = Math.PI / 2
const TWO_PI = Math.PI * 2

/** Angular width of one base cell: √(4π/12). A tile at order k spans this / 2^k. */
export const BASE_CELL = Math.sqrt(Math.PI / 3)

export interface HipsCell {
  order: number
  /** Base face, 0..11. */
  face: number
  /** Position inside the face, 0 .. 2^order − 1: x grows towards the north-east, y towards the north-west. */
  ix: number
  iy: number
}

/** The cell of the given order that contains a sky position. */
export function cellAt(order: number, ra: number, dec: number): HipsCell {
  const nside = 2 ** order
  const z = Math.sin(dec)
  const za = Math.abs(z)
  const tt = ((((ra % TWO_PI) + TWO_PI) % TWO_PI) / HALF_PI) % 4
  if (za <= 2 / 3) {
    const t1 = nside * (0.5 + tt)
    const t2 = nside * z * 0.75
    const jp = Math.floor(t1 - t2) // ascending edge line
    const jm = Math.floor(t1 + t2) // descending edge line
    const ifp = Math.floor(jp / nside)
    const ifm = Math.floor(jm / nside)
    const face = ifp === ifm ? (ifp & 3) | 4 : ifp < ifm ? ifp & 3 : (ifm & 3) + 8
    return { order, face, ix: jm & (nside - 1), iy: nside - (jp & (nside - 1)) - 1 }
  }
  const ntt = Math.min(3, Math.floor(tt))
  const tp = tt - ntt
  const tmp = nside * Math.sqrt(3 * (1 - za))
  const jp = Math.min(nside - 1, Math.floor(tp * tmp))
  const jm = Math.min(nside - 1, Math.floor((1 - tp) * tmp))
  return z >= 0 ? { order, face: ntt, ix: nside - jm - 1, iy: nside - jp - 1 } : { order, face: ntt + 8, ix: jp, iy: jm }
}

/** Interleave the low 16 bits of x with zeros: …b2 b1 b0 → …0 b2 0 b1 0 b0. */
function spread(x: number): number {
  let v = x & 0xffff
  v = (v | (v << 8)) & 0x00ff00ff
  v = (v | (v << 4)) & 0x0f0f0f0f
  v = (v | (v << 2)) & 0x33333333
  v = (v | (v << 1)) & 0x55555555
  return v
}

/** Nested pixel number of a cell (valid up to order 13, far beyond any tile order). */
export function cellNumber(cell: HipsCell): number {
  return cell.face * 4 ** cell.order + (spread(cell.ix) | (spread(cell.iy) << 1))
}

export function tileUrl(base: string, cell: HipsCell, extension = 'jpg'): string {
  const n = cellNumber(cell)
  return `${base}/Norder${cell.order}/Dir${Math.floor(n / 10000) * 10000}/Npix${n}.${extension}`
}

/** Sky position of the point (x, y) of a face, both 0..1. */
function faceToSky(face: number, x: number, y: number): { ra: number; dec: number } {
  const jr = JRLL[face] - x - y
  let nr: number
  let z: number
  if (jr < 1) {
    nr = jr
    z = 1 - (nr * nr) / 3
  } else if (jr > 3) {
    nr = 4 - jr
    z = (nr * nr) / 3 - 1
  } else {
    nr = 1
    z = ((2 - jr) * 2) / 3
  }
  let t = JPLL[face] * nr + x - y
  if (t < 0) t += 8
  if (t >= 8) t -= 8
  return { ra: nr < 1e-15 ? 0 : ((Math.PI / 4) * t) / nr, dec: Math.asin(Math.max(-1, Math.min(1, z))) }
}

/**
 * The four corners of a cell on the sky, in the order its tile image is laid out:
 * top-left, top-right, bottom-left, bottom-right of the stored picture. (HiPS stores a cell
 * transposed: image columns run along the cell's y axis and rows along its x axis, so the
 * picture's top-left is the cell's southern corner.)
 */
export function tileCorners(cell: HipsCell): Array<{ ra: number; dec: number }> {
  const nside = 2 ** cell.order
  const x0 = cell.ix / nside
  const x1 = (cell.ix + 1) / nside
  const y0 = cell.iy / nside
  const y1 = (cell.iy + 1) / nside
  return [faceToSky(cell.face, x0, y0), faceToSky(cell.face, x0, y1), faceToSky(cell.face, x1, y0), faceToSky(cell.face, x1, y1)]
}

/**
 * Gnomonic (tangent-plane) projection about a centre: the natural "photograph" projection.
 * Returns east (ξ) and north (η) offsets in radians of tangent-plane distance, or null for a
 * point more than 90° away.
 */
export function toTangent(ra: number, dec: number, ra0: number, dec0: number): { xi: number; eta: number } | null {
  const cosC = Math.sin(dec0) * Math.sin(dec) + Math.cos(dec0) * Math.cos(dec) * Math.cos(ra - ra0)
  if (cosC <= 1e-6) return null
  return {
    xi: (Math.cos(dec) * Math.sin(ra - ra0)) / cosC,
    eta: (Math.cos(dec0) * Math.sin(dec) - Math.sin(dec0) * Math.cos(dec) * Math.cos(ra - ra0)) / cosC,
  }
}

/** Inverse of toTangent. */
export function fromTangent(xi: number, eta: number, ra0: number, dec0: number): { ra: number; dec: number } {
  const rho = Math.hypot(xi, eta)
  if (rho < 1e-12) return { ra: ra0, dec: dec0 }
  const c = Math.atan(rho)
  const dec = Math.asin(Math.max(-1, Math.min(1, Math.cos(c) * Math.sin(dec0) + (eta * Math.sin(c) * Math.cos(dec0)) / rho)))
  const ra = ra0 + Math.atan2(xi * Math.sin(c), rho * Math.cos(dec0) * Math.cos(c) - eta * Math.sin(dec0) * Math.sin(c))
  return { ra, dec }
}

/** Every tile of `order` that a field of the given angular width and height (centred on ra0/dec0) touches. */
export function tilesInField(order: number, ra0: number, dec0: number, width: number, height: number): HipsCell[] {
  const halfW = Math.tan(width / 2)
  const halfH = Math.tan(height / 2)
  // Sample the field more finely than a tile is wide, so no tile slips between samples.
  const tile = BASE_CELL / 2 ** order
  const nx = Math.max(2, Math.ceil((width / tile) * 3) + 1)
  const ny = Math.max(2, Math.ceil((height / tile) * 3) + 1)
  const seen = new Map<number, HipsCell>()
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const sky = fromTangent(halfW * ((2 * i) / nx - 1), halfH * ((2 * j) / ny - 1), ra0, dec0)
      const cell = cellAt(order, sky.ra, sky.dec)
      seen.set(cellNumber(cell), cell)
    }
  }
  return [...seen.values()]
}
