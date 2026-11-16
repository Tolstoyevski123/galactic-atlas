import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Billboard, Html, Line } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import type { Atlas, PlanetRow } from '../data/atlas'
import { HZ_NONE, type SystemRecord } from '../data/schema'
import { SOLAR_BODIES, SUN_TEXTURE, textureUrl, type SolarBody } from '../data/solarBodies'
import { hash01, orbitRadius, orbitState, planetClass, saturate, starColor, teffToRgb, TEFF_SUN } from '../lib/astro'
import { sig } from '../lib/format'
import { useAtlas } from '../store/useAtlas'
import { defaultSimSpeed, displayRadius, layoutSystem, type PlanetLayout, type SystemLayout } from './systemLayout'

const NOISE_GLSL = /* glsl */ `
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float valueNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      sum += amp * valueNoise(p);
      p = p * 2.03 + 11.7;
      amp *= 0.5;
    }
    return sum;
  }
`

/**
 * A colour map from public/textures, or null until it has arrived (and for good if it never
 * does — callers then keep their stylised look).
 */
function useColorMap(url: string | null): THREE.Texture | null {
  const gl = useThree((state) => state.gl)
  const [texture, setTexture] = useState<THREE.Texture | null>(null)
  useEffect(() => {
    if (!url) return
    let cancelled = false
    let loaded: THREE.Texture | null = null
    new THREE.TextureLoader().load(
      url,
      (t) => {
        if (cancelled) {
          t.dispose()
          return
        }
        t.colorSpace = THREE.SRGBColorSpace
        t.wrapS = THREE.RepeatWrapping
        t.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy())
        loaded = t
        setTexture(t)
      },
      undefined,
      () => undefined,
    )
    return () => {
      cancelled = true
      loaded?.dispose()
      setTexture(null)
    }
  }, [url, gl])
  return texture
}

// ───────────────────────────────────────────────────────────── star

const starVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vObject;
  varying vec2 vUv;
  void main() {
    vObject = position;
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`

const starFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform sampler2D uMap;
  uniform float uUseMap;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vObject;
  varying vec2 vUv;
  ${NOISE_GLSL}
  void main() {
    float mu = max(dot(normalize(vNormal), normalize(vView)), 0.0);
    // Limb darkening plus slow, fine-grained surface mottling.
    float limb = 0.5 + 0.5 * pow(mu, 0.55);
    float cells = fbm(normalize(vObject) * 7.0 + vec3(0.0, uTime * 0.05, uTime * 0.03));
    vec3 hot = mix(uColor, vec3(1.0), 0.08 + 0.3 * mu);
    vec3 surface = hot * limb * (0.86 + 0.28 * cells);
    // The Sun has a real map; it only needs the limb darkening.
    if (uUseMap > 0.5) surface = texture2D(uMap, vUv).rgb * (0.66 + 0.4 * pow(mu, 0.6));
    gl_FragColor = vec4(surface, 1.0);
    #include <colorspace_fragment>
  }
`

const glowFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uCore;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    if (r > 1.0) discard;
    // Bright corona hugging the photosphere, then a long soft tail.
    float corona = exp(-pow(max(r - uCore, 0.0) / 0.085, 1.0)) * 0.85;
    float tail = 0.16 / (1.0 + pow(r / 0.22, 2.0));
    float intensity = (corona + tail) * (1.0 - smoothstep(0.7, 1.0, r));
    gl_FragColor = vec4(mix(uColor, vec3(1.0), corona * 0.5) * intensity, 1.0);
    #include <colorspace_fragment>
  }
`

const uvVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

function Star({ color, radius, map }: { color: THREE.Color; radius: number; map: THREE.Texture | null }) {
  const surface = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: starVertex,
        fragmentShader: starFragment,
        uniforms: { uColor: { value: color }, uTime: { value: 0 }, uMap: { value: null }, uUseMap: { value: 0 } },
      }),
    [color],
  )
  useEffect(() => {
    surface.uniforms.uMap.value = map
    surface.uniforms.uUseMap.value = map ? 1 : 0
  }, [surface, map])
  const sphere = useRef<THREE.Mesh>(null)
  // The glow quad is `GLOW` star-radii across; uCore marks where the photosphere ends inside it.
  const GLOW = 11
  const glow = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: uvVertex,
        fragmentShader: glowFragment,
        uniforms: { uColor: { value: color }, uCore: { value: 2 / GLOW } },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [color],
  )
  useEffect(() => () => surface.dispose(), [surface])
  useEffect(() => () => glow.dispose(), [glow])
  useFrame((state, delta) => {
    surface.uniforms.uTime.value = state.clock.elapsedTime
    if (map && sphere.current) sphere.current.rotation.y += delta * 0.02
  })

  return (
    <group>
      <mesh ref={sphere} material={surface}>
        <sphereGeometry args={[radius, 64, 48]} />
      </mesh>
      <Billboard>
        <mesh material={glow} renderOrder={5}>
          <planeGeometry args={[radius * GLOW, radius * GLOW]} />
        </mesh>
      </Billboard>
    </group>
  )
}

// ───────────────────────────────────────────────────────────── planets

const planetVertex = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  varying vec3 vObject;
  varying vec2 vUv;
  void main() {
    vObject = position;
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPosition = world.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const planetFragment = /* glsl */ `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uAtmosphere;
  uniform float uBands;
  uniform float uSeed;
  uniform float uEmissive;
  uniform float uRadius;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  varying vec3 vObject;
  ${NOISE_GLSL}
  void main() {
    vec3 n = normalize(vWorldNormal);
    vec3 toStar = normalize(-vWorldPosition); // the star sits at the origin of the system view
    vec3 toEye = normalize(cameraPosition - vWorldPosition);
    float day = smoothstep(-0.2, 0.38, dot(n, toStar));

    vec3 q = vObject / uRadius;
    float pattern;
    if (uBands > 0.5) {
      // Gas and ice giants: latitudinal bands, gently warped.
      float warp = fbm(q * 3.0 + uSeed);
      pattern = 0.5 + 0.5 * sin((q.y + warp * 0.22) * uBands + uSeed * 6.0);
      pattern = mix(pattern, fbm(q * vec3(2.0, 10.0, 2.0) + uSeed), 0.4);
    } else {
      // Rocky worlds: blotchy terrain.
      pattern = smoothstep(0.36, 0.64, fbm(q * 2.6 + uSeed));
    }
    vec3 albedo = mix(uColorA, uColorB, pattern);
    // A little fill light keeps the night side readable when a planet passes in front of its star.
    vec3 color = albedo * (0.13 + 0.87 * day);
    color += uColorA * uEmissive * (0.55 + 0.45 * pattern);
    float rim = pow(1.0 - max(dot(n, toEye), 0.0), 2.6);
    color += uAtmosphere * rim * (0.3 + 0.7 * day);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`

/** A planet we have a real map of: the map, lit by the star, with a thin glow at the limb. */
const mappedFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uAtmosphere;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  varying vec2 vUv;
  void main() {
    vec3 n = normalize(vWorldNormal);
    vec3 toStar = normalize(-vWorldPosition); // the star sits at the origin of the system view
    vec3 toEye = normalize(cameraPosition - vWorldPosition);
    float day = smoothstep(-0.12, 0.32, dot(n, toStar));
    vec3 color = texture2D(uMap, vUv).rgb * (0.1 + 0.9 * day);
    float rim = pow(1.0 - max(dot(n, toEye), 0.0), 3.2);
    color += uAtmosphere * rim * (0.25 + 0.75 * day);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`

const ringVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPosition = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const ringFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uCenter;
  uniform float uRadius;
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  void main() {
    vec4 ring = texture2D(uMap, vec2(vUv.x, 0.5));
    // The planet's shadow: does the way from here to the star pass through the globe?
    vec3 toStar = normalize(-vWorldPosition);
    vec3 fromCenter = vWorldPosition - uCenter;
    float along = dot(fromCenter, toStar);
    float miss = length(fromCenter - toStar * along);
    float lit = along < 0.0 ? smoothstep(uRadius * 0.94, uRadius * 1.04, miss) : 1.0;
    gl_FragColor = vec4(ring.rgb * (0.16 + 0.84 * lit), ring.a);
    #include <colorspace_fragment>
  }
`

function Rings({ rings, radius, center }: { rings: NonNullable<SolarBody['rings']>; radius: number; center: RefObject<THREE.Group | null> }) {
  const map = useColorMap(textureUrl(rings.texture))
  const geometry = useMemo(() => {
    const inner = rings.inner * radius
    const outer = rings.outer * radius
    const g = new THREE.RingGeometry(inner, outer, 160, 1)
    // RingGeometry maps the picture flat; the strip wants "u = how far out".
    const position = g.attributes.position
    const uv = g.attributes.uv
    for (let i = 0; i < position.count; i++) uv.setXY(i, (Math.hypot(position.getX(i), position.getY(i)) - inner) / (outer - inner), 0.5)
    return g
  }, [rings, radius])
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: ringVertex,
        fragmentShader: ringFragment,
        uniforms: { uMap: { value: null }, uCenter: { value: new THREE.Vector3() }, uRadius: { value: radius } },
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    [radius],
  )
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])
  useFrame(() => {
    material.uniforms.uMap.value = map
    if (center.current) (material.uniforms.uCenter.value as THREE.Vector3).copy(center.current.position)
  })
  if (!map) return null
  return <mesh geometry={geometry} material={material} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2} />
}

interface Palette {
  a: string
  b: string
  atmosphere: string
  bands: number
  emissive: number
}

/**
 * A stylised look from size class and temperature. Nobody has seen these worlds; the colours
 * only encode "what kind of planet, how hot".
 */
function paletteFor(item: PlanetLayout, starLuminosity: number | undefined): Palette {
  const p = item.planet
  const cls = planetClass(p.radius, p.mass)
  let t = p.eqt
  if (t == null) {
    const insol = p.insol ?? (starLuminosity != null && item.drawn ? starLuminosity / (item.a * item.a) : undefined)
    if (insol != null) t = 255 * insol ** 0.25
  }
  const known = t != null
  const temp = t ?? 300
  switch (cls) {
    case 'rocky':
      if (!known) return { a: '#9a9087', b: '#6c645c', atmosphere: '#2a3440', bands: 0, emissive: 0 }
      if (temp < 180) return { a: '#d3dde9', b: '#8ea4bd', atmosphere: '#5f7fa8', bands: 0, emissive: 0 }
      if (temp < 330) return { a: '#4f7fa6', b: '#a8946f', atmosphere: '#5fa0e0', bands: 0, emissive: 0 }
      if (temp < 800) return { a: '#c9a06f', b: '#8a6642', atmosphere: '#6b5038', bands: 0, emissive: 0 }
      return { a: '#e0582b', b: '#33180f', atmosphere: '#a04a20', bands: 0, emissive: 0.4 }
    case 'subneptune':
      if (temp < 400) return { a: '#8fc9dc', b: '#5a9fbb', atmosphere: '#6fb8dd', bands: 7, emissive: 0 }
      if (temp < 1000) return { a: '#b3cdc6', b: '#7b9d9a', atmosphere: '#6f9a95', bands: 7, emissive: 0 }
      return { a: '#cf9580', b: '#8c5a4c', atmosphere: '#9a5a40', bands: 7, emissive: 0.12 }
    case 'neptunian':
      if (temp < 350) return { a: '#4f80e2', b: '#86b6f2', atmosphere: '#5f96e8', bands: 9, emissive: 0 }
      if (temp < 1000) return { a: '#6a9bcf', b: '#a4c8df', atmosphere: '#6fa0cc', bands: 9, emissive: 0 }
      return { a: '#8c72b4', b: '#cc93b2', atmosphere: '#8a60a8', bands: 9, emissive: 0.1 }
    case 'jovian':
      if (temp < 250) return { a: '#dab78d', b: '#a8764d', atmosphere: '#8a6a48', bands: 13, emissive: 0 }
      if (temp < 900) return { a: '#d0ab8c', b: '#8d6c5c', atmosphere: '#80604c', bands: 13, emissive: 0 }
      if (temp < 1800) return { a: '#bb543c', b: '#3b1e29', atmosphere: '#a0482c', bands: 13, emissive: 0.3 }
      return { a: '#f28c4a', b: '#7c2b1f', atmosphere: '#c05a28', bands: 13, emissive: 0.55 }
    default:
      return { a: '#8b93a7', b: '#5b6377', atmosphere: '#3a4252', bands: 0, emissive: 0 }
  }
}

const UP = new THREE.Vector3(0, 1, 0)
const TAN_HALF_FOV = Math.tan(THREE.MathUtils.degToRad(25))

interface SceneLabelProps {
  position: [number, number, number]
  /** Size of the thing being labelled, in display units from the system's centre. */
  extent: number
  /** The label only shows once that extent covers at least this many pixels. */
  minPixels: number
  /** Show regardless of zoom (selected / hovered). */
  force?: boolean
  className: string
  zIndex: number
  children: ReactNode
}

/**
 * An HTML label with level-of-detail: tightly packed inner orbits would otherwise pile their
 * labels on top of each other, so a label waits until its orbit is big enough on screen.
 */
function SceneLabel({ position, extent, minPixels, force = false, className, zIndex, children }: SceneLabelProps) {
  const element = useRef<HTMLDivElement>(null)
  useFrame((state) => {
    const el = element.current
    if (!el) return
    const pixels = (extent / (state.camera.position.length() * TAN_HALF_FOV)) * (state.size.height / 2)
    const opacity = force || pixels >= minPixels ? '1' : '0'
    if (el.style.opacity !== opacity) el.style.opacity = opacity
  })
  return (
    <Html position={position} center zIndexRange={[zIndex, 0]} style={{ pointerEvents: 'none' }}>
      <div ref={element} className={className} style={{ opacity: 0 }}>
        {children}
      </div>
    </Html>
  )
}

function orbitPoints(item: PlanetLayout, scale: number): THREE.Vector3[] {
  const points: THREE.Vector3[] = []
  const segments = 200
  for (let s = 0; s <= segments; s++) {
    const nu = (s / segments) * Math.PI * 2
    const r = displayRadius(item.a * orbitRadius(nu, item.ecc), scale)
    const angle = nu + item.omega
    points.push(new THREE.Vector3(r * Math.cos(angle), 0, -r * Math.sin(angle)))
  }
  return points
}

interface PlanetProps {
  item: PlanetLayout
  scale: number
  starLuminosity: number | undefined
  clock: RefObject<number>
  /** Set for the Sun's own planets: draw the real map instead of a stylised globe. */
  body: SolarBody | undefined
}

function Planet({ item, scale, starLuminosity, clock, body }: PlanetProps) {
  const index = item.planet.index
  const selected = useAtlas((s) => s.selectedPlanet === index)
  const hovered = useAtlas((s) => s.hoverPlanet === index)
  const group = useRef<THREE.Group>(null)
  const globe = useRef<THREE.Mesh>(null)
  const inHz = item.planet.hz !== HZ_NONE

  const points = useMemo(() => orbitPoints(item, scale), [item, scale])
  const material = useMemo(() => {
    const palette = paletteFor(item, starLuminosity)
    return new THREE.ShaderMaterial({
      vertexShader: planetVertex,
      fragmentShader: planetFragment,
      uniforms: {
        uColorA: { value: new THREE.Color(palette.a) },
        uColorB: { value: new THREE.Color(palette.b) },
        uAtmosphere: { value: new THREE.Color(palette.atmosphere) },
        uBands: { value: palette.bands },
        uSeed: { value: hash01(item.planet.id, 3) * 40 },
        uEmissive: { value: palette.emissive },
        uRadius: { value: item.size },
      },
    })
  }, [item, starLuminosity])
  useEffect(() => () => material.dispose(), [material])

  // The real map, once it has loaded; the stylised globe stands in until then.
  const map = useColorMap(body ? textureUrl(body.texture) : null)
  const mapped = useMemo(
    () =>
      body && map
        ? new THREE.ShaderMaterial({
            vertexShader: planetVertex,
            fragmentShader: mappedFragment,
            uniforms: { uMap: { value: map }, uAtmosphere: { value: new THREE.Color(body.limb) } },
          })
        : null,
    [body, map],
  )
  useEffect(() => () => mapped?.dispose(), [mapped])

  const tilt = useMemo(() => (hash01(item.planet.id, 4) - 0.5) * 0.7, [item])
  const axis: [number, number, number] = body ? [0, 0, THREE.MathUtils.degToRad(body.tilt)] : [tilt, 0, tilt * 0.5]
  /** How far the drawn body reaches from its centre, in globe radii (rings included). */
  const reach = body?.rings ? body.rings.outer * 1.06 : 1

  useFrame((_, delta) => {
    const g = group.current
    if (!g) return
    const period = Number.isFinite(item.period) && item.period > 0 ? item.period : 365.25
    const { r, nu } = orbitState(item.phase + ((clock.current ?? 0) / period) * Math.PI * 2, item.ecc)
    const radius = displayRadius(item.a * r, scale)
    const angle = nu + item.omega
    g.position.set(radius * Math.cos(angle), 0, -radius * Math.sin(angle))
    if (globe.current) globe.current.rotateOnAxis(UP, delta * 0.25)
  })

  const over = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    useAtlas.getState().setHoverPlanet(index)
    document.body.style.cursor = 'pointer'
  }
  const out = () => {
    useAtlas.getState().setHoverPlanet(null)
    document.body.style.cursor = ''
  }
  const click = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    useAtlas.getState().selectPlanet(index)
  }
  useEffect(
    () => () => {
      document.body.style.cursor = ''
    },
    [],
  )

  const active = selected || hovered
  const orbitColor = inHz ? '#4ade80' : '#9fb4d8'
  const label = item.planet.letter || item.planet.name

  return (
    <>
      <Line
        points={points}
        color={orbitColor}
        lineWidth={active ? 2 : 1.1}
        transparent
        opacity={active ? 0.95 : inHz ? 0.55 : 0.3}
        depthWrite={false}
      />
      <group ref={group}>
        <group rotation={axis}>
          <mesh ref={globe} material={mapped ?? material} scale={[1, body?.flattening ?? 1, 1]}>
            <sphereGeometry args={[item.size, body ? 96 : 48, body ? 64 : 32]} />
          </mesh>
          {body?.rings && <Rings rings={body.rings} radius={item.size} center={group} />}
        </group>
        {/* Generous invisible target so small planets are easy to hover and click. */}
        <mesh onPointerOver={over} onPointerOut={out} onClick={click}>
          <sphereGeometry args={[Math.max(item.size * 1.9, 0.34), 16, 12]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
        <Billboard>
          {inHz && (
            <mesh>
              <ringGeometry args={[item.size * 1.55, item.size * 1.55 + 0.022, 64]} />
              <meshBasicMaterial color="#4ade80" transparent opacity={0.9} depthWrite={false} />
            </mesh>
          )}
          {active && (
            <mesh>
              <ringGeometry args={[item.size * Math.max(2.0, reach) + 0.04, item.size * Math.max(2.0, reach) + 0.075, 96]} />
              <meshBasicMaterial color={selected ? '#ffffff' : '#cbd5e1'} transparent opacity={selected ? 0.95 : 0.6} depthWrite={false} />
            </mesh>
          )}
        </Billboard>
        <SceneLabel
          position={[0, item.size * 2.0 + 0.2, 0]}
          extent={displayRadius(item.a, scale)}
          minPixels={54}
          force={active}
          zIndex={active ? 12 : 10}
          className={`planet-label${active ? ' planet-label--active' : ''}${inHz ? ' planet-label--hz' : ''}`}
        >
          {active ? item.planet.name : label}
        </SceneLabel>
      </group>
    </>
  )
}

// ───────────────────────────────────────────────────────────── habitable zone and scale rings

function Annulus({ inner, outer, opacity }: { inner: number; outer: number; opacity: number }) {
  if (!(outer > inner)) return null
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={-2}>
      <ringGeometry args={[inner, outer, 160]} />
      <meshBasicMaterial color="#34d399" transparent opacity={opacity} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  )
}

function circlePoints(radius: number): THREE.Vector3[] {
  const points: THREE.Vector3[] = []
  for (let s = 0; s <= 160; s++) {
    const angle = (s / 160) * Math.PI * 2
    points.push(new THREE.Vector3(radius * Math.cos(angle), 0, radius * Math.sin(angle)))
  }
  return points
}

function HabitableZone({ hz }: { hz: [number, number, number, number] }) {
  const [optInner, inner, outer, optOuter] = hz
  const innerEdge = useMemo(() => circlePoints(inner), [inner])
  const outerEdge = useMemo(() => circlePoints(outer), [outer])
  const labelRadius = (inner + outer) / 2
  return (
    <group>
      <Annulus inner={optInner} outer={inner} opacity={0.07} />
      <Annulus inner={inner} outer={outer} opacity={0.17} />
      <Annulus inner={outer} outer={optOuter} opacity={0.07} />
      <Line points={innerEdge} color="#4ade80" lineWidth={1} transparent opacity={0.45} depthWrite={false} />
      <Line points={outerEdge} color="#4ade80" lineWidth={1} transparent opacity={0.45} depthWrite={false} />
      <SceneLabel position={[labelRadius * 0.7071, 0, labelRadius * 0.7071]} extent={labelRadius} minPixels={90} zIndex={5} className="zone-label">
        Yaşanabilir bölge
      </SceneLabel>
    </group>
  )
}

/** Faint rings at round distances (… 0.1, 1, 10 AU …) so the square-root scale stays readable. */
function ScaleRings({ layout }: { layout: SystemLayout }) {
  const rings = useMemo(() => {
    const out: Array<{ au: number; radius: number; points: THREE.Vector3[] }> = []
    const maxAu = layout.frameAu * 3
    for (let exponent = -3; exponent <= 4; exponent++) {
      const au = 10 ** exponent
      if (au > maxAu || au < layout.frameAu / 400) continue
      const radius = displayRadius(au, layout.scale)
      if (radius < layout.starRadius * 2.2) continue // would sit inside the star's glare
      out.push({ au, radius, points: circlePoints(radius) })
    }
    return out
  }, [layout])
  return (
    <group>
      {rings.map((ring) => (
        <group key={ring.au}>
          <Line points={ring.points} color="#8aa0c8" lineWidth={1} transparent opacity={0.13} depthWrite={false} dashed dashSize={0.18} gapSize={0.14} />
          <SceneLabel position={[-ring.radius * 0.7071, 0, ring.radius * 0.7071]} extent={ring.radius} minPixels={70} zIndex={4} className="ring-label">
            {sig(ring.au, 2)} AU
          </SceneLabel>
        </group>
      ))}
    </group>
  )
}

// ───────────────────────────────────────────────────────────── system

function starTint(atlas: Atlas, system: SystemRecord): THREE.Color {
  let rgb: [number, number, number]
  if (system.teff != null) rgb = saturate(teffToRgb(system.teff), 1.25)
  else if (system.star >= 0 && Number.isFinite(atlas.ci[system.star])) rgb = starColor(atlas.ci[system.star], 1.25)
  else rgb = saturate(teffToRgb(TEFF_SUN), 1.25)
  return new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace)
}

/** The orrery: host star, scaled orbits with moving planets, and the habitable zone. */
export function SystemView({ atlas, systemIndex }: { atlas: Atlas; systemIndex: number }) {
  const system = atlas.systems[systemIndex]
  const planets = useMemo<PlanetRow[]>(() => {
    const start = atlas.planetStart[systemIndex]
    return atlas.planets.slice(start, start + system.planets.length)
  }, [atlas, systemIndex, system])
  const layout = useMemo(() => layoutSystem(system, planets), [system, planets])
  const color = useMemo(() => starTint(atlas, system), [atlas, system])
  const sunMap = useColorMap(system.builtin ? textureUrl(SUN_TEXTURE) : null)

  // Simulated time in days; advanced here, read by every planet.
  const clock = useRef(0)
  useEffect(() => {
    clock.current = 0
    useAtlas.getState().setUi({ simSpeed: defaultSimSpeed(layout), simPaused: false })
  }, [layout])
  useFrame((_, delta) => {
    const s = useAtlas.getState()
    if (!s.simPaused) clock.current += Math.min(delta, 0.1) * s.simSpeed
  }, -1)

  return (
    <group onPointerMissed={() => useAtlas.getState().selectPlanet(null)}>
      <Star color={color} radius={layout.starRadius} map={sunMap} />
      <ScaleRings layout={layout} />
      {layout.hz && <HabitableZone hz={layout.hz} />}
      {layout.planets
        .filter((item) => item.drawn)
        .map((item) => (
          <Planet
            key={item.planet.id}
            item={item}
            scale={layout.scale}
            starLuminosity={system.lum}
            clock={clock}
            body={system.builtin ? SOLAR_BODIES[item.planet.id] : undefined}
          />
        ))}
    </group>
  )
}
