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
  /**
   * Sky mode: stars are drawn as directions seen from `origin` — the backdrop inside a system, and
   * the whole picture when standing at a star ("Buradan gökyüzü").
   */
  sky: false,
  origin: new Vector3(),
  /** Time machine: years from today (negative = past). Stars are drawn at position + velocity · epoch. */
  epoch: 0,
  /**
   * Discovery timeline: hosts whose first planet was found after this (fractional) year are
   * hidden, those found within the year before it flash. Infinity = no timeline, show everything.
   */
  year: Infinity,
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

/** How long a year lasts while the discovery timeline plays, seconds. */
export const SECONDS_PER_DISCOVERY_YEAR = 1.5

/**
 * Move view.year towards the year chosen on the discovery timeline (null = timeline closed).
 * The value runs one ahead of the calendar — Y + 1 stands for "the end of year Y" — and it glides
 * rather than jumps, so the hosts found in a year have a moment to flash as it passes.
 */
export function advanceDiscoveryYear(chosen: number | null, delta: number, instant: boolean): void {
  if (chosen === null) {
    view.year = Infinity
    return
  }
  const goal = chosen + 1
  if (instant || !Number.isFinite(view.year)) {
    view.year = goal
    return
  }
  const gap = goal - view.year
  // One year per 1.5 s while playing; a jump made by hand catches up within a few tenths of a second.
  const step = Math.max(1 / SECONDS_PER_DISCOVERY_YEAR, Math.abs(gap) * 10) * delta
  view.year = Math.abs(gap) <= step ? goal : view.year + Math.sign(gap) * step
}

/** Stars closer to the sky-mode origin than this are the star being stood on: never drawn or picked. */
export function originExclusion(): number {
  // Wider far from the Sun, where 32-bit positions on the GPU are coarser than a fixed threshold.
  return 1e-3 + view.origin.length() * 4e-6
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
