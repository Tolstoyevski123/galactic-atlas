import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { isCompactDevice } from '../lib/motion'
import { view } from './view'

/**
 * A procedural stand-in for the Milky Way's band: faint points concentrated along the Galactic
 * plane and brightening toward the Galactic centre, drawn at infinity behind the catalogue.
 * It is illustrative (not catalogue data) but correctly oriented, because the scene frame is Galactic.
 *
 * Two layers:
 *   - tens of thousands of tiny points, drawn live (cheap: a few pixels each);
 *   - the soft glow, made of thousands of large overlapping sprites. Blending those every frame
 *     would cost tens of megapixels of overdraw, so they are rendered ONCE into a small cube map
 *     and shown as a single sky-box pass afterwards.
 */

const SKY_PIXELS_PER_RADIAN = 900 / ((50 * Math.PI) / 180) // what "1 px" means at the default view

/** Small deterministic PRNG so the band looks the same on every visit. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Sprites {
  positions: Float32Array
  colors: Float32Array
  sizes: Float32Array
}

function scatter(pointCount: number, cloudCount: number): { points: Sprites; clouds: Sprites } {
  const rand = mulberry32(20261116)
  const gauss = () => {
    // Box–Muller
    const u = Math.max(rand(), 1e-9)
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
  }
  const DEG = Math.PI / 180
  const make = (count: number): Sprites => ({
    positions: new Float32Array(count * 3),
    colors: new Float32Array(count * 4),
    sizes: new Float32Array(count),
  })
  const points = make(pointCount)
  const clouds = make(cloudCount)

  // A few "dust lanes": patches of longitude where the mid-plane is darkened.
  const lanes = Array.from({ length: 14 }, () => ({ l: (rand() - 0.5) * 220, width: 6 + rand() * 16, offset: (rand() - 0.5) * 3 }))
  const dust = (l: number, b: number): number => {
    let d = 0
    for (const lane of lanes) {
      const dl = (l - lane.l) / lane.width
      const db = (b - lane.offset) / 1.6
      d += Math.exp(-dl * dl - db * db)
    }
    return Math.min(0.85, d * 0.8)
  }
  const place = (target: Sprites, i: number, l: number, b: number) => {
    const cb = Math.cos(b * DEG)
    // Scene frame: +X Galactic centre, +Y north Galactic pole, longitude increasing toward −Z.
    target.positions[i * 3] = cb * Math.cos(l * DEG)
    target.positions[i * 3 + 1] = Math.sin(b * DEG)
    target.positions[i * 3 + 2] = -cb * Math.sin(l * DEG)
  }
  const sampleLongitude = () => (rand() < 0.5 ? gauss() * 42 : (rand() - 0.5) * 360)
  const thickness = (l: number) => 3.2 + 8.5 * Math.exp(-((l / 26) ** 2))

  for (let i = 0; i < pointCount; ) {
    const l = sampleLongitude()
    const b = gauss() * thickness(l) * (rand() < 0.25 ? 2.2 : 1)
    if (Math.abs(b) > 80 || rand() < dust(l, b)) continue
    place(points, i, l, b)
    const toCentre = Math.exp(-((l / 38) ** 2)) * Math.exp(-((b / 14) ** 2))
    const warm = 0.35 + 0.65 * toCentre
    points.colors[i * 4] = 0.72 + 0.28 * warm
    points.colors[i * 4 + 1] = 0.76 + 0.1 * warm
    points.colors[i * 4 + 2] = 0.95 - 0.3 * warm
    points.colors[i * 4 + 3] = (0.1 + rand() * 0.22) * (0.75 + 0.6 * toCentre)
    points.sizes[i] = 1.4 + rand() * 1.9
    i++
  }
  // Large, very faint sprites that merge into the band's glow. More of them at lower strength
  // than a live layer could afford: the glow comes out smoother.
  const strength = 1800 / cloudCount
  for (let i = 0; i < cloudCount; ) {
    const l = sampleLongitude()
    const b = gauss() * thickness(l) * 0.7
    if (rand() < dust(l, b) * 0.9) continue
    place(clouds, i, l, b)
    const toCentre = Math.exp(-((l / 34) ** 2)) * Math.exp(-((b / 12) ** 2))
    clouds.colors[i * 4] = 0.62 + 0.38 * toCentre
    clouds.colors[i * 4 + 1] = 0.66 + 0.18 * toCentre
    clouds.colors[i * 4 + 2] = 0.9 - 0.32 * toCentre
    clouds.colors[i * 4 + 3] = (0.012 + 0.022 * toCentre + rand() * 0.008) * strength
    clouds.sizes[i] = 46 + rand() * 70
    i++
  }
  return { points, clouds }
}

// ── live point layer ────────────────────────────────────────────────────────

const pointVertex = /* glsl */ `
  attribute float aSize;
  attribute vec4 aColor;
  uniform float uPixelRatio;
  uniform float uOpacity;
  varying vec4 vColor;

  void main() {
    vColor = vec4(aColor.rgb, aColor.a * uOpacity);
    // Rotation only: the band sits at infinity and ignores camera travel.
    vec4 mv = vec4(mat3(viewMatrix) * position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w * 0.999995;
    gl_PointSize = aSize * uPixelRatio;
  }
`

const spriteFragment = /* glsl */ `
  varying vec4 vColor;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(p, p);
    if (r2 > 1.0) discard;
    float falloff = exp(-r2 * 3.2) * (1.0 - smoothstep(0.55, 1.0, r2));
    gl_FragColor = vec4(vColor.rgb * falloff * vColor.a, 1.0);
  }
`

// ── glow: baked once ────────────────────────────────────────────────────────

// Quads rather than point sprites: a point is culled when its centre leaves a cube face, which
// would leave dark seams along the cube's edges. Triangles clip properly.
const bakeVertex = /* glsl */ `
  attribute vec3 aCentre;
  attribute vec4 aColor;
  attribute float aSize;
  uniform float uRadiansPerPixel;
  varying vec4 vColor;
  varying vec2 vCorner;

  void main() {
    vColor = aColor;
    vCorner = position.xy;
    vec3 axis = abs(aCentre.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 right = normalize(cross(axis, aCentre));
    vec3 up = cross(aCentre, right);
    float extent = tan(0.5 * aSize * uRadiansPerPixel); // "half" is a reserved word in GLSL ES 3
    vec3 world = (aCentre + (right * position.x + up * position.y) * extent) * 10.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
  }
`

const bakeFragment = /* glsl */ `
  varying vec4 vColor;
  varying vec2 vCorner;
  void main() {
    float r2 = dot(vCorner, vCorner);
    if (r2 > 1.0) discard;
    float falloff = exp(-r2 * 3.2) * (1.0 - smoothstep(0.55, 1.0, r2));
    gl_FragColor = vec4(vColor.rgb * falloff * vColor.a, 1.0);
  }
`

function bakeGlow(gl: THREE.WebGLRenderer, clouds: Sprites, faceSize: number): THREE.WebGLCubeRenderTarget {
  // Half-float keeps the many faint contributions from rounding away; fall back to 8 bits if unsupported.
  const floatTargets = gl.extensions.has('EXT_color_buffer_float') || gl.extensions.has('EXT_color_buffer_half_float')
  const target = new THREE.WebGLCubeRenderTarget(faceSize, {
    type: floatTargets ? THREE.HalfFloatType : THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  })

  const quad = new THREE.InstancedBufferGeometry()
  quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
  quad.setIndex([0, 1, 2, 0, 2, 3])
  quad.setAttribute('aCentre', new THREE.InstancedBufferAttribute(clouds.positions, 3))
  quad.setAttribute('aColor', new THREE.InstancedBufferAttribute(clouds.colors, 4))
  quad.setAttribute('aSize', new THREE.InstancedBufferAttribute(clouds.sizes, 1))
  quad.instanceCount = clouds.sizes.length

  const material = new THREE.ShaderMaterial({
    vertexShader: bakeVertex,
    fragmentShader: bakeFragment,
    uniforms: { uRadiansPerPixel: { value: 1 / SKY_PIXELS_PER_RADIAN } },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(quad, material)
  mesh.frustumCulled = false
  const scene = new THREE.Scene()
  scene.add(mesh)

  const clearColor = gl.getClearColor(new THREE.Color())
  const clearAlpha = gl.getClearAlpha()
  gl.setClearColor(0x000000, 1)
  new THREE.CubeCamera(0.1, 100, target).update(gl, scene)
  gl.setClearColor(clearColor, clearAlpha)

  quad.dispose()
  material.dispose()
  return target
}

const skyVertex = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
    gl_Position.z = gl_Position.w * 0.999998;
  }
`

const skyFragment = /* glsl */ `
  uniform samplerCube uGlow;
  uniform float uOpacity;
  varying vec3 vDirection;
  void main() {
    vec3 glow = textureCube(uGlow, normalize(vDirection)).rgb * uOpacity;
    // A whisper of noise so the dark gradient does not band on 8-bit displays.
    float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
    gl_FragColor = vec4(max(glow + grain / 255.0, 0.0), 1.0);
  }
`

export function MilkyWay({ visible }: { visible: boolean }) {
  const gl = useThree((s) => s.gl)
  const sprites = useMemo(() => (isCompactDevice() ? scatter(22000, 3000) : scatter(60000, 6000)), [])

  const pointGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(sprites.points.positions, 3))
    g.setAttribute('aColor', new THREE.BufferAttribute(sprites.points.colors, 4))
    g.setAttribute('aSize', new THREE.BufferAttribute(sprites.points.sizes, 1))
    return g
  }, [sprites])
  const pointMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: pointVertex,
        fragmentShader: spriteFragment,
        uniforms: { uPixelRatio: { value: 1 }, uOpacity: { value: 0 } },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
      }),
    [],
  )

  const skyGeometry = useMemo(() => new THREE.BoxGeometry(2, 2, 2), [])
  const skyMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        uniforms: { uGlow: { value: null as THREE.CubeTexture | null }, uOpacity: { value: 0 } },
        side: THREE.BackSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    [],
  )
  // Baked on the first frame (it needs the live renderer) and released with the component.
  const glow = useRef<THREE.WebGLCubeRenderTarget | null>(null)
  useEffect(
    () => () => {
      glow.current?.dispose()
      glow.current = null
    },
    [gl, sprites],
  )

  useEffect(() => () => pointGeometry.dispose(), [pointGeometry])
  useEffect(() => () => pointMaterial.dispose(), [pointMaterial])
  useEffect(() => () => skyGeometry.dispose(), [skyGeometry])
  useEffect(() => () => skyMaterial.dispose(), [skyMaterial])

  useFrame((_, delta) => {
    if (!glow.current) {
      glow.current = bakeGlow(gl, sprites.clouds, 256)
      skyMaterial.uniforms.uGlow.value = glow.current.texture
    }
    // Fade rather than pop when toggled; slightly subdued inside a system.
    const target = visible ? (view.sky ? 0.7 : 1) : 0
    const opacity = pointMaterial.uniforms.uOpacity
    opacity.value += (target - opacity.value) * Math.min(1, delta * 5)
    if (Math.abs(target - opacity.value) < 0.002) opacity.value = target
    pointMaterial.uniforms.uPixelRatio.value = view.pixelRatio
    skyMaterial.uniforms.uOpacity.value = opacity.value
  })

  return (
    <>
      <mesh geometry={skyGeometry} material={skyMaterial} frustumCulled={false} renderOrder={-30} />
      <points geometry={pointGeometry} material={pointMaterial} frustumCulled={false} renderOrder={-20} />
    </>
  )
}
