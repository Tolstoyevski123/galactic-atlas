import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Atlas } from '../data/atlas'
import { starColor } from '../lib/astro'
import { isCompactDevice } from '../lib/motion'
import type { FilterMask } from './useFilterMask'
import { originExclusion, STAR_BRIGHTNESS_GLSL, view } from './view'

const vertexShader = /* glsl */ `
  attribute float aAbsMag;
  attribute vec3 aColor;
  attribute float aFade;
  attribute vec3 aVel;

  uniform float uPixelRatio;
  uniform float uRefDist;
  uniform float uLimit;
  uniform float uDim;
  uniform float uFilterMix;
  uniform float uSky;
  uniform vec3 uOrigin;
  uniform float uHide;
  uniform float uEpoch;

  varying vec3 vColor;
  varying float vAlpha;

  ${STAR_BRIGHTNESS_GLSL}

  void main() {
    // The time machine: every star keeps its present velocity (CPU twin: starPositionAt in data/atlas.ts).
    vec3 p = position + aVel * uEpoch;
    float dist;
    vec4 mv;
    if (uSky > 0.5) {
      // Standing at a star (or inside its system): draw each star as a direction on that star's sky.
      vec3 rel = p - uOrigin;
      dist = length(rel);
      mv = vec4(mat3(viewMatrix) * (rel / max(dist, 1e-6)), 1.0);
    } else {
      mv = modelViewMatrix * vec4(p, 1.0);
      dist = length(mv.xyz);
    }

    float m = effectiveMagnitude(aAbsMag, dist);
    float alpha = starAlpha(m) * uDim * mix(1.0, mix(0.045, 1.0, aFade), uFilterMix);
    // The star we are standing at is not part of its own sky (inside a system, the system view draws it).
    if (uSky > 0.5 && dist < uHide) alpha = 0.0;

    vColor = aColor;
    vAlpha = alpha;
    gl_Position = projectionMatrix * mv;
    // Pin to the far plane: never clipped by depth range, still hidden behind solid objects.
    gl_Position.z = gl_Position.w * 0.99999;
    gl_PointSize = starSize(m) * 2.2 * uPixelRatio;
  }
`

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(p, p);
    if (r2 > 1.0) discard;
    float core = exp(-r2 * 11.0);
    float halo = exp(-r2 * 3.0) * 0.2;
    float intensity = (core + halo) * (1.0 - smoothstep(0.6, 1.0, r2));
    vec3 color = mix(vColor, vec3(1.0), core * 0.55);
    gl_FragColor = vec4(color * intensity * vAlpha, 1.0);
  }
`

interface Props {
  atlas: Atlas
  filter: FilterMask
}

/** Every star in the catalogue as one draw call of camera-facing point sprites. */
export function StarField({ atlas, filter }: Props) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uPixelRatio: { value: 1 },
          uRefDist: { value: view.refDist },
          uLimit: { value: view.limit },
          uDim: { value: 1 },
          uFilterMix: { value: 0 },
          uSky: { value: 0 },
          uOrigin: { value: new THREE.Vector3() },
          uHide: { value: 1e-3 },
          uEpoch: { value: 0 },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
      }),
    [],
  )

  const fade = useMemo(() => new THREE.BufferAttribute(new Uint8Array(atlas.count).fill(255), 1, true), [atlas])

  const geometry = useMemo(() => {
    const n = atlas.count
    const colors = new Uint8Array(n * 3)
    for (let i = 0; i < n; i++) {
      const [r, g, b] = starColor(atlas.ci[i])
      colors[i * 3] = Math.round(r * 255)
      colors[i * 3 + 1] = Math.round(g * 255)
      colors[i * 3 + 2] = Math.round(b * 255)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(atlas.pos, 3))
    g.setAttribute('aAbsMag', new THREE.BufferAttribute(atlas.absmag, 1))
    g.setAttribute('aColor', new THREE.BufferAttribute(colors, 3, true))
    g.setAttribute('aFade', fade)
    g.setAttribute('aVel', new THREE.BufferAttribute(atlas.vel, 3))
    // Rows are sorted brightest-first, so drawing a prefix is a clean magnitude cut for small devices.
    if (isCompactDevice()) g.setDrawRange(0, Math.min(n, 60000))
    return g
  }, [atlas, fade])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  // Re-upload the per-star mask whenever the filter result changes.
  useEffect(() => {
    if (!filter.active) return
    ;(fade.array as Uint8Array).set(filter.mask)
    fade.needsUpdate = true
  }, [filter, fade])

  const filterMix = useRef(0)
  useFrame((_, delta) => {
    const u = material.uniforms
    // Inside a system the sky is just a backdrop: never dim it by the browser's filters.
    filterMix.current += ((filter.active && !view.sky ? 1 : 0) - filterMix.current) * Math.min(1, delta * 7)
    u.uPixelRatio.value = view.pixelRatio
    u.uRefDist.value = view.refDist
    u.uLimit.value = view.limit
    u.uDim.value = view.dim
    u.uFilterMix.value = filterMix.current
    u.uSky.value = view.sky ? 1 : 0
    ;(u.uOrigin.value as THREE.Vector3).copy(view.origin)
    u.uHide.value = originExclusion()
    u.uEpoch.value = view.epoch
  })

  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={-10} />
}
