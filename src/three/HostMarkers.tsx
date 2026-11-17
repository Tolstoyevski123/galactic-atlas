import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Atlas } from '../data/atlas'
import { discoveryOf, firstYearOfStars } from '../lib/discovery'
import { buildHostOrbits } from './hostOrbits'
import type { FilterMask } from './useFilterMask'
import { view } from './view'

/**
 * One point sprite per host star, drawn in a single call. Far from the camera's focus a host is
 * a speck of gold; near it, the sprite unfolds into the system itself in miniature: a tilted
 * disc of orbits (an ellipse on screen, from the orbital plane's real orientation), the near
 * side brighter than the far side, with a planet travelling along every orbit.
 */

const vertexShader = /* glsl */ `
  attribute float aFade;
  attribute vec3 aNormal;
  attribute vec3 aStar;
  attribute vec4 aRadiiA;
  attribute vec4 aRadiiB;
  attribute vec4 aSpeedA;
  attribute vec4 aSpeedB;
  attribute vec4 aPhaseA;
  attribute vec4 aPhaseB;
  attribute vec3 aInfo;
  attribute vec3 aVel;
  attribute float aYear;

  uniform float uEpoch;
  uniform float uYear;
  uniform float uPixelRatio;
  uniform float uMarkerRef;
  uniform vec3 uTarget;
  uniform float uFilterMix;
  uniform float uOpacity;
  uniform float uTime;

  varying float vAlpha;
  varying float vRing;
  varying float vTilt;
  varying float vFront;
  varying float vHalfPx;
  varying float vMask;
  varying float vHome;
  varying vec2 vMinor;
  varying vec3 vStar;
  varying vec4 vRadiiA;
  varying vec4 vRadiiB;
  varying vec4 vAngleA;
  varying vec4 vAngleB;

  void main() {
    // Time machine (CPU twin: starPositionAt).
    vec3 p = position + aVel * uEpoch;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float dist = length(mv.xyz);

    // Keep in step with hostRingness() / hostMarkerRadius() in view.ts.
    float toTarget = distance(p, uTarget);
    float focus = 1.0 - smoothstep(0.22 * uMarkerRef, 0.6 * uMarkerRef, toTarget);
    float local = 1.0 - smoothstep(60.0, 170.0, uMarkerRef);
    float ringness = focus * local;
    float ratio = uMarkerRef / max(dist, 1e-3);
    float dotRadius = clamp(1.65 * pow(ratio, 0.35), 1.15, 2.75);
    float systemRadius = clamp((8.0 + 2.0 * min(aInfo.y - 1.0, 7.0)) * sqrt(ratio), 7.0, 30.0);
    // The system the camera is orbiting gets room to breathe: a preview of what a dive will show.
    systemRadius *= 1.0 + 1.7 * (1.0 - smoothstep(0.0, 0.1 * uMarkerRef, toTarget));

    // The sprite is a square of half-size vHalfPx; the outermost orbit reaches 1/1.3 of it.
    vHalfPx = mix(dotRadius * 2.5, systemRadius * 1.3, ringness);
    vRing = ringness;
    float dotAlpha = 0.28 + 0.42 * smoothstep(1.15, 2.5, dotRadius);
    vAlpha = mix(dotAlpha, 1.0, ringness) * uOpacity * mix(1.0, mix(0.05, 1.0, aFade), uFilterMix);

    // Discovery timeline (CPU twin: isDiscovered). aYear 0 = always known. Newly found hosts flash for a year.
    float age = uYear - aYear;
    if (aYear > 0.5 && age <= 0.0) vAlpha = 0.0;
    float flash = aYear > 0.5 ? 1.0 - smoothstep(0.0, 1.0, age) : 0.0;
    vAlpha = min(1.6, vAlpha * (1.0 + 1.6 * flash));
    vHalfPx *= 1.0 + 1.4 * flash;

    // How the orbital plane projects onto the screen: an ellipse whose minor axis lies along
    // the projected normal and is foreshortened by |normal · view direction|.
    float facing = dot(aNormal, normalize(cameraPosition - p));
    vTilt = max(abs(facing), 0.07);
    vec2 projected = (mat3(viewMatrix) * aNormal).xy;
    float len = length(projected);
    vMinor = len > 1e-4 ? projected / len : vec2(0.0, 1.0);
    // The half of the disc on the far side of the star lies along +minor when the normal faces us.
    vFront = facing >= 0.0 ? -1.0 : 1.0;

    vStar = aStar;
    vMask = aInfo.x;
    vHome = aInfo.z;
    vRadiiA = aRadiiA;
    vRadiiB = aRadiiB;
    vAngleA = aPhaseA + uTime * aSpeedA;
    vAngleB = aPhaseB + uTime * aSpeedB;

    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w * 0.99998;
    gl_PointSize = 2.0 * vHalfPx * uPixelRatio;
  }
`

const fragmentShader = /* glsl */ `
  varying float vAlpha;
  varying float vRing;
  varying float vTilt;
  varying float vFront;
  varying float vHalfPx;
  varying float vMask;
  varying float vHome;
  varying vec2 vMinor;
  varying vec3 vStar;
  varying vec4 vRadiiA;
  varying vec4 vRadiiB;
  varying vec4 vAngleA;
  varying vec4 vAngleB;

  const float REACH = 0.769; // 1 / 1.3: where the outermost orbit sits inside the sprite

  // Component k of the eight values packed into two vec4s (no dynamic vector indexing: some
  // drivers translate that into code that reads out of range).
  float pick(vec4 a, vec4 b, int k) {
    if (k == 0) return a.x;
    if (k == 1) return a.y;
    if (k == 2) return a.z;
    if (k == 3) return a.w;
    if (k == 4) return b.x;
    if (k == 5) return b.y;
    if (k == 6) return b.z;
    return b.w;
  }

  void main() {
    vec2 p = vec2(gl_PointCoord.x * 2.0 - 1.0, 1.0 - gl_PointCoord.y * 2.0);
    float r = length(p);
    if (r > 1.0) discard;

    vec3 accent = mix(vec3(1.0, 0.76, 0.3), vec3(0.62, 0.86, 1.0), vHome);

    // Far away: a soft dot.
    float dotCore = exp(-r * r * 22.0);
    vec3 color = mix(accent, vec3(1.0, 0.96, 0.86), dotCore * 0.6) * (dotCore * 1.3 + exp(-r * r * 4.0) * 0.22) * (1.0 - vRing);

    if (vRing > 0.01) {
      vec2 major = vec2(-vMinor.y, vMinor.x);
      // Position in the orbital plane, in units of the outermost orbit.
      vec2 plane = vec2(dot(p, major), dot(p, vMinor) / vTilt) / REACH;
      float radius = length(plane);
      float edge = max(fwidth(radius), 1e-4); // plane units per pixel → constant line width on screen
      // +1 on the near side of the star, −1 on the far side; only matters when the disc is tilted.
      float near = radius > 1e-4 ? plane.y / radius * vFront : 0.0;
      float shade = mix(1.0, 0.6 + 0.4 * near, 1.0 - vTilt);

      float lines = 0.0;
      vec3 planets = vec3(0.0);
      float planetSize = clamp(0.055 * vHalfPx, 1.5, 2.9); // px; a touch larger on the focused system
      for (int k = 0; k < 8; k++) {
        float orbit = pick(vRadiiA, vRadiiB, k);
        if (orbit <= 0.0) continue;
        lines += (1.0 - smoothstep(0.0, 1.05, abs(radius - orbit) / edge)) * 0.75;

        float angle = pick(vAngleA, vAngleB, k);
        vec2 where = vec2(cos(angle), sin(angle)) * orbit * REACH;
        vec2 onScreen = major * where.x + vMinor * where.y * vTilt;
        float pixels = length(p - onScreen) * vHalfPx;
        float planetShade = mix(1.0, 0.55 + 0.45 * sin(angle) * vFront, 1.0 - vTilt);
        float habitable = mod(floor(vMask / exp2(float(k))), 2.0);
        vec3 tint = mix(vec3(1.0, 0.95, 0.84), vec3(0.42, 1.0, 0.58), habitable);
        planets += tint * (1.0 - smoothstep(planetSize * 0.5, planetSize, pixels)) * planetShade;
      }

      // The star itself, in its own colour, so even a faint red dwarf anchors its system.
      float starPixels = r * vHalfPx;
      vec3 starGlow = mix(vStar, vec3(1.0), exp(-starPixels * starPixels / 2.2) * 0.7) * (exp(-starPixels * starPixels / 5.5) + exp(-starPixels * starPixels / 40.0) * 0.18);

      vec3 system = accent * min(lines, 1.0) * 0.6 * shade + planets + starGlow;
      color += system * vRing * (1.0 - smoothstep(0.9, 1.0, r));
    }

    gl_FragColor = vec4(color * vAlpha, 1.0);
  }
`

interface Props {
  atlas: Atlas
  filter: FilterMask
  visible: boolean
}

export function HostMarkers({ atlas, filter, visible }: Props) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uPixelRatio: { value: 1 },
          uMarkerRef: { value: view.markerRef },
          uTarget: { value: new THREE.Vector3() },
          uFilterMix: { value: 0 },
          uOpacity: { value: 0 },
          uTime: { value: 0 },
          uEpoch: { value: 0 },
          uYear: { value: 1e9 },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
      }),
    [],
  )

  const orbits = useMemo(() => buildHostOrbits(atlas), [atlas])
  const fade = useMemo(() => new THREE.BufferAttribute(new Uint8Array(orbits.stars.length).fill(255), 1, true), [orbits])

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(orbits.positions, 3))
    g.setAttribute('aNormal', new THREE.BufferAttribute(orbits.normals, 3))
    g.setAttribute('aStar', new THREE.BufferAttribute(orbits.colors, 3, true))
    g.setAttribute('aRadiiA', new THREE.BufferAttribute(orbits.radiiA, 4))
    g.setAttribute('aRadiiB', new THREE.BufferAttribute(orbits.radiiB, 4))
    g.setAttribute('aSpeedA', new THREE.BufferAttribute(orbits.speedA, 4))
    g.setAttribute('aSpeedB', new THREE.BufferAttribute(orbits.speedB, 4))
    g.setAttribute('aPhaseA', new THREE.BufferAttribute(orbits.phaseA, 4))
    g.setAttribute('aPhaseB', new THREE.BufferAttribute(orbits.phaseB, 4))
    g.setAttribute('aInfo', new THREE.BufferAttribute(orbits.info, 3))
    g.setAttribute('aFade', fade)
    // Per marker: velocity (time machine) and the year its first planet was found (discovery timeline).
    const vel = new Float32Array(orbits.stars.length * 3)
    orbits.stars.forEach((star, k) => vel.set(atlas.vel.subarray(star * 3, star * 3 + 3), k * 3))
    g.setAttribute('aVel', new THREE.BufferAttribute(vel, 3))
    g.setAttribute('aYear', new THREE.BufferAttribute(firstYearOfStars(discoveryOf(atlas), atlas.systemOfStar, orbits.stars), 1))
    return g
  }, [atlas, orbits, fade])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  useEffect(() => {
    if (!filter.active) return
    const array = fade.array as Uint8Array
    for (let k = 0; k < orbits.stars.length; k++) array[k] = filter.mask[orbits.stars[k]]
    fade.needsUpdate = true
  }, [filter, fade, orbits])

  const filterMix = useRef(0)
  const clock = useRef(0)
  useFrame((_, delta) => {
    const u = material.uniforms
    clock.current += Math.min(delta, 0.1)
    filterMix.current += ((filter.active ? 1 : 0) - filterMix.current) * Math.min(1, delta * 7)
    u.uPixelRatio.value = view.pixelRatio
    u.uMarkerRef.value = view.markerRef
    ;(u.uTarget.value as THREE.Vector3).copy(view.target)
    u.uFilterMix.value = filterMix.current
    u.uTime.value = clock.current
    u.uEpoch.value = view.epoch
    u.uYear.value = Number.isFinite(view.year) ? view.year : 1e9
    u.uOpacity.value += ((visible ? 1 : 0) - u.uOpacity.value) * Math.min(1, delta * 6)
  })

  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={-5} />
}
