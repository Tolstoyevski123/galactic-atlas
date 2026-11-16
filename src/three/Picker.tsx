import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { Atlas } from '../data/atlas'
import { useAtlas } from '../store/useAtlas'
import { ScreenProjector } from './project'
import type { FilterMask } from './useFilterMask'
import { effectiveMagnitude, hostMarkerRadius, starAlpha, starSize, view } from './view'

/** Stars fainter than this on screen cannot be picked: you should not be able to click what you cannot see. */
const MIN_PICK_ALPHA = 0.14

/** A pre-filtered list of stars worth testing, so hovering does not scan the whole catalogue. */
export interface PickSubset {
  list: Int32Array
  count: number
}

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
  const pos = atlas.pos
  const cam = view.camera
  const target = view.target
  const masked = filter.active ? filter.mask : null

  // 1. Hosts.
  let best = -1
  let bestDistance = Infinity
  const hosts = atlas.hosts
  for (let k = 0; k < hosts.length; k++) {
    const i = hosts[k]
    if (masked && masked[i] === 0) continue
    const x = pos[i * 3]
    const y = pos[i * 3 + 1]
    const z = pos[i * 3 + 2]
    if (!projector.project(x, y, z)) continue
    const dx = projector.x - px
    const dy = projector.y - py
    if (dx > 40 || dx < -40 || dy > 40 || dy < -40) continue
    const d = Math.hypot(dx, dy)
    const radius = hostMarkerRadius(
      Math.hypot(x - cam.x, y - cam.y, z - cam.z),
      view.markerRef,
      Math.hypot(x - target.x, y - target.y, z - target.z),
      atlas.planetCount[i],
    )
    // Reach a little past the marker; when several overlap, the one whose centre is nearest wins.
    if (d <= Math.min(radius, 16) + 5 && d < bestDistance) {
      best = i
      bestDistance = d
    }
  }
  if (best >= 0) return best

  // 2. Any visible star: prefer the brightest one close to the pointer.
  let bestScore = -Infinity
  const n = subset ? subset.count : atlas.count
  for (let k = 0; k < n; k++) {
    const i = subset ? subset.list[k] : k
    if (masked && masked[i] === 0) continue
    const x = pos[i * 3]
    const y = pos[i * 3 + 1]
    const z = pos[i * 3 + 2]
    if (!projector.project(x, y, z)) continue
    const dx = projector.x - px
    const dy = projector.y - py
    if (dx > 16 || dx < -16 || dy > 16 || dy < -16) continue
    const m = effectiveMagnitude(atlas.absmag[i], Math.hypot(x - cam.x, y - cam.y, z - cam.z), view.refDist)
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
function collectVisible(atlas: Atlas, reach: Float32Array, out: Int32Array): number {
  const pos = atlas.pos
  const cam = view.camera
  // alpha ≥ MIN_PICK_ALPHA  ⇔  m ≤ a fixed magnitude; solve it once instead of per star.
  let faintest = view.limit
  while (starAlpha(faintest + 0.25, view.limit) >= MIN_PICK_ALPHA) faintest += 0.25
  faintest += 0.5 // slack, so a small camera move does not invalidate the list
  // m ≤ faintest  ⇔  d² ≤ d_ref² · 10^(0.4·(faintest − M)): no square root or logarithm per star.
  const scale = view.refDist * view.refDist * 10 ** (0.4 * faintest)
  const cx = cam.x
  const cy = cam.y
  const cz = cam.z
  let count = 0
  out[count++] = 0
  for (let i = 1, n = atlas.count; i < n; i++) {
    const dx = pos[i * 3] - cx
    const dy = pos[i * 3 + 1] - cy
    const dz = pos[i * 3 + 2] - cz
    if (dx * dx + dy * dy + dz * dz <= scale * reach[i]) out[count++] = i
  }
  return count
}

interface Props {
  atlas: Atlas
  filter: FilterMask
}

/** Hover and click handling for the star map. */
export function Picker({ atlas, filter }: Props) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const projector = useRef(new ScreenProjector())
  const pointer = useRef({ x: 0, y: 0, inside: false, dirty: false, buttons: 0, lastPick: 0 })
  const filterRef = useRef(filter)
  filterRef.current = filter
  const subset = useRef({ list: new Int32Array(atlas.count), count: -1, camera: new Vector3(), refDist: 0 })
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
    // Clicks are rare: scan everything, so the answer never depends on a cached list.
    const pickAt = (x: number, y: number): number => {
      if (useAtlas.getState().mode !== 'map') return -1
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
      if (star >= 0) useAtlas.getState().selectStar(star, { fly: true })
    }
    const onDoubleClick = (event: MouseEvent) => {
      const { x, y } = local(event)
      const star = pickAt(x, y)
      if (star < 0) return
      const system = atlas.systemOfStar[star]
      if (system >= 0) useAtlas.getState().openSystem(system)
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
    if (store.mode !== 'map') return

    // Refresh the shortlist of visible stars only after the camera has really moved.
    const s = subset.current
    const moved = s.camera.distanceTo(view.camera) > 0.03 * Math.max(view.camera.distanceTo(view.target), 0.05)
    if (s.count < 0 || moved || Math.abs(s.refDist - view.refDist) > 0.02 * view.refDist) {
      s.count = collectVisible(atlas, reach, s.list)
      s.camera.copy(view.camera)
      s.refDist = view.refDist
    }

    projector.current.update(state.camera, state.size.width, state.size.height)
    const star = pickStar(atlas, projector.current, filterRef.current, p.x, p.y, s)
    store.setHoverStar(star >= 0 ? star : null)
    state.gl.domElement.style.cursor = star >= 0 ? 'pointer' : ''
  })

  return null
}
