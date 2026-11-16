import { useEffect, useRef, type ComponentRef } from 'react'
import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { Atlas } from '../data/atlas'
import { prefersReducedMotion } from '../lib/motion'
import { openedWithDeepLink } from '../store/bootstrap'
import { useAtlas, type FlightCommand } from '../store/useAtlas'
import { FRAME_RADIUS } from './systemLayout'
import { MAGNITUDE_LIMIT, referenceDistance, view } from './view'

type Controls = ComponentRef<typeof OrbitControls>

/** Where the camera sits relative to what it looks at when showing the solar neighbourhood. */
const HOME_DIRECTION = new THREE.Vector3(-0.8, 0.32, 0.5).normalize()
const HOME_DISTANCE = 32
const INTRO_DISTANCE = 1500
/** How close the camera settles to a selected star, parsec. */
const SELECT_DISTANCE = 3
const DIVE_DISTANCE = 0.9
const SURFACE_DISTANCE = 9
const SYSTEM_DIRECTION = new THREE.Vector3(0, 0.46, 1).normalize()

interface Flight {
  kind: FlightCommand['kind'] | 'intro' | 'surface'
  nonce: number
  elapsed: number
  duration: number
  target0: THREE.Vector3
  target1: THREE.Vector3
  dir0: THREE.Vector3
  dir1: THREE.Vector3
  dist0: number
  dist1: number
  /** Extra pull-back mid-flight so long trips read as "zoom out, travel, zoom in". */
  hump: number
}

const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

const scratch = new THREE.Vector3()

/** Orbit controls plus every scripted camera move: intro, fly-to, diving into and out of systems. */
export function CameraRig({ atlas }: { atlas: Atlas }) {
  const controlsRef = useRef<Controls>(null)
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const flight = useRef<Flight | null>(null)
  const savedMapPose = useRef<{ position: THREE.Vector3; target: THREE.Vector3 } | null>(null)
  const stepRef = useRef<((delta: number) => void) | null>(null)
  const offset = useRef({ x: 0, y: 0, appliedX: 0, appliedY: 0, width: 0, height: 0 })

  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return

    const starPosition = (star: number, out: THREE.Vector3) =>
      out.set(atlas.pos[star * 3], atlas.pos[star * 3 + 1], atlas.pos[star * 3 + 2])

    const setPose = (target: THREE.Vector3, direction: THREE.Vector3, distance: number) => {
      controls.target.copy(target)
      camera.position.copy(target).addScaledVector(direction, distance)
      camera.lookAt(target)
      controls.update()
    }

    const endFlight = () => {
      const f = flight.current
      flight.current = null
      controls.enabled = true
      controls.update()
      if (f?.kind === 'dive') useAtlas.getState().diveArrived(f.nonce)
    }

    const startFlight = (kind: Flight['kind'], nonce: number, target1: THREE.Vector3, dir1: THREE.Vector3, dist1: number, seconds?: number) => {
      const target0 = controls.target.clone()
      const offset = camera.position.clone().sub(target0)
      const dist0 = Math.max(offset.length(), 1e-3)
      const travel = target0.distanceTo(target1)
      const zoom = Math.abs(Math.log(dist1 / dist0))
      const duration = prefersReducedMotion()
        ? 0
        : (seconds ?? THREE.MathUtils.clamp(0.85 + 0.3 * zoom + 0.22 * Math.log1p(travel / Math.max(dist0, dist1)), 0.9, 3))
      flight.current = {
        kind,
        nonce,
        elapsed: 0,
        duration,
        target0,
        target1: target1.clone(),
        dir0: offset.divideScalar(dist0),
        dir1: dir1.clone().normalize(),
        dist0,
        dist1,
        hump: Math.max(0, 0.32 * travel - Math.max(dist0, dist1)),
      }
      controls.enabled = false
    }

    const flyTo = (command: FlightCommand) => {
      if (command.kind === 'home') {
        startFlight('home', command.nonce, new THREE.Vector3(), HOME_DIRECTION, HOME_DISTANCE)
        return
      }
      const target = starPosition(command.star, new THREE.Vector3())
      const direction = camera.position.clone().sub(controls.target)
      if (direction.lengthSq() < 1e-12) direction.copy(HOME_DIRECTION)
      const current = camera.position.distanceTo(target)
      const distance = command.kind === 'dive' ? DIVE_DISTANCE : Math.min(SELECT_DISTANCE, Math.max(current, 0.25))
      startFlight(command.kind, command.nonce, target, direction, distance)
    }

    const enterSystem = (systemIndex: number) => {
      flight.current = null
      controls.enabled = true
      const star = atlas.systems[systemIndex].star
      view.sky = true
      view.dim = 0.85
      if (star >= 0) starPosition(star, view.origin)
      else view.origin.set(0, 0, 0)
      controls.minDistance = 0.5
      controls.maxDistance = 240
      // Pull back further on tall, narrow screens so the whole system still fits.
      // Only the area between the side panels counts as visible.
      const free = Math.max(240, gl.domElement.clientWidth - view.insetLeft - view.insetRight)
      // The vertical field of view spans the whole canvas, so width is judged against its full height.
      const aspect = free / Math.max(1, gl.domElement.clientHeight)
      // Far enough that the outermost orbit fits that area's width (vertical FOV is 50°).
      const fit = (FRAME_RADIUS * 1.12) / (Math.tan(THREE.MathUtils.degToRad(25)) * aspect)
      setPose(new THREE.Vector3(), SYSTEM_DIRECTION, Math.max(FRAME_RADIUS * 2, fit))
    }

    const leaveSystem = () => {
      view.sky = false
      view.dim = 1
      controls.minDistance = 0.04
      controls.maxDistance = 60000
      const saved = savedMapPose.current
      savedMapPose.current = null
      const star = useAtlas.getState().selectedStar
      if (saved) {
        controls.target.copy(saved.target)
        camera.position.copy(saved.position)
        camera.lookAt(saved.target)
        controls.update()
      } else if (star !== null) {
        setPose(starPosition(star, new THREE.Vector3()), HOME_DIRECTION, DIVE_DISTANCE)
      } else {
        setPose(new THREE.Vector3(), HOME_DIRECTION, HOME_DISTANCE)
      }
      // Drift back out from the star we were visiting.
      const direction = camera.position.clone().sub(controls.target)
      if (direction.lengthSq() < 1e-12) direction.copy(HOME_DIRECTION)
      startFlight('surface', 0, controls.target.clone(), direction, SURFACE_DISTANCE, 1.6)
    }

    // ── Initial pose.
    controls.minDistance = 0.04
    controls.maxDistance = 60000
    const initial = useAtlas.getState()
    if (initial.mode === 'system' && initial.systemIndex !== null) {
      enterSystem(initial.systemIndex)
    } else if (openedWithDeepLink() || prefersReducedMotion()) {
      setPose(new THREE.Vector3(), HOME_DIRECTION, HOME_DISTANCE)
      if (initial.flight) flyTo(initial.flight)
    } else {
      setPose(new THREE.Vector3(), HOME_DIRECTION, INTRO_DISTANCE)
      startFlight('intro', 0, new THREE.Vector3(), HOME_DIRECTION, HOME_DISTANCE, 3.6)
    }

    // ── React to the store.
    const unsubscribe = useAtlas.subscribe((state, previous) => {
      const modeChanged = state.mode !== previous.mode
      if (state.mode === 'system' && state.systemIndex !== null && (modeChanged || state.systemIndex !== previous.systemIndex)) {
        if (modeChanged) {
          savedMapPose.current = { position: camera.position.clone(), target: controls.target.clone() }
        }
        enterSystem(state.systemIndex)
      } else if (modeChanged && state.mode === 'map') {
        leaveSystem()
      }
      if (state.flight && state.flight !== previous.flight && state.mode === 'map') flyTo(state.flight)
    })

    // A deliberate gesture takes the camera back from any cosmetic flight (never from a dive).
    const interrupt = () => {
      const f = flight.current
      if (f && f.kind !== 'dive') endFlight()
    }
    const element = gl.domElement
    element.addEventListener('pointerdown', interrupt)
    element.addEventListener('wheel', interrupt, { passive: true })

    stepRef.current = (delta: number) => {
      const f = flight.current
      if (!f) return
      f.elapsed += delta
      const t = f.duration <= 0 ? 1 : Math.min(1, f.elapsed / f.duration)
      const u = easeInOut(t)
      const target = scratch.lerpVectors(f.target0, f.target1, u)
      controls.target.copy(target)
      const direction = f.dir0.clone().lerp(f.dir1, u)
      if (direction.lengthSq() < 1e-8) direction.copy(f.dir1)
      direction.normalize()
      // Interpolate distance geometrically: equal time per zoom factor, like a map zoom.
      const distance = Math.exp(THREE.MathUtils.lerp(Math.log(f.dist0), Math.log(f.dist1), u)) + f.hump * Math.sin(Math.PI * u)
      camera.position.copy(target).addScaledVector(direction, distance)
      camera.lookAt(target)
      if (t >= 1) endFlight()
    }

    return () => {
      unsubscribe()
      element.removeEventListener('pointerdown', interrupt)
      element.removeEventListener('wheel', interrupt)
      stepRef.current = null
      view.sky = false
      view.dim = 1
    }
  }, [atlas, camera, gl])

  // Runs before the controls' own update (priority −1) and before anything that reads `view`.
  useFrame((state, delta) => {
    stepRef.current?.(Math.min(delta, 0.1))
    const controls = controlsRef.current
    view.camera.copy(state.camera.position)
    if (controls) view.target.copy(controls.target)
    view.pixelRatio = state.gl.getPixelRatio()
    view.width = state.size.width
    view.height = state.size.height
    // Shift the projection so the orbit target sits in the middle of the area the panels leave free.
    const wantedX = (view.insetLeft - view.insetRight) / 2
    const wantedY = view.insetBottom / 2
    const o = offset.current
    const ease = Math.min(1, delta * 6)
    o.x += (wantedX - o.x) * ease
    o.y += (wantedY - o.y) * ease
    if (Math.abs(wantedX - o.x) < 0.3) o.x = wantedX
    if (Math.abs(wantedY - o.y) < 0.3) o.y = wantedY
    const perspective = state.camera as THREE.PerspectiveCamera
    if (perspective.isPerspectiveCamera && (o.x !== o.appliedX || o.y !== o.appliedY || o.width !== view.width || o.height !== view.height)) {
      if (o.x === 0 && o.y === 0) perspective.clearViewOffset()
      else perspective.setViewOffset(view.width, view.height, -o.x, o.y, view.width, view.height)
      o.appliedX = o.x
      o.appliedY = o.y
      o.width = view.width
      o.height = view.height
    }

    view.markerRef = THREE.MathUtils.clamp(view.camera.distanceTo(view.target), 1.5, 8000)
    view.limit = MAGNITUDE_LIMIT
    view.refDist = view.sky ? 10 : referenceDistance(view.camera.length(), view.camera.distanceTo(view.target))
  }, -2)

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.09}
      rotateSpeed={0.55}
      zoomSpeed={0.95}
      panSpeed={0.8}
    />
  )
}
