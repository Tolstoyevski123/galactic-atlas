/**
 * Per-host data for the map's "mini system" markers: instead of an abstract ring, a host near
 * the camera's focus is drawn as its actual planetary system in miniature.
 *
 * What is real:   one orbit per planet, relative sizes from the semi-major axes (√ scale),
 *                 inner planets faster than outer ones, the tilt of the orbital plane to our
 *                 line of sight where it has been measured (every transiting system is edge-on
 *                 as seen from the Sun), the star's own colour, green for habitable-zone planets.
 * What is not:    absolute size (a 1 AU orbit at 10 pc spans 0.1 arcsecond — far below a pixel),
 *                 the plane's rotation about the line of sight (unmeasured: stable pseudo-random),
 *                 and the speeds, which are compressed so outer planets still visibly move.
 */

import type { Atlas } from '../data/atlas'
import { HZ_NONE, type SystemRecord } from '../data/schema'
import { equatorialToScene, hash01, starColor } from '../lib/astro'

export const MAX_RINGS = 8
const TAU = Math.PI * 2

type Vec3 = [number, number, number]

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const normalize = (v: Vec3): Vec3 => {
  const length = Math.hypot(v[0], v[1], v[2])
  return length > 0 ? [v[0] / length, v[1] / length, v[2] / length] : [0, 1, 0]
}

/** North pole of the ecliptic (the Solar System's orbital plane) in the scene frame. */
export function eclipticPole(): Vec3 {
  const obliquity = (23.4392911 * Math.PI) / 180
  const scene = equatorialToScene(new Float32Array([0, -Math.sin(obliquity), Math.cos(obliquity)]))
  return [scene[0], scene[1], scene[2]]
}

/**
 * Unit normal of a system's orbital plane in the scene frame.
 * `inclinationDeg` is the angle between that normal and the line of sight from the Sun.
 */
export function orbitNormal(position: Vec3, inclinationDeg: number | undefined, seed: string): Vec3 {
  if (inclinationDeg === undefined || !Number.isFinite(inclinationDeg)) {
    // Unknown orientation: uniformly random on the sphere (stable per system).
    const z = 2 * hash01(seed, 11) - 1
    const phi = TAU * hash01(seed, 12)
    const s = Math.sqrt(1 - z * z)
    return [s * Math.cos(phi), s * Math.sin(phi), z]
  }
  const sight = normalize(position)
  const helper: Vec3 = Math.abs(sight[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0]
  const e1 = normalize(cross(sight, helper))
  const e2 = cross(sight, e1)
  const i = (inclinationDeg * Math.PI) / 180
  const node = TAU * hash01(seed, 13) // position angle on the sky is not in the data
  const ci = Math.cos(i)
  const si = Math.sin(i)
  const cn = Math.cos(node)
  const sn = Math.sin(node)
  return normalize([
    ci * sight[0] + si * (cn * e1[0] + sn * e2[0]),
    ci * sight[1] + si * (cn * e1[1] + sn * e2[1]),
    ci * sight[2] + si * (cn * e1[2] + sn * e2[2]),
  ])
}

export interface RingSet {
  /** Orbit radii, outermost = 1; unused slots are 0. */
  radii: number[]
  /** Angular speeds, radians per second. */
  speeds: number[]
  /** Starting angles, radians. */
  phases: number[]
  /** Bit k is set when ring k's planet is in the habitable zone. */
  hzMask: number
  count: number
}

/** The orbits to draw for a system: up to MAX_RINGS planets with a known (or derivable) orbit size. */
export function systemRings(system: SystemRecord): RingSet {
  const stellarMass = system.mass ?? 1
  const orbits = system.planets
    .map((planet) => {
      const a = planet.a ?? (planet.period != null ? Math.cbrt(stellarMass * (planet.period / 365.25) ** 2) : NaN)
      const period = planet.period ?? (Number.isFinite(a) ? 365.25 * Math.sqrt(a ** 3 / stellarMass) : NaN)
      return { planet, a, period }
    })
    .filter((o) => Number.isFinite(o.a) && o.a > 0)
    .sort((p, q) => p.a - q.a)
    .slice(0, MAX_RINGS)

  const radii = new Array<number>(MAX_RINGS).fill(0)
  const speeds = new Array<number>(MAX_RINGS).fill(0)
  const phases = new Array<number>(MAX_RINGS).fill(0)
  let hzMask = 0

  if (orbits.length === 0) {
    // Nothing is known about the orbit: still show that a planet is there.
    const planet = system.planets[0]
    radii[0] = 1
    speeds[0] = TAU / 9
    phases[0] = planet ? TAU * hash01(planet.id, 2) : 0
    if (planet && planet.hz !== HZ_NONE) hzMask = 1
    return { radii, speeds, phases, hzMask, count: 1 }
  }

  const outer = orbits[orbits.length - 1].a
  const fastest = Math.min(...orbits.map((o) => (Number.isFinite(o.period) && o.period > 0 ? o.period : Infinity)))
  // Seconds for the innermost planet to complete a lap; a little different for every system.
  const lap = 6 + 4 * hash01(system.id, 5)
  orbits.forEach((o, k) => {
    radii[k] = orbits.length === 1 ? 1 : 0.28 + 0.72 * Math.sqrt(o.a / outer)
    const ratio = Number.isFinite(o.period) && Number.isFinite(fastest) ? o.period / fastest : 1
    speeds[k] = TAU / Math.min(300, lap * Math.sqrt(Math.max(1, ratio)))
    phases[k] = TAU * hash01(o.planet.id, 2)
    if (o.planet.hz !== HZ_NONE) hzMask |= 1 << k
  })
  return { radii, speeds, phases, hzMask, count: orbits.length }
}

export interface HostOrbitBuffers {
  /** Star row behind each marker. Exoplanet hosts first, the Sun last. */
  stars: Int32Array
  positions: Float32Array
  normals: Float32Array
  /** Star colour, 0..255 per channel. */
  colors: Uint8Array
  radiiA: Float32Array
  radiiB: Float32Array
  speedA: Float32Array
  speedB: Float32Array
  phaseA: Float32Array
  phaseB: Float32Array
  /** x: habitable-zone bit mask, y: ring count, z: 1 for the Solar System (drawn in blue), else 0. */
  info: Float32Array
}

export function buildHostOrbits(atlas: Atlas): HostOrbitBuffers {
  const stars = Int32Array.from([...atlas.hosts, 0])
  const n = stars.length
  const out: HostOrbitBuffers = {
    stars,
    positions: new Float32Array(n * 3),
    normals: new Float32Array(n * 3),
    colors: new Uint8Array(n * 3),
    radiiA: new Float32Array(n * 4),
    radiiB: new Float32Array(n * 4),
    speedA: new Float32Array(n * 4),
    speedB: new Float32Array(n * 4),
    phaseA: new Float32Array(n * 4),
    phaseB: new Float32Array(n * 4),
    info: new Float32Array(n * 3),
  }
  const pole = eclipticPole()

  for (let m = 0; m < n; m++) {
    const star = stars[m]
    const system = atlas.systems[atlas.systemOfStar[star]]
    const position: Vec3 = [atlas.pos[star * 3], atlas.pos[star * 3 + 1], atlas.pos[star * 3 + 2]]
    const normal = system.builtin ? pole : orbitNormal(position, system.incl, system.id)
    const rings = systemRings(system)
    const [r, g, b] = starColor(atlas.ci[star], 1.25)

    out.positions.set(position, m * 3)
    out.normals.set(normal, m * 3)
    out.colors.set([Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)], m * 3)
    out.radiiA.set(rings.radii.slice(0, 4), m * 4)
    out.radiiB.set(rings.radii.slice(4, 8), m * 4)
    out.speedA.set(rings.speeds.slice(0, 4), m * 4)
    out.speedB.set(rings.speeds.slice(4, 8), m * 4)
    out.phaseA.set(rings.phases.slice(0, 4), m * 4)
    out.phaseB.set(rings.phases.slice(4, 8), m * 4)
    out.info.set([rings.hzMask, rings.count, system.builtin ? 1 : 0], m * 3)
  }
  return out
}
