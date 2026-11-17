import { useEffect, useRef, type ComponentRef } from 'react'
import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { starPositionAt, type Atlas } from '../data/atlas'
import { prefersReducedMotion } from '../lib/motion'
import { openedWithDeepLink } from '../store/bootstrap'
import { useAtlas, type AtlasState, type FlightCommand, type Mode } from '../store/useAtlas'
import { FRAME_RADIUS } from './systemLayout'
import { advanceDiscoveryYear, MAGNITUDE_LIMIT, referenceDistance, view } from './view'

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
/** In sky mode only the direction of the camera matters; it pivots this far from a fixed point. */
const SKY_DISTANCE = 1
const ROTATE_SPEED = 0.55
/** Negative: dragging pulls the sky along with the pointer, like turning your head, instead of orbiting an object. */
const SKY_ROTATE_SPEED = -0.4

interface Flight {
  kind: FlightCommand['kind'] | 'intro' | 'surface'
  nonce: number
  elapsed: number
  duration: number
  /** The star being flown to (−1 for none): its position is re-read every frame, in case time is running. */
  star: number
  target0: THREE.Vector3
  target1: THREE.Vector3
  dir0: THREE.Vector3
  dir1: THREE.Vector3
  dist0: number
  dist1: number
  /** Extra pull-back mid-flight so long trips read as "zoom out, travel, zoom in". */
  hump: number
}

/** The map view to come back to after visiting a system or a sky. */
interface SavedPose {
  position: THREE.Vector3
  target: THREE.Vector3
  /** The star the camera was orbiting (null if it was looking elsewhere), and where that star was then. */
  star: number | null
  starPosition: THREE.Vector3
}

const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

const scratch = new THREE.Vector3()
const before = new THREE.Vector3()
const after = new THREE.Vector3()

/** Orbit controls plus every scripted camera move: intro, fly-to, diving into systems, standing at a star. */
export function CameraRig({ atlas }: { atlas: Atlas }) {
  const controlsRef = useRef<Controls>(null)
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const flight = useRef<Flight | null>(null)
  const savedMapPose = useRef<SavedPose | null>(null)
  const stepRef = useRef<((delta: number, state: AtlasState) => void) | null>(null)
  const offset = useRef({ x: 0, y: 0, appliedX: 0, appliedY: 0, width: 0, height: 0 })

  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return
    /** The star whose position is view.origin while in sky mode (a system's host, or the star stood on). */
    let originStar = -1

    /** Where a star is at the time machine's current date. */
    const starPosition = (star: number, out: THREE.Vector3) => starPositionAt(atlas, star, view.epoch, out)

    /** True when the camera is orbiting this star, rather than some point the viewer panned to. */
    const orbiting = (position: THREE.Vector3): boolean =>
      controls.target.distanceTo(position) <= 0.02 * camera.position.distanceTo(controls.target) + 1e-4

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

    const startFlight = (kind: Flight['kind'], nonce: number, target1: THREE.Vector3, dir1: THREE.Vector3, dist1: number, seconds?: number, star = -1) => {
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
        star,
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
      startFlight(command.kind, command.nonce, target, direction, distance, undefined, command.star)
    }

    /** Controls as they are on the map and inside a system: orbit, zoom and pan. */
    const freeControls = () => {
      controls.enableZoom = true
      controls.enablePan = true
      controls.rotateSpeed = ROTATE_SPEED
    }

    const enterSystem = (systemIndex: number) => {
      flight.current = null
      controls.enabled = true
      freeControls()
      const star = atlas.systems[systemIndex].star
      originStar = star
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

    /** Stand at a star: the camera stays put and only turns, and the first thing it faces is the Sun. */
    const enterSky = (star: number) => {
      flight.current = null
      controls.enabled = true
      originStar = star
      view.sky = true
      view.dim = 1
      starPosition(star, view.origin)
      controls.enableZoom = false
      controls.enablePan = false
      controls.rotateSpeed = SKY_ROTATE_SPEED
      controls.minDistance = SKY_DISTANCE
      controls.maxDistance = SKY_DISTANCE
      // The camera looks through the pivot, so it goes on the far side from the Sun.
      // (From the Sun itself there is no such direction: face the Galactic centre.)
      const away = view.origin.clone()
      if (away.lengthSq() < 1e-12) away.set(-1, 0, 0)
      setPose(new THREE.Vector3(), away.normalize(), SKY_DISTANCE)
    }

    /** `flying`: a flight to another star starts right away, so begin it from the view we left. */
    const leaveToMap = (from: Mode, flying: boolean) => {
      originStar = -1
      view.sky = false
      view.dim = 1
      freeControls()
      controls.minDistance = 0.04
      controls.maxDistance = 60000
      const saved = savedMapPose.current
      savedMapPose.current = null
      const star = useAtlas.getState().selectedStar
      const surfacing = from === 'system'
      if (saved && (flying || saved.star === star || star === null)) {
        // Back to the very view we left — carried along with its star if time has moved meanwhile.
        const drift = saved.star !== null ? starPosition(saved.star, new THREE.Vector3()).sub(saved.starPosition) : new THREE.Vector3()
        controls.target.copy(saved.target).add(drift)
        camera.position.copy(saved.position).add(drift)
        camera.lookAt(controls.target)
        controls.update()
      } else if (star !== null) {
        // We came out somewhere else than we went in (or were never near this star): start beside it.
        setPose(starPosition(star, new THREE.Vector3()), HOME_DIRECTION, surfacing ? DIVE_DISTANCE : SELECT_DISTANCE)
      } else {
        setPose(new THREE.Vector3(), HOME_DIRECTION, HOME_DISTANCE)
      }
      if (!surfacing) return
      // Drift back out from the star we were visiting.
      const direction = camera.position.clone().sub(controls.target)
      if (direction.lengthSq() < 1e-12) direction.copy(HOME_DIRECTION)
      startFlight('surface', 0, controls.target.clone(), direction, SURFACE_DISTANCE, 1.6, star !== null && orbiting(starPosition(star, scratch)) ? star : -1)
    }

    const saveMapPose = (star: number | null) => {
      const position = star !== null ? starPosition(star, new THREE.Vector3()) : new THREE.Vector3()
      savedMapPose.current = {
        position: camera.position.clone(),
        target: controls.target.clone(),
        star: star !== null && orbiting(position) ? star : null,
        starPosition: position,
      }
    }

    // ── Initial pose.
    controls.minDistance = 0.04
    controls.maxDistance = 60000
    view.epoch = useAtlas.getState().epoch
    const initial = useAtlas.getState()
    if (initial.mode !== 'map') {
      setPose(new THREE.Vector3(), HOME_DIRECTION, HOME_DISTANCE)
      saveMapPose(null)
      if (initial.mode === 'system' && initial.systemIndex !== null) enterSystem(initial.systemIndex)
      else if (initial.mode === 'sky' && initial.skyStar !== null) enterSky(initial.skyStar)
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
      // Leaving the map: remember the view, and whether it was centred on the star we are going to.
      if (modeChanged && previous.mode === 'map') saveMapPose(state.selectedStar)
      if (state.mode === 'system' && state.systemIndex !== null && (modeChanged || state.systemIndex !== previous.systemIndex)) {
        enterSystem(state.systemIndex)
      } else if (state.mode === 'sky' && state.skyStar !== null && (modeChanged || state.skyStar !== previous.skyStar)) {
        enterSky(state.skyStar)
      } else if (modeChanged && state.mode === 'map') {
        leaveToMap(previous.mode, state.flight !== null && state.flight !== previous.flight)
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

    stepRef.current = (delta: number, state: AtlasState) => {
      // ── The time machine's date. When it changes, everything attached to a star moves with it.
      if (state.epoch !== view.epoch) {
        const star = state.mode === 'map' ? state.selectedStar : null
        // Orbiting the selected star: carry the camera along, so the star stays where it is on screen.
        const follow = star !== null && !flight.current && orbiting(starPosition(star, before))
        view.epoch = state.epoch
        if (follow && star !== null) {
          after.copy(starPosition(star, scratch)).sub(before)
          controls.target.add(after)
          camera.position.add(after)
        }
      }
      if (view.sky && originStar >= 0) starPosition(originStar, view.origin)

      const f = flight.current
      if (!f) return
      if (f.star >= 0) starPosition(f.star, f.target1)
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
      view.epoch = 0
      view.year = Infinity
    }
  }, [atlas, camera, gl])

  // Runs before the controls' own update (priority −1) and before anything that reads `view`.
  useFrame((state, delta) => {
    const store = useAtlas.getState()
    const dt = Math.min(delta, 0.1)
    stepRef.current?.(dt, store)
    advanceDiscoveryYear(store.strip === 'discovery' ? store.discoveryYear : null, dt, prefersReducedMotion())
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
      rotateSpeed={ROTATE_SPEED}
      zoomSpeed={0.95}
      panSpeed={0.8}
    />
  )
}
