import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { starPositionAt, type Atlas } from '../data/atlas'
import { constellationName } from '../data/constellations'
import { loadConstellations } from '../data/load'
import type { ConstellationFigure } from '../data/schema'
import { useAtlas } from '../store/useAtlas'
import { ScreenProjector } from './project'
import { originExclusion, view } from './view'

const vertexShader = /* glsl */ `
  attribute vec3 aOther;
  attribute vec3 aVel;
  attribute vec3 aOtherVel;
  attribute float aFigure;
  attribute float aNear;

  uniform float uSky;
  uniform vec3 uOrigin;
  uniform float uHide;
  uniform float uEpoch;
  uniform vec2 uIntact;
  uniform vec2 uViewport;
  uniform float uGap;
  uniform float uOpacity;
  uniform float uActive;
  uniform float uStray;

  varying float vAlpha;

  // Same two modes as the star field: real positions on the map, directions on a system's sky.
  vec4 place(vec3 p) {
    vec4 mv = uSky > 0.5 ? vec4(mat3(viewMatrix) * normalize(p - uOrigin), 1.0) : modelViewMatrix * vec4(p, 1.0);
    return projectionMatrix * mv;
  }

  void main() {
    // Both ends move with the time machine, exactly like the stars they join.
    vec3 from = position + aVel * uEpoch;
    vec3 to = aOther + aOtherVel * uEpoch;
    if (uSky > 0.5 && (distance(from, uOrigin) < uHide || distance(to, uOrigin) < uHide)) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // a line to the star we are standing at has no direction
      return;
    }
    vec4 here = place(from);
    vec4 there = place(to);
    // Stop a few pixels short of each star, as on a printed chart, so lines never run through a star's glow.
    if (here.w > 0.0 && there.w > 0.0) {
      vec2 a = here.xy / here.w * uViewport * 0.5;
      vec2 b = there.xy / there.w * uViewport * 0.5;
      float len = length(b - a);
      if (len > 1e-3) {
        a += (b - a) / len * min(uGap, len * 0.3);
        here.xy = a / (uViewport * 0.5) * here.w;
      }
    }
    // A figure only looks like itself while its stars are much farther away than the viewpoint has
    // strayed from the Sun; nearer stars shift across the sky, so their lines bow out one by one.
    float intact = smoothstep(uIntact.x, uIntact.y, aNear / max(uStray, 1e-3));
    vAlpha = uOpacity * intact * (abs(aFigure - uActive) < 0.5 ? 1.9 : 1.0);
    gl_Position = here;
    // Pin to the far plane, like the stars: a backdrop that solid objects always cover.
    gl_Position.z = gl_Position.w * 0.99999;
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(uColor * vAlpha, 1.0);
  }
`

const MAX_LABELS = 12
/**
 * A figure fades between these ratios of "distance of its nearest star" to "how far the viewpoint
 * is from the Sun". On the map and behind a system only near-intact figures are kept. Standing at
 * a star the bending is the very thing to see, so figures stay until they are badly torn.
 */
const INTACT: [number, number] = [0.8, 2.6]
const INTACT_SKY: [number, number] = [0.3, 1.1]
const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

interface Props {
  atlas: Atlas
  /** Layer for the constellation names, underneath the star labels. */
  container: RefObject<HTMLDivElement | null>
}

/**
 * The 88 constellation stick figures, drawn as faint lines between the stars' real positions.
 * Seen from the Sun they are the familiar shapes; fly away and they stretch and fall apart, which
 * is the point — a constellation is a line of sight, not a place.
 */
export function Constellations({ atlas, container }: Props) {
  const show = useAtlas((s) => s.showConstellations)
  const [figures, setFigures] = useState<ConstellationFigure[] | null>(null)

  useEffect(() => {
    if (!show || figures) return
    let cancelled = false
    loadConstellations().then(
      (file) => !cancelled && setFigures(file.figures),
      () => !cancelled && useAtlas.getState().showToast('Takımyıldız çizgileri yüklenemedi.'),
    )
    return () => {
      cancelled = true
    }
  }, [show, figures])

  const built = useMemo(() => {
    if (!figures) return null
    const pos = atlas.pos
    const vel = atlas.vel
    const here: number[] = []
    const there: number[] = []
    const hereVel: number[] = []
    const thereVel: number[] = []
    const figure: number[] = []
    const near: number[] = []
    const memberLists: number[][] = []
    figures.forEach((f, index) => {
      const members = new Set<number>()
      for (const line of f.lines) {
        for (let k = 0; k < line.length; k++) {
          const a = line[k]
          if (a >= atlas.count) continue
          members.add(a)
          const b = line[k + 1]
          if (b === undefined || b >= atlas.count) continue
          // Each segment contributes two vertices; every vertex also knows the far end (for the gap).
          here.push(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2], pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2])
          there.push(pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2], pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2])
          hereVel.push(vel[a * 3], vel[a * 3 + 1], vel[a * 3 + 2], vel[b * 3], vel[b * 3 + 1], vel[b * 3 + 2])
          thereVel.push(vel[b * 3], vel[b * 3 + 1], vel[b * 3 + 2], vel[a * 3], vel[a * 3 + 1], vel[a * 3 + 2])
          figure.push(index, index)
          const nearest = Math.min(atlas.dist[a], atlas.dist[b])
          near.push(nearest, nearest)
        }
      }
      memberLists[index] = [...members]
    })

    // Name anchors: the middle of each figure as seen from the Sun, at its stars' typical distance.
    // They follow the stars through time, so they are recomputed whenever the date changes.
    const distances = new Float32Array(figures.length)
    const centroids = new Float32Array(figures.length * 3)
    const p = { x: 0, y: 0, z: 0 }
    const anchors = { epoch: NaN }
    const place = (epoch: number) => {
      if (anchors.epoch === epoch) return
      anchors.epoch = epoch
      memberLists.forEach((members, index) => {
        let x = 0
        let y = 0
        let z = 0
        let reach = 0
        for (const star of members) {
          starPositionAt(atlas, star, epoch, p)
          const d = Math.max(Math.hypot(p.x, p.y, p.z), 1e-6)
          x += p.x / d
          y += p.y / d
          z += p.z / d
          reach += Math.log(d)
        }
        const norm = Math.hypot(x, y, z) || 1
        const distance = Math.exp(reach / Math.max(1, members.length))
        centroids[index * 3] = (x / norm) * distance
        centroids[index * 3 + 1] = (y / norm) * distance
        centroids[index * 3 + 2] = (z / norm) * distance
        distances[index] = distance
      })
    }
    place(0)

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(here, 3))
    geometry.setAttribute('aOther', new THREE.Float32BufferAttribute(there, 3))
    geometry.setAttribute('aVel', new THREE.Float32BufferAttribute(hereVel, 3))
    geometry.setAttribute('aOtherVel', new THREE.Float32BufferAttribute(thereVel, 3))
    geometry.setAttribute('aFigure', new THREE.Float32BufferAttribute(figure, 1))
    geometry.setAttribute('aNear', new THREE.Float32BufferAttribute(near, 1))
    const indexOf = new Map(figures.map((f, index) => [f.abbr, index]))
    return { geometry, centroids, distances, place, indexOf, names: figures.map((f) => constellationName(f.abbr)) }
  }, [atlas, figures])
  useEffect(() => () => built?.geometry.dispose(), [built])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uSky: { value: 0 },
          uOrigin: { value: new THREE.Vector3() },
          uHide: { value: 1e-3 },
          uEpoch: { value: 0 },
          uIntact: { value: new THREE.Vector2(INTACT[0], INTACT[1]) },
          uViewport: { value: new THREE.Vector2(1, 1) },
          uGap: { value: 7 },
          uOpacity: { value: 0 },
          uActive: { value: -1 },
          uStray: { value: 0 },
          uColor: { value: new THREE.Color('#8fb4ee') },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])

  // ── Names: a small pool of HTML labels, positioned from the render loop.
  const labels = useRef<Array<{ element: HTMLDivElement; figure: number }>>([])
  useEffect(() => {
    const root = container.current
    if (!root) return
    labels.current = Array.from({ length: MAX_LABELS }, () => {
      const element = document.createElement('div')
      element.className = 'con-label'
      root.appendChild(element)
      return { element, figure: -1 }
    })
    return () => {
      labels.current = []
      root.replaceChildren()
    }
  }, [container])

  const projector = useRef(new ScreenProjector())
  const strength = useRef(0)
  const frame = useRef(0)

  useFrame((state, delta) => {
    const store = useAtlas.getState()
    const inSystem = store.mode === 'system'
    const inSky = store.mode === 'sky'
    const limits = inSky ? INTACT_SKY : INTACT
    // How far the viewpoint is from the Sun, parsec: the camera on the map, the star stood at otherwise.
    const stray = view.sky ? view.origin.length() : view.camera.length()
    const wanted = !show || !built ? 0 : inSystem ? 0.62 : inSky ? 0.95 : 1 - smoothstep(120, 420, stray)
    strength.current += (wanted - strength.current) * Math.min(1, delta * 5)
    if (Math.abs(wanted - strength.current) < 0.002) strength.current = wanted
    const visible = strength.current > 0.004

    const u = material.uniforms
    u.uOpacity.value = 0.3 * strength.current * view.dim
    u.uSky.value = view.sky ? 1 : 0
    ;(u.uOrigin.value as THREE.Vector3).copy(view.origin)
    u.uHide.value = originExclusion()
    u.uEpoch.value = view.epoch
    ;(u.uIntact.value as THREE.Vector2).set(limits[0], limits[1])
    ;(u.uViewport.value as THREE.Vector2).set(state.size.width, state.size.height)
    const selected = store.selectedStar
    // On the map the selected star's own constellation is picked out; from another star it has no such home.
    const active = built && selected !== null && store.mode === 'map' ? (built.indexOf.get(atlas.meta.constellations[atlas.con[selected]]) ?? -1) : -1
    u.uActive.value = active
    u.uStray.value = stray

    // ── Names.
    const pool = labels.current
    if (pool.length === 0) return
    const showNames = visible && built !== null && store.showLabels
    if (!showNames) {
      for (const slot of pool) {
        if (slot.figure >= 0) {
          slot.element.style.opacity = '0'
          slot.figure = -1
        }
      }
      return
    }
    const width = state.size.width
    const height = state.size.height
    const p = projector.current
    p.update(state.camera, width, height)
    const cam = state.camera.position
    built.place(view.epoch)
    const c = built.centroids
    const intact = (index: number): number => smoothstep(limits[0], limits[1], built.distances[index] / Math.max(stray, 1e-3))
    /** Screen position of figure `index`; false when it is behind the camera or off screen. */
    const locate = (index: number): boolean => {
      let x = c[index * 3]
      let y = c[index * 3 + 1]
      let z = c[index * 3 + 2]
      if (view.sky) {
        // On a system's sky only the direction from the host star matters.
        x -= view.origin.x
        y -= view.origin.y
        z -= view.origin.z
        const k = 1000 / (Math.hypot(x, y, z) || 1)
        x = cam.x + x * k
        y = cam.y + y * k
        z = cam.z + z * k
      }
      return p.project(x, y, z) && p.x > 40 && p.x < width - 40 && p.y > 30 && p.y < height - 30
    }

    // Re-choose which names are shown a few times per second: those nearest the middle of the free area.
    if (frame.current++ % 8 === 0) {
      const cx = (view.insetLeft + (width - view.insetRight)) / 2
      const cy = (height - view.insetBottom) / 2
      const ranked: Array<{ index: number; score: number }> = []
      for (let index = 0; index < built.names.length; index++) {
        if (intact(index) < 0.35 || !locate(index)) continue
        if (p.x < view.insetLeft || p.x > width - view.insetRight) continue
        ranked.push({ index, score: index === active ? -1 : Math.hypot(p.x - cx, p.y - cy) })
      }
      ranked.sort((a, b) => a.score - b.score)
      const keep = new Set(ranked.slice(0, MAX_LABELS).map((r) => r.index))
      for (const slot of pool) {
        if (slot.figure >= 0 && !keep.has(slot.figure)) {
          slot.element.style.opacity = '0'
          slot.figure = -1
        } else keep.delete(slot.figure)
      }
      for (const index of keep) {
        const slot = pool.find((s) => s.figure < 0)
        if (!slot) break
        slot.figure = index
        slot.element.textContent = built.names[index]
      }
    }
    for (const slot of pool) {
      if (slot.figure < 0) continue
      const on = locate(slot.figure)
      if (on) slot.element.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0) translate(-50%, -50%)`
      const opacity = on ? ((slot.figure === active ? Math.min(1, strength.current * 1.6) : strength.current * 0.62) * intact(slot.figure)).toFixed(2) : '0'
      if (slot.element.style.opacity !== opacity) slot.element.style.opacity = opacity
      slot.element.classList.toggle('con-label--active', slot.figure === active)
    }
  })

  if (!built) return null
  return <lineSegments geometry={built.geometry} material={material} frustumCulled={false} renderOrder={-11} />
}
