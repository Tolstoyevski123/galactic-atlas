import { describe, expect, it } from 'vitest'
import { crossmatch, parseCatalogNumber, type CatalogStar, type HostInput } from '../scripts/build-data/crossmatch'
import { HYG_NO_DISTANCE, normalizeGliese, parseHyg } from '../scripts/build-data/fetch_hyg'
import {
  classifyHz,
  habitableZone,
  luminosityFromRadiusTeff,
  semiMajorAxisFromPeriod,
} from '../scripts/build-data/habitable_zone'
import { bvFromTeff, classFromTeff, spectralClass, teffFromBv } from '../scripts/build-data/stellar'
import { makeSlugger, parseCsv, separationArcsec, SkyIndex, slugify, unitVector } from '../scripts/build-data/util'
import { HZ_CONSERVATIVE, HZ_NONE, HZ_OPTIMISTIC, SPECT_OTHER, SPECT_UNKNOWN } from '../src/data/schema'

describe('habitable zone (Kopparapu 2014)', () => {
  it('reproduces the published limits for the Sun', () => {
    const hz = habitableZone(1, 5780)!
    expect(hz.optInner).toBeCloseTo(0.75, 2)
    expect(hz.inner).toBeCloseTo(0.95, 2)
    expect(hz.outer).toBeCloseTo(1.676, 2)
    expect(hz.optOuter).toBeCloseTo(1.768, 2)
    expect(hz.extrapolated).toBe(false)
  })

  it('scales with the square root of luminosity', () => {
    const one = habitableZone(1, 5780)!
    const four = habitableZone(4, 5780)!
    expect(four.inner / one.inner).toBeCloseTo(2, 6)
  })

  it('moves outward (per unit flux) for cooler stars and flags clamped temperatures', () => {
    const cool = habitableZone(1, 3000)!
    const sun = habitableZone(1, 5780)!
    expect(cool.inner).toBeGreaterThan(sun.inner)
    expect(cool.extrapolated).toBe(false)
    expect(habitableZone(0.0005, 2566)!.extrapolated).toBe(true)
    expect(habitableZone(1, null)!.extrapolated).toBe(true)
  })

  it('returns null without a usable luminosity', () => {
    expect(habitableZone(null, 5000)).toBeNull()
    expect(habitableZone(0, 5000)).toBeNull()
    expect(habitableZone(NaN, 5000)).toBeNull()
  })

  it('classifies Solar System planets sensibly', () => {
    const hz = habitableZone(1, 5772)!
    expect(classifyHz(0.723, hz)).toBe(HZ_NONE) // Venus
    expect(classifyHz(1.0, hz)).toBe(HZ_CONSERVATIVE) // Earth
    expect(classifyHz(1.524, hz)).toBe(HZ_CONSERVATIVE) // Mars
    expect(classifyHz(0.8, hz)).toBe(HZ_OPTIMISTIC)
    expect(classifyHz(5.2, hz)).toBe(HZ_NONE) // Jupiter
    expect(classifyHz(null, hz)).toBe(HZ_NONE)
    expect(classifyHz(1, null)).toBe(HZ_NONE)
  })

  it('has consistent helper physics', () => {
    expect(luminosityFromRadiusTeff(1, 5772)).toBeCloseTo(1, 6)
    expect(semiMajorAxisFromPeriod(365.25, 1)).toBeCloseTo(1, 6)
    expect(semiMajorAxisFromPeriod(4332.59, 1)).toBeCloseTo(5.2, 1) // Jupiter
  })
})

describe('stellar helpers', () => {
  it('reads spectral classes out of messy catalogue strings', () => {
    expect(spectralClass('G2V')).toBe(4)
    expect(spectralClass('sdM4')).toBe(6)
    expect(spectralClass('dG8')).toBe(4)
    expect(spectralClass('M8.0 V')).toBe(6)
    expect(spectralClass('K1/K2III')).toBe(5)
    expect(spectralClass('A0m...')).toBe(2)
    expect(spectralClass('m')).toBe(6)
    expect(spectralClass('DC9')).toBe(SPECT_OTHER)
    expect(spectralClass('L5')).toBe(SPECT_OTHER)
    expect(spectralClass('')).toBe(SPECT_UNKNOWN)
    expect(spectralClass(null)).toBe(SPECT_UNKNOWN)
  })

  it('maps temperature to class and inverts the B−V relation', () => {
    expect(classFromTeff(5772)).toBe(4)
    expect(classFromTeff(3000)).toBe(6)
    expect(classFromTeff(9500)).toBe(2)
    expect(classFromTeff(NaN)).toBe(SPECT_UNKNOWN)
    for (const bv of [-0.2, 0.3, 0.65, 1.2, 1.8]) expect(bvFromTeff(teffFromBv(bv))).toBeCloseTo(bv, 4)
  })
})

describe('utilities', () => {
  it('parses RFC 4180 CSV', () => {
    expect(parseCsv('a,b,c\r\n1,"x, y","he said ""hi"""\n,,\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x, y', 'he said "hi"'],
      ['', '', ''],
    ])
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('slugifies names and keeps slugs unique', () => {
    expect(slugify('TRAPPIST-1 e')).toBe('trappist-1-e')
    expect(slugify("Teegarden's Star")).toBe('teegarden-s-star')
    expect(slugify('Güneş')).toBe('gunes')
    const slug = makeSlugger()
    expect([slug('A b'), slug('a-b'), slug('A  B')]).toEqual(['a-b', 'a-b-2', 'a-b-3'])
  })

  it('measures angles and finds neighbours on the sky, including across RA = 0 and at the pole', () => {
    expect(separationArcsec(unitVector(10, 20), unitVector(10, 20 + 1 / 3600))).toBeCloseTo(1, 4)
    const points = [unitVector(359.99, 0), unitVector(120, 45), unitVector(200, 89.99)]
    const sky = new SkyIndex(points)
    expect(sky.nearest(unitVector(0.01, 0))!.index).toBe(0)
    expect(sky.nearest(unitVector(20, 89.99))!.index).toBe(2)
    expect(sky.within(unitVector(120, 45), 5).map((h) => h.index)).toEqual([1])
    expect(sky.nearest(unitVector(60, -60), 4)).toBeNull()
  })
})

describe('HYG parsing', () => {
  it('normalises Gliese designations', () => {
    expect(normalizeGliese('Gl 667C')).toBe('GJ 667 C')
    expect(normalizeGliese('GJ 1214')).toBe('GJ 1214')
    expect(normalizeGliese('Gl 4.1B')).toBe('GJ 4.1 B')
    expect(normalizeGliese('Gliese 12')).toBe('GJ 12')
    expect(normalizeGliese('HD 1234')).toBe('')
  })

  const header = 'id,hip,hd,hr,gl,bf,proper,ra,dec,dist,pmra,pmdec,rv,mag,absmag,spect,ci,x,y,z,vx,vy,vz,bayer,flam,con'
  const sirius =
    '32263,32349,48915,2491,Gl 244A,9Alp CMa,Sirius,6.752481,-16.716116,2.6371,-546.01,-1223.08,-9.4,-1.44,1.454,A0m...,0.009,-0.494323,2.476731,-0.758485,0.00000953,-0.00001207,-0.00001221,Alp,9,CMa'

  it('reads the columns it needs and converts right ascension to degrees', () => {
    const [star] = parseHyg(`${header}\n${sirius}\n`)
    expect(star.proper).toBe('Sirius')
    expect(star.hip).toBe(32349)
    expect(star.gl).toBe('GJ 244 A')
    expect(star.raDeg).toBeCloseTo(101.287, 2)
    expect(star.pm).toBeCloseTo(Math.hypot(546.01, 1223.08), 3)
  })

  it('reads space velocities in parsec per year and treats blanks as "not moving"', () => {
    const blank = '5,,,,,,,1.0,2.0,50,,,,9.1,5.6,,,-1,2,3,,,,,,Psc'
    const [star, still] = parseHyg(`${header}\n${sirius}\n${blank}\n`)
    expect([star.vx, star.vy, star.vz]).toEqual([0.00000953, -0.00001207, -0.00001221])
    // 1 pc/yr is 977,792 km/s: Sirius moves at about 19 km/s relative to the Sun.
    expect(Math.hypot(star.vx, star.vy, star.vz) * 977792).toBeCloseTo(19.3, 0)
    expect([still.vx, still.vy, still.vz]).toEqual([0, 0, 0])
  })

  it('refuses a file without the velocity columns', () => {
    expect(() => parseHyg(`${header.replace(',vx,vy,vz', '')}\n`)).toThrow(/vx/)
  })
})

describe('cross-matching hosts to the catalogue', () => {
  const star = (over: Partial<CatalogStar>): CatalogStar => ({ hip: 0, hd: 0, gl: '', raDeg: 0, decDeg: 0, dist: 10, mag: 8, pm: 0, ...over })
  const host = (over: Partial<HostInput>): HostInput => ({ host: 'X', hip: 0, hd: 0, ra: NaN, dec: NaN, dist: NaN, vmag: NaN, ...over })
  const catalog: CatalogStar[] = [
    star({ hip: 113357, hd: 217014, raDeg: 344.3666, decDeg: 20.7689, dist: 15.6, mag: 5.45 }), // 51 Peg
    star({ gl: 'GJ 667 C', raDeg: 259.745, decDeg: -34.997, dist: 7 }),
    star({ gl: 'GJ 876', raDeg: 343.32, decDeg: -14.26, dist: 4.7 }),
    star({ raDeg: 100, decDeg: 10, dist: 50, mag: 9, pm: 0 }),
    star({ hip: 87937, raDeg: 269.452, decDeg: 4.693, dist: 1.82, pm: 10358 }), // Barnard's Star
  ]

  it('parses catalogue numbers', () => {
    expect(parseCatalogNumber('HIP 113357', 'HIP')).toBe(113357)
    expect(parseCatalogNumber('HD 133131 A', 'HD')).toBe(133131)
    expect(parseCatalogNumber(null, 'HD')).toBe(0)
    expect(parseCatalogNumber('TIC 123', 'HD')).toBe(0)
  })

  it('prefers Hipparcos, then HD, then Gliese names', () => {
    const [a, b, c, d] = crossmatch(
      [
        host({ hip: 113357, ra: 344.3667, dec: 20.769 }),
        host({ hd: 217014 }), // same star, already claimed
        host({ host: 'GJ 667 C', ra: 259.745, dec: -34.997 }),
        host({ host: 'GJ 876 A' }),
      ],
      catalog,
    )
    expect(a).toMatchObject({ index: 0, method: 'hip' })
    expect(b).toBeNull()
    expect(c).toMatchObject({ index: 1, method: 'gj' })
    expect(d).toMatchObject({ index: 2, method: 'gj' })
  })

  it('rejects an identifier that points to the wrong part of the sky', () => {
    const [m] = crossmatch([host({ hip: 113357, ra: 10, dec: -50, dist: 15.6 })], catalog)
    expect(m).toBeNull()
  })

  it('falls back to position only when distance or brightness agrees', () => {
    const near = { ra: 100 + 3 / 3600, dec: 10 }
    const [ok, wrongDistance, byMagnitude, tooFar] = crossmatch(
      [host({ ...near, dist: 52 }), host({ ...near, dist: 400 }), host({ ...near, vmag: 9.2 }), host({ ra: 100.02, dec: 10, dist: 50 })],
      [catalog[3], star({ raDeg: 100, decDeg: 10, dist: 50, mag: 9 }), star({ raDeg: 100, decDeg: 10, dist: 50, mag: 9 })],
    )
    expect(ok).toMatchObject({ method: 'position' })
    expect(wrongDistance).toBeNull()
    expect(byMagnitude).toMatchObject({ method: 'position' })
    expect(tooFar).toBeNull()
  })

  it('allows for proper motion between catalogue epochs', () => {
    // Barnard's Star has moved ~2.7 arcminutes since J2000.
    const [m] = crossmatch([host({ hip: 87937, ra: 269.452, dec: 4.693 + 160 / 3600, dist: 1.83 })], catalog)
    expect(m).toMatchObject({ index: 4, method: 'hip' })
  })

  it('never matches a catalogue star without a distance by position alone', () => {
    const [m] = crossmatch([host({ ra: 50, dec: 5, dist: 30 })], [star({ raDeg: 50, decDeg: 5, dist: HYG_NO_DISTANCE, mag: 12 })])
    expect(m).toBeNull()
  })
})
