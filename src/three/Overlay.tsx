import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Atlas } from '../data/atlas'
import { starColor } from '../lib/astro'
import { formatDistance } from '../lib/format'
import { useAtlas } from '../store/useAtlas'
import { ScreenProjector } from './project'
import type { FilterMask } from './useFilterMask'
import { effectiveMagnitude, hostMarkerRadius, starSize, view } from './view'

const POOL = 56
const MAX_HOST_LABELS = 16
const MAX_STAR_LABELS = 22
const SOL = 0

interface Slot {
  element: HTMLDivElement
  star: number
  kind: string
}

interface Candidate {
  star: number
  kind: 'selected' | 'sol' | 'host' | 'star'
  /** Larger = placed first. */
  priority: number
}

/**
 * HTML drawn over the canvas: star labels with level-of-detail and collision avoidance, the
 * selection and hover reticles, and the hover tooltip. Everything is positioned imperatively
 * from the render loop — React never re-renders while the camera moves.
 */
export function Overlay({ atlas, filter, container }: { atlas: Atlas; filter: FilterMask; container: RefObject<HTMLDivElement | null> }) {
  const projector = useRef(new ScreenProjector())
  const filterRef = useRef(filter)
  filterRef.current = filter
  const frame = useRef(0)
  /** What the previous frame looked at, to skip all DOM work while nothing changes. */
  const last = useRef({
    signature: NaN,
    selected: null as number | null,
    hovered: null as number | null,
    labels: true,
    mode: '',
    unit: '',
    filter: filter,
    still: 0,
  })

  /** Stars with a proper name: the only ones that get a label without being a host. */
  const named = useMemo(() => Int32Array.from(atlas.proper.keys()).filter((i) => i !== SOL), [atlas])

  const dom = useRef<{
    slots: Slot[]
    slotOf: Map<number, number>
    selected: HTMLDivElement
    hover: HTMLDivElement
    tip: HTMLDivElement
  } | null>(null)

  useEffect(() => {
    const root = container.current
    if (!root) return
    const make = (className: string) => {
      const el = document.createElement('div')
      el.className = className
      root.appendChild(el)
      return el
    }
    const slots: Slot[] = Array.from({ length: POOL }, () => ({ element: make('star-label'), star: -1, kind: '' }))
    const selected = make('reticle reticle--selected')
    selected.innerHTML = '<i></i>'
    const hover = make('reticle reticle--hover')
    const tip = make('star-tip')
    dom.current = { slots, slotOf: new Map(), selected, hover, tip }
    return () => {
      dom.current = null
      root.replaceChildren()
    }
  }, [container])

  useFrame((state) => {
    const d = dom.current
    if (!d) return
    const store = useAtlas.getState()
    const pos = atlas.pos
    const width = state.size.width
    const height = state.size.height
    const p = projector.current
    p.update(state.camera, width, height)
    const inMap = store.mode === 'map'
    const masked = filterRef.current.active ? filterRef.current.mask : null

    // Nothing moved and nothing was selected or hovered: leave the DOM alone this frame.
    const m = state.camera.matrixWorld.elements
    const q = state.camera.projectionMatrix.elements
    const signature =
      m[12] * 1.13 + m[13] * 2.17 + m[14] * 3.31 + m[0] * 5.7 + m[1] * 7.9 + m[2] * 11.3 + m[5] * 13.1 + m[6] * 17.9 + m[10] * 19.3 +
      q[0] * 23.1 + q[5] * 29.9 + q[8] * 31.7 + q[9] * 37.3 + width * 0.01 + height * 0.013
    const seen = last.current
    if (
      signature === seen.signature && store.selectedStar === seen.selected && store.hoverStar === seen.hovered &&
      store.showLabels === seen.labels && store.mode === seen.mode && store.unit === seen.unit && filterRef.current === seen.filter
    ) {
      seen.still++
      // Let label selection settle for a few frames after the last change, then idle.
      if (seen.still > 12) return
    } else {
      seen.signature = signature
      seen.selected = store.selectedStar
      seen.hovered = store.hoverStar
      seen.labels = store.showLabels
      seen.mode = store.mode
      seen.unit = store.unit
      seen.filter = filterRef.current
      seen.still = 0
    }

    /** Radius in px of the marker drawn at a star (0 unless it hosts planets or is the Sun). */
    const markerRadius = (star: number): number => {
      const rings = star === SOL ? 8 : atlas.planetCount[star]
      if (rings === 0) return 0
      const x = pos[star * 3]
      const y = pos[star * 3 + 1]
      const z = pos[star * 3 + 2]
      return hostMarkerRadius(
        Math.hypot(x - view.camera.x, y - view.camera.y, z - view.camera.z),
        view.markerRef,
        Math.hypot(x - view.target.x, y - view.target.y, z - view.target.z),
        rings,
      )
    }
    const place = (element: HTMLElement, star: number, dx = 0): boolean => {
      if (!p.project(pos[star * 3], pos[star * 3 + 1], pos[star * 3 + 2])) return false
      if (p.x < -40 || p.x > width + 40 || p.y < -40 || p.y > height + 40) return false
      const transform = `translate3d(${(p.x + dx).toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`
      if (element.style.transform !== transform) element.style.transform = transform
      return true
    }
    const show = (element: HTMLElement, visible: boolean) => {
      const value = visible ? '1' : '0'
      if (element.style.opacity !== value) element.style.opacity = value
    }
    /** Reticles wrap around the whole miniature system when there is one. */
    const resize = (element: HTMLElement, star: number, base: number): number => {
      const size = Math.max(base, Math.round(2 * markerRadius(star) + 12))
      const value = `${size}px`
      if (element.style.getPropertyValue('--size') !== value) element.style.setProperty('--size', value)
      return size
    }

    // ── Reticles and tooltip follow their stars every frame.
    const selected = inMap ? store.selectedStar : null
    const hovered = inMap && store.hoverStar !== selected ? store.hoverStar : null
    let selectedSize = 34
    if (selected !== null && place(d.selected, selected)) {
      const isHost = atlas.planetCount[selected] > 0
      d.selected.classList.toggle('reticle--host', isHost)
      selectedSize = resize(d.selected, selected, 34)
      const [r, g, b] = starColor(atlas.ci[selected], 1.2)
      const tint = `rgb(${(r * 255) | 0} ${(g * 255) | 0} ${(b * 255) | 0})`
      if (d.selected.style.getPropertyValue('--star') !== tint) d.selected.style.setProperty('--star', tint)
      show(d.selected, true)
    } else show(d.selected, false)

    if (hovered !== null && place(d.hover, hovered)) {
      const hoverSize = resize(d.hover, hovered, 26)
      show(d.hover, true)
      place(d.tip, hovered, hoverSize / 2 - 13)
      const planets = atlas.planetCount[hovered]
      const text =
        hovered === SOL
          ? 'Güneş · Güneş Sistemi'
          : `${atlas.names[hovered]} · ${formatDistance(atlas.dist[hovered], store.unit)}` +
            (planets > 0 ? ` · ${planets} gezegen` : '')
      if (d.tip.textContent !== text) d.tip.textContent = text
      d.tip.classList.toggle('star-tip--host', planets > 0)
      show(d.tip, true)
    } else {
      show(d.hover, false)
      show(d.tip, false)
    }

    // Labels sit just outside whatever is drawn at the star: a bare point, a miniature system, or the reticle.
    const labelShift = (star: number, kind: string): number =>
      kind === 'selected' ? selectedSize / 2 - 17 : Math.max(0, markerRadius(star) - 5)

    // ── Labels: re-choose which stars are labelled a few times per second, move them every frame.
    frame.current++
    const showLabels = inMap && store.showLabels
    if (!showLabels) {
      for (const slot of d.slots) {
        if (slot.star >= 0) {
          show(slot.element, false)
          slot.star = -1
        }
      }
      d.slotOf.clear()
      return
    }

    if (frame.current % 6 === 1) {
      const cam = view.camera
      const target = view.target
      const camDist = cam.distanceTo(target)
      const candidates: Candidate[] = []
      if (selected !== null) candidates.push({ star: selected, kind: 'selected', priority: 1e9 })
      if (selected !== SOL) candidates.push({ star: SOL, kind: 'sol', priority: 1e8 })

      // Hosts nearest to what the camera is looking at.
      const reach = Math.max(camDist * 1.25, 6)
      const reach2 = reach * reach
      const nearest: Array<{ star: number; d2: number }> = []
      const hosts = atlas.hosts
      for (let k = 0; k < hosts.length; k++) {
        const i = hosts[k]
        if (i === selected || (masked && masked[i] === 0)) continue
        const dx = pos[i * 3] - target.x
        const dy = pos[i * 3 + 1] - target.y
        const dz = pos[i * 3 + 2] - target.z
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 > reach2) continue
        if (nearest.length === MAX_HOST_LABELS && d2 >= nearest[nearest.length - 1].d2) continue
        let at = nearest.length
        while (at > 0 && nearest[at - 1].d2 > d2) at--
        nearest.splice(at, 0, { star: i, d2 })
        if (nearest.length > MAX_HOST_LABELS) nearest.pop()
      }
      nearest.forEach((h, rank) => candidates.push({ star: h.star, kind: 'host', priority: 1e6 - rank }))

      // Named stars that currently look bright.
      const bright: Array<{ star: number; size: number }> = []
      for (let k = 0; k < named.length; k++) {
        const i = named[k]
        if (i === selected || atlas.planetCount[i] > 0 || (masked && masked[i] === 0)) continue
        const dist = Math.hypot(pos[i * 3] - cam.x, pos[i * 3 + 1] - cam.y, pos[i * 3 + 2] - cam.z)
        const size = starSize(effectiveMagnitude(atlas.absmag[i], dist, view.refDist), view.limit)
        if (size >= 4.6) bright.push({ star: i, size })
      }
      bright.sort((a, b) => b.size - a.size)
      for (const b of bright.slice(0, MAX_STAR_LABELS)) candidates.push({ star: b.star, kind: 'star', priority: b.size })

      // Greedy placement in priority order; skip anything that would overlap an earlier label.
      candidates.sort((a, b) => b.priority - a.priority)
      const boxes: Array<[number, number, number, number]> = []
      const wanted = new Map<number, Candidate['kind']>()
      for (const c of candidates) {
        if (wanted.size >= POOL) break
        const i = c.star
        if (!p.project(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])) continue
        const x0 = p.x + 9 + labelShift(i, c.kind)
        const y0 = p.y - 9
        const x1 = x0 + atlas.names[i].length * 6.4 + 10
        const y1 = y0 + 18
        if (x0 < 0 || x1 > width || y0 < 0 || y1 > height) continue
        let clear = true
        for (const box of boxes) {
          if (x0 < box[2] && x1 > box[0] && y0 < box[3] && y1 > box[1]) {
            clear = false
            break
          }
        }
        if (!clear && c.kind !== 'selected') continue
        boxes.push([x0, y0, x1, y1])
        wanted.set(i, c.kind)
      }

      // Reconcile with the pool, keeping existing labels in their slots.
      for (const slot of d.slots) {
        if (slot.star >= 0 && !wanted.has(slot.star)) {
          show(slot.element, false)
          d.slotOf.delete(slot.star)
          slot.star = -1
        }
      }
      for (const [star, kind] of wanted) {
        let index = d.slotOf.get(star)
        if (index === undefined) {
          index = d.slots.findIndex((s) => s.star < 0)
          if (index < 0) break
          d.slotOf.set(star, index)
          const slot = d.slots[index]
          slot.star = star
          slot.element.textContent = star === SOL ? 'Güneş' : atlas.names[star]
          slot.kind = ''
        }
        const slot = d.slots[index]
        if (slot.kind !== kind) {
          slot.kind = kind
          slot.element.className = `star-label star-label--${kind}`
        }
      }
    }

    for (const slot of d.slots) {
      if (slot.star < 0) continue
      show(slot.element, place(slot.element, slot.star, labelShift(slot.star, slot.kind)))
    }
  })

  return null
}
