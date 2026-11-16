import { describe, expect, it } from 'vitest'
import { BASE_CELL, cellAt, cellNumber, fromTangent, tileCorners, tilesInField, tileUrl, toTangent } from '../src/lib/hips'

const RAD = Math.PI / 180

describe('HEALPix / HiPS tiles', () => {
  it('numbers the twelve base cells as the standard does', () => {
    // Order 0: faces 0–3 around the north pole, 4–7 on the equator, 8–11 around the south pole.
    expect(cellNumber(cellAt(0, 45 * RAD, 80 * RAD))).toBe(0)
    expect(cellNumber(cellAt(0, 315 * RAD, 80 * RAD))).toBe(3)
    expect(cellNumber(cellAt(0, 0, 0))).toBe(4)
    expect(cellNumber(cellAt(0, 90 * RAD, 0))).toBe(5)
    expect(cellNumber(cellAt(0, 45 * RAD, -80 * RAD))).toBe(8)
  })

  it('finds the survey tile that holds Sirius', () => {
    // Checked against the live survey: this is the order-9 tile with Sirius in it.
    const cell = cellAt(9, 101.2872 * RAD, -16.7161 * RAD)
    expect(cellNumber(cell)).toBe(1340163)
    expect(tileUrl('https://example.org/dss', cell)).toBe('https://example.org/dss/Norder9/Dir1340000/Npix1340163.jpg')
  })

  it('nests: a cell is inside its parent at every order', () => {
    for (const [ra, dec] of [[10, 5], [101.3, -16.7], [200, 60], [300, -75], [37.95, 89.26]]) {
      for (let order = 1; order <= 9; order++) {
        const child = cellNumber(cellAt(order, ra * RAD, dec * RAD))
        const parent = cellNumber(cellAt(order - 1, ra * RAD, dec * RAD))
        expect(Math.floor(child / 4)).toBe(parent)
      }
    }
  })

  it('puts a position inside the corners of its own tile', () => {
    for (const [ra, dec] of [[56.87, 24.1], [269.45, 4.69], [37.95, 89.26], [317.2, -88.96], [180, -45]]) {
      const cell = cellAt(7, ra * RAD, dec * RAD)
      // Project the four corners about the position: the origin must fall inside the quadrilateral.
      const [p00, p10, p01, p11] = tileCorners(cell).map((c) => toTangent(c.ra, c.dec, ra * RAD, dec * RAD)!)
      const ring = [p00, p10, p11, p01]
      const turns = ring.map((a, i) => {
        const b = ring[(i + 1) % 4]
        return Math.sign(a.xi * b.eta - a.eta * b.xi)
      })
      expect(new Set(turns).size).toBe(1)
      // …and the tile has the size an order-7 cell should have.
      const side = Math.hypot(p10.xi - p00.xi, p10.eta - p00.eta)
      expect(side).toBeGreaterThan((BASE_CELL / 128) * 0.6)
      expect(side).toBeLessThan((BASE_CELL / 128) * 1.6)
    }
  })

  it('round-trips the tangent projection', () => {
    const back = fromTangent(0.01, -0.02, 1.2, 0.4)
    const again = toTangent(back.ra, back.dec, 1.2, 0.4)!
    expect(again.xi).toBeCloseTo(0.01, 12)
    expect(again.eta).toBeCloseTo(-0.02, 12)
  })

  it('covers a field with a handful of tiles, including across the pole', () => {
    const equator = tilesInField(8, 100 * RAD, 10 * RAD, 0.25 * RAD, 0.16 * RAD)
    expect(equator.length).toBeGreaterThanOrEqual(1)
    expect(equator.length).toBeLessThanOrEqual(6)
    const pole = tilesInField(7, 0, 89.9 * RAD, 0.5 * RAD, 0.3 * RAD)
    expect(new Set(pole.map((c) => c.face)).size).toBeGreaterThan(1)
  })
})
