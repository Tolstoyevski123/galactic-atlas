import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { Atlas } from '../data/atlas'
import { discoveryOf, isDiscovered } from '../lib/discovery'
import { useAtlas } from '../store/useAtlas'
import { ScreenProjector } from './project'
import type { FilterMask } from './useFilterMask'
import { effectiveMagnitude, hostMarkerRadius, originExclusion, starAlpha, starSize, view } from './view'

/** Stars fainter than this on screen cannot be picked: you should not be able to click what you cannot see. */
const MIN_PICK_ALPHA = 0.14

/** A pre-filtered list of stars worth testing, so hovering does not scan the whole catalogue. */
export interface PickSubset {
  list: Int32Array
  count: number
}

/**
 * Where star `i` is drawn, for everything that has to agree with the shaders (picking, labels).
 * Writes the point to project into `out` and returns the distance that sets its brightness:
 *   - on the map: its position at the time machine's date, and the distance from the camera;
 *   - in sky mode: a point far along its direction as seen from view.origin, and the distance
 *     from that origin. Returns −1 for the star being stood on, which is not part of its own sky.
 */
export function drawnPosition(atlas: Atlas, i: number, out: Vector3): number {
  const k = i * 3
  const t = view.epoch
  const x = atlas.pos[k] + atlas.vel[k] * t
  const y = atlas.pos[k + 1] + atlas.vel[k + 1] * t
  const z = atlas.pos[k + 2] + atlas.vel[k + 2] * t
  if (!view.sky) {
    out.set(x, y, z)
    return Math.hypot(x - view.camera.x, y - view.camera.y, z - view.camera.z)
  }
  const dx = x - view.origin.x
  const dy = y - view.origin.y
  const dz = z - view.origin.z
  const d = Math.hypot(dx, dy, dz)
  if (d < originExclusion()) return -1
  const k2 = 1000 / d
  out.set(view.camera.x + dx * k2, view.camera.y + dy * k2, view.camera.z + dz * k2)
  return d
}

/** False while the discovery timeline hides this host (its first planet is not found yet). */
export function hostVisible(atlas: Atlas, star: number): boolean {
  if (!Number.isFinite(view.year)) return true
  const system = atlas.systemOfStar[star]
  if (system < 0) return true
  const first = discoveryOf(atlas).systemFirstYear[system]
  return first === 0 || isDiscovered(first, view.year)
}

const at = new Vector3()

/**
 * Screen-space picking. A ray against 113k points is the wrong tool across six orders of
 * magnitude of scale, so candidates are projected to pixels instead and the best one near the
 * pointer wins: host markers first, then any star that is actually visible on screen.
 */
export function pickStar(
  atlas: Atlas,
  projector: ScreenProjector,
  filter: FilterMask,
  px: number,
  py: number,
  subset?: PickSubset,
): number {
  const target = view.target
  // Filters belong to the map; a sky seen from a star is shown whole.
  const masked = filter.active && !view.sky ? filter.mask : null

  // 1. Hosts (their markers only exist on the map).
  let best = -1
  if (!view.sky) {
    let bestDistance = Infinity
    const hosts = atlas.hosts
    for (let k = 0; k < hosts.length; k++) {
      const i = hosts[k]
      if (masked && masked[i] === 0) continue
      if (!hostVisible(atlas, i)) continue
      const distance = drawnPosition(atlas, i, at)
      if (!projector.project(at.x, at.y, at.z)) continue
      const dx = projector.x - px
      const dy = projector.y - py
      if (dx > 40 || dx < -40 || dy > 40 || dy < -40) continue
      const d = Math.hypot(dx, dy)
      const radius = hostMarkerRadius(distance, view.markerRef, at.distanceTo(target), atlas.planetCount[i])
      // Reach a little past the marker; when several overlap, the one whose centre is nearest wins.
      if (d <= Math.min(radius, 16) + 5 && d < bestDistance) {
        best = i
        bestDistance = d
      }
    }
    if (best >= 0) return best
  }

  // 2. Any visible star: prefer the brightest one close to the pointer.
  let bestScore = -Infinity
  const n = subset ? subset.count : atlas.count
  for (let k = 0; k < n; k++) {
    const i = subset ? subset.list[k] : k
    if (masked && masked[i] === 0) continue
    const distance = drawnPosition(atlas, i, at)
    if (distance < 0) continue
    if (!projector.project(at.x, at.y, at.z)) continue
    const dx = projector.x - px
    const dy = projector.y - py
    if (dx > 16 || dx < -16 || dy > 16 || dy < -16) continue
    const m = effectiveMagnitude(atlas.absmag[i], distance, view.refDist)
    // The Sun is always pickable; everything else has to be visible.
    if (i !== 0 && starAlpha(m, view.limit) < MIN_PICK_ALPHA) continue
    const size = i === 0 ? Math.max(8, starSize(m, view.limit)) : starSize(m, view.limit)
    const d = Math.hypot(dx, dy)
    if (d > size * 0.55 + 4) continue
    const score = size - d * 0.6
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  }
  return best
}

/** Fill `out` with the stars currently bright enough to draw (plus the Sun); returns how many. */
function collectVisible(atlas: Atlas, reach: Float32Array, out: Int32Array, from: Vector3): number {
  const pos = atlas.pos
  const vel = atlas.vel
  const t = view.epoch
  // alpha ≥ MIN_PICK_ALPHA  ⇔  m ≤ a fixed magnitude; solve it once instead of per star.
  let faintest = view.limit
  while (starAlpha(faintest + 0.25, view.limit) >= MIN_PICK_ALPHA) faintest += 0.25
  faintest += 0.5 // slack, so a small camera move does not invalidate the list
  // m ≤ faintest  ⇔  d² ≤ d_ref² · 10^(0.4·(faintest − M)): no square root or logarithm per star.
  const scale = view.refDist * view.refDist * 10 ** (0.4 * faintest)
  let count = 0
  out[count++] = 0
  for (let i = 1, n = atlas.count; i < n; i++) {
    const k = i * 3
    const dx = pos[k] + vel[k] * t - from.x
    const dy = pos[k + 1] + vel[k + 1] * t - from.y
    const dz = pos[k + 2] + vel[k + 2] * t - from.z
    if (dx * dx + dy * dy + dz * dz <= scale * reach[i]) out[count++] = i
  }
  return count
}

interface Props {
  atlas: Atlas
  filter: FilterMask
}

/** Hover and click handling for the star map and for the sky seen from a star. */
export function Picker({ atlas, filter }: Props) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const projector = useRef(new ScreenProjector())
  const pointer = useRef({ x: 0, y: 0, inside: false, dirty: false, buttons: 0, lastPick: 0 })
  const filterRef = useRef(filter)
  filterRef.current = filter
  const subset = useRef({ list: new Int32Array(atlas.count), count: -1, from: new Vector3(), refDist: 0, epoch: 0, sky: false })
  /** 10^(−0.4·M) per star, computed once: how far away each star stays visible, up to a common factor. */
  const reach = useMemo(() => Float32Array.from(atlas.absmag, (m) => 10 ** (-0.4 * m)), [atlas])

  useEffect(() => {
    const element = gl.domElement
    const p = pointer.current
    let down: { x: number; y: number; time: number } | null = null

    const local = (event: PointerEvent | MouseEvent) => {
      const rect = element.getBoundingClientRect()
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }
    const pickable = () => useAtlas.getState().mode !== 'system'
    // Clicks are rare: scan everything, so the answer never depends on a cached list.
    const pickAt = (x: number, y: number): number => {
      if (!pickable()) return -1
      projector.current.update(camera, element.clientWidth, element.clientHeight)
      return pickStar(atlas, projector.current, filterRef.current, x, y)
    }

    const onMove = (event: PointerEvent) => {
      const { x, y } = local(event)
      p.x = x
      p.y = y
      p.inside = true
      p.buttons = event.buttons
      p.dirty = true
    }
    const onLeave = () => {
      p.inside = false
      useAtlas.getState().setHoverStar(null)
      element.style.cursor = ''
    }
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      down = { ...local(event), time: performance.now() }
    }
    const onUp = (event: PointerEvent) => {
      p.buttons = 0
      if (!down || event.button !== 0) return
      const { x, y } = local(event)
      const wasClick = Math.hypot(x - down.x, y - down.y) < 6 && performance.now() - down.time < 600
      down = null
      if (!wasClick) return
      const star = pickAt(x, y)
      const store = useAtlas.getState()
      if (store.mode === 'sky') store.pickSkyStar(star >= 0 ? star : null)
      else if (star >= 0) store.selectStar(star, { fly: true })
    }
    const onDoubleClick = (event: MouseEvent) => {
      const { x, y } = local(event)
      const star = pickAt(x, y)
      if (star < 0) return
      const store = useAtlas.getState()
      // In a star's sky, double-clicking another star goes to stand there instead.
      if (store.mode === 'sky') {
        store.openSky(star)
        return
      }
      const system = atlas.systemOfStar[star]
      if (system >= 0) store.openSystem(system)
    }

    element.addEventListener('pointermove', onMove)
    element.addEventListener('pointerleave', onLeave)
    element.addEventListener('pointerdown', onDown)
    element.addEventListener('pointerup', onUp)
    element.addEventListener('dblclick', onDoubleClick)
    return () => {
      element.removeEventListener('pointermove', onMove)
      element.removeEventListener('pointerleave', onLeave)
      element.removeEventListener('pointerdown', onDown)
      element.removeEventListener('pointerup', onUp)
      element.removeEventListener('dblclick', onDoubleClick)
      element.style.cursor = ''
    }
  }, [atlas, camera, gl])

  useFrame((state) => {
    const p = pointer.current
    if (!p.dirty || !p.inside || p.buttons !== 0) return
    const now = performance.now()
    if (now - p.lastPick < 40) return
    p.dirty = false
    p.lastPick = now
    const store = useAtlas.getState()
    if (store.mode === 'system') return

    // Refresh the shortlist of visible stars only after the viewpoint has really moved.
    const s = subset.current
    const from = view.sky ? view.origin : view.camera
    const moved = s.from.distanceTo(from) > 0.03 * Math.max(view.sky ? 1 : view.camera.distanceTo(view.target), 0.05)
    if (s.count < 0 || moved || s.sky !== view.sky || s.epoch !== view.epoch || Math.abs(s.refDist - view.refDist) > 0.02 * view.refDist) {
      s.count = collectVisible(atlas, reach, s.list, from)
      s.from.copy(from)
      s.refDist = view.refDist
      s.epoch = view.epoch
      s.sky = view.sky
    }

    projector.current.update(state.camera, state.size.width, state.size.height)
    const star = pickStar(atlas, projector.current, filterRef.current, p.x, p.y, s)
    store.setHoverStar(star >= 0 ? star : null)
    state.gl.domElement.style.cursor = star >= 0 ? 'pointer' : ''
  })

  return null
}
