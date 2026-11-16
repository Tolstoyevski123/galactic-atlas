/**
 * The Solar System, bundled as a reference so any exoplanet system can be compared with home.
 * Rounded values from the NASA Planetary Fact Sheet (public domain):
 * semi-major axis (AU), sidereal period (days), eccentricity, mean radius (R⊕), mass (M⊕)
 * and black-body temperature (K).
 */

export interface SolarPlanet {
  name: string
  a: number
  period: number
  ecc: number
  radius: number
  mass: number
  eqt: number
}

export const SOLAR_PLANETS: SolarPlanet[] = [
  { name: 'Merkür', a: 0.387, period: 87.969, ecc: 0.2056, radius: 0.383, mass: 0.0553, eqt: 440 },
  { name: 'Venüs', a: 0.723, period: 224.701, ecc: 0.0068, radius: 0.949, mass: 0.815, eqt: 227 },
  { name: 'Dünya', a: 1.0, period: 365.256, ecc: 0.0167, radius: 1.0, mass: 1.0, eqt: 254 },
  { name: 'Mars', a: 1.524, period: 686.98, ecc: 0.0934, radius: 0.532, mass: 0.107, eqt: 210 },
  { name: 'Jüpiter', a: 5.204, period: 4332.59, ecc: 0.0489, radius: 10.97, mass: 317.8, eqt: 110 },
  { name: 'Satürn', a: 9.583, period: 10759.22, ecc: 0.0565, radius: 9.14, mass: 95.2, eqt: 81 },
  { name: 'Uranüs', a: 19.2, period: 30685.4, ecc: 0.0457, radius: 3.98, mass: 14.5, eqt: 58 },
  { name: 'Neptün', a: 30.05, period: 60189, ecc: 0.0113, radius: 3.86, mass: 17.1, eqt: 47 },
]

export const SUN = { teff: 5772, lum: 1, rad: 1, mass: 1, spect: 'G2V' }
