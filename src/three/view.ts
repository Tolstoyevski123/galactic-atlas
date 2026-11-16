/**
 * Per-frame view parameters shared by everything that draws or picks stars.
 *
 * Star brightness is physical: each star gets the apparent magnitude it would have from the
 * camera, m = M + 5·log10(d / d_ref), with d_ref = 10 pc — so anywhere inside the catalogue you
 * see the real sky of that spot. Only when the camera leaves the catalogued neighbourhood does
 * d_ref grow (an exposure boost), so the cloud does not fade to black. The same formula runs on
 * the GPU (STAR_BRIGHTNESS_GLSL) and on the CPU (picking, label level-of-detail), so what you
 * can click is exactly what you can see.
 */

import { Vector3 } from 'three'
import { clamp } from '../lib/astro'

export const view = {
  /** Reference distance d_ref, parsec. */
  refDist: 10,
  /** Faintest magnitude drawn at full strength. */
  limit: 6.5,
  /** Distance at which a host marker has its nominal size: the camera–target distance. */
  markerRef: 30,
  /** Sky mode: stars are drawn as directions seen from `origin` (used inside a system). */
  sky: false,
  origin: new Vector3(),
  /** Overall star-field brightness, 0..1. */
  dim: 1,
  /** Camera position in scene coordinates. */
  camera: new Vector3(),
  /** Orbit target in scene coordinates. */
  target: new Vector3(),
  pixelRatio: 1,
  width: 1,
  height: 1,
  /** Width in CSS px covered by panels on each side; the view centre shifts to the gap between them. */
  insetLeft: 0,
  insetRight: 0,
  /** Height covered by the bottom sheet on phones; the view centre moves up by half of it. */
  insetBottom: 0,
}

/** The catalogue thins out beyond this distance from the Sun (parsec); exposure rises past it. */
const CATALOGUE_RADIUS = 350

/**
 * d_ref for a camera `cameraToSun` parsec from the Sun, orbiting `cameraToTarget` parsec from its
 * target. Two gentle exposure boosts on top of the true 10 pc: up to +2 mag as the view widens
 * from one star to a neighbourhood, and an unbounded one once the camera is outside the catalogue.
 */
export function referenceDistance(cameraToSun: number, cameraToTarget: number): number {
  const neighbourhood = Math.min(25, 10 * Math.sqrt(Math.max(1, cameraToTarget / 10)))
  return Math.max(neighbourhood, (10 * cameraToSun) / CATALOGUE_RADIUS)
}

export const MAGNITUDE_LIMIT = 6.5

export function effectiveMagnitude(absmag: number, distance: number, refDist: number): number {
  return absmag + 5 * Math.log10(Math.max(distance, 1e-4) / refDist)
}

/** On-screen diameter in CSS pixels of a star of effective magnitude m. */
export function starSize(m: number, limit: number): number {
  return clamp(1.35 + 1.05 * (limit - m), 1.1, 22)
}

export function starAlpha(m: number, limit: number): number {
  const v = limit - m
  return v >= 0 ? Math.min(1, 0.5 + 0.17 * v) : 0.5 * Math.exp(0.95 * v)
}

/** GLSL twin of effectiveMagnitude / starSize / starAlpha. Expects uRefDist and uLimit uniforms. */
export const STAR_BRIGHTNESS_GLSL = /* glsl */ `
  float effectiveMagnitude(float absMag, float dist) {
    return absMag + 5.0 * log(max(dist, 1e-4) / uRefDist) * 0.4342944819;
  }
  float starSize(float m) {
    return clamp(1.35 + 1.05 * (uLimit - m), 1.1, 22.0);
  }
  float starAlpha(float m) {
    float v = uLimit - m;
    return v >= 0.0 ? min(1.0, 0.5 + 0.17 * v) : 0.5 * exp(0.95 * v);
  }
`

/** Size (CSS px) of a host marker at `distance` from the camera. GLSL twin lives in HostMarkers. */
const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

/**
 * How strongly a host is drawn as a ring (1) rather than a dot (0). Rings are reserved for hosts
 * close to what the camera is orbiting, and only while looking at a neighbourhood: zoomed out,
 * thousands of rings would bury the stars, so hosts settle into fine gold dust instead.
 */
export function hostRingness(distanceToTarget: number, markerRef: number): number {
  const focus = 1 - smoothstep(0.22 * markerRef, 0.6 * markerRef, distanceToTarget)
  const local = 1 - smoothstep(60, 170, markerRef)
  return focus * local
}

/**
 * Radius in CSS px of a host's marker: a small dot from afar, the outermost orbit of its
 * miniature system when in focus (systems with more planets are drawn larger).
 * GLSL twin lives in HostMarkers.
 */
export function hostMarkerRadius(distance: number, markerRef: number, distanceToTarget: number, rings: number): number {
  const ratio = markerRef / Math.max(distance, 1e-3)
  const dot = clamp(1.65 * ratio ** 0.35, 1.15, 2.75)
  // The system being orbited is enlarged: a preview of what a dive will show.
  const boost = 1 + 1.7 * (1 - smoothstep(0, 0.1 * markerRef, distanceToTarget))
  const system = clamp((8 + 2 * Math.min(Math.max(rings, 1) - 1, 7)) * Math.sqrt(ratio), 7, 30) * boost
  return dot + (system - dot) * hostRingness(distanceToTarget, markerRef)
}
