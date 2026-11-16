/**
 * Constellation figures: which stars the traditional stick figures connect.
 *
 * Source: Stellarium's "modern" sky culture (the 88 IAU constellations), whose line data is
 * published under CC BY-SA 4.0. Each figure is a set of polylines of Hipparcos numbers; here they
 * are resolved to rows of our own star table, so the app can draw them between the stars' real
 * 3D positions.
 */

import { join } from 'node:path'
import type { ConstellationFigure } from '../../src/data/schema'
import { fetchCached } from './util'

export const CONSTELLATIONS_URL = 'https://raw.githubusercontent.com/Stellarium/stellarium/master/skycultures/modern/index.json'

interface SkyCulture {
  constellations: Array<{ id: string; lines: number[][] }>
}

/**
 * `rowOfHip` maps a Hipparcos number to a star row; stars without a row (no measured distance)
 * simply interrupt the polyline they belong to.
 */
export async function loadConstellationFigures(
  cacheDir: string,
  refresh: boolean,
  rowOfHip: ReadonlyMap<number, number>,
): Promise<{ figures: ConstellationFigure[]; segments: number; missingStars: number }> {
  const text = await fetchCached(CONSTELLATIONS_URL, join(cacheDir, 'stellarium', 'modern.json'), refresh)
  const culture = JSON.parse(text) as SkyCulture
  let segments = 0
  const missing = new Set<number>()
  const figures: ConstellationFigure[] = []
  for (const entry of culture.constellations) {
    const abbr = entry.id.split(' ').pop() ?? '' // "CON modern Aql" → "Aql"
    const lines: number[][] = []
    for (const polyline of entry.lines) {
      let run: number[] = []
      const flush = () => {
        if (run.length > 1) {
          lines.push(run)
          segments += run.length - 1
        }
        run = []
      }
      for (const hip of polyline) {
        const row = rowOfHip.get(hip)
        if (row === undefined) {
          missing.add(hip)
          flush()
        } else if (run[run.length - 1] !== row) {
          run.push(row)
        }
      }
      flush()
    }
    if (abbr && lines.length > 0) figures.push({ abbr, lines })
  }
  figures.sort((a, b) => a.abbr.localeCompare(b.abbr))
  return { figures, segments, missingStars: missing.size }
}
