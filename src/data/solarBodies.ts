/**
 * What the app knows about the look of the Sun's own planets, the only worlds we have real
 * pictures of. Keys are the planet ids of the bundled Solar System (see scripts/build-data).
 *
 * The maps in public/textures come from NASA's 3D models (npm run textures); tilts and shapes
 * are from the NASA Planetary Fact Sheet.
 */

export interface SolarBody {
  /** File in public/textures. */
  texture: string
  /** Tilt of the rotation axis against the orbit, degrees. */
  tilt: number
  /** Polar radius / equatorial radius. */
  flattening: number
  /** Colour of the thin glow at the limb, as a hex string; black for airless worlds. */
  limb: string
  /** Rings: inner and outer edge in planet radii, and the radial colour strip. */
  rings?: { inner: number; outer: number; texture: string }
}

export const SUN_TEXTURE = 'gunes.jpg'

export const SOLAR_BODIES: Record<string, SolarBody> = {
  merkur: { texture: 'merkur.jpg', tilt: 0.03, flattening: 1, limb: '#000000' },
  // Venus spins backwards (177°); as a tilt of the globe that is 3° the other way.
  venus: { texture: 'venus.jpg', tilt: -2.6, flattening: 1, limb: '#8a7a4a' },
  dunya: { texture: 'dunya.jpg', tilt: 23.44, flattening: 0.997, limb: '#3f7fd0' },
  mars: { texture: 'mars.jpg', tilt: 25.19, flattening: 0.994, limb: '#7a4a30' },
  jupiter: { texture: 'jupiter.jpg', tilt: 3.13, flattening: 0.935, limb: '#5a4a3a' },
  // Ring edges as modelled by NASA: from the C ring's inner edge out to the F ring.
  saturn: { texture: 'saturn.jpg', tilt: 26.73, flattening: 0.902, limb: '#5a4c34', rings: { inner: 1.232, outer: 2.331, texture: 'saturn-halkalar.png' } },
  uranus: { texture: 'uranus.jpg', tilt: 97.77, flattening: 0.977, limb: '#4f9aa8' },
  neptun: { texture: 'neptun.jpg', tilt: 28.32, flattening: 0.983, limb: '#3a5fc0' },
}

export const textureUrl = (file: string): string => `${import.meta.env.BASE_URL}textures/${file}`
