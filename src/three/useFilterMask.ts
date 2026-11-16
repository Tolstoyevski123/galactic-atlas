import { useMemo } from 'react'
import { countPlanetFilters, countStarFilters } from '../browser/filterEngine'
import { useAtlas } from '../store/useAtlas'

export interface FilterMask {
  /** True when a filter is narrowing the active table and should be reflected on the map. */
  active: boolean
  /** Per star: 255 = matches the filter, 0 = does not. Only meaningful while `active`. */
  mask: Uint8Array
}

/**
 * Turns the data browser's current result into a per-star mask for the 3D map: with the Stars
 * tab open the matching stars stay lit; with the Planets tab open the hosts of matching planets do.
 *
 * Only real criteria switch this on. Typing a name into the search box is a way to *find*
 * something, and dimming the whole sky around the result would be disorienting.
 */
export function useFilterMask(): FilterMask {
  const atlas = useAtlas((s) => s.atlas)
  const tab = useAtlas((s) => s.tab)
  const mirror = useAtlas((s) => s.mirrorFilter)
  const starRows = useAtlas((s) => s.starRows)
  const planetRows = useAtlas((s) => s.planetRows)
  const starCriteria = useAtlas((s) => countStarFilters(s.starFilter))
  const planetCriteria = useAtlas((s) => countPlanetFilters(s.planetFilter))

  const mask = useMemo(() => new Uint8Array(atlas?.count ?? 0), [atlas])

  return useMemo(() => {
    const off: FilterMask = { active: false, mask }
    if (!atlas || !mirror) return off
    if (tab === 'stars') {
      if (starCriteria === 0 || !starRows || starRows.length >= atlas.count) return off
      mask.fill(0)
      for (let k = 0; k < starRows.length; k++) mask[starRows[k]] = 255
    } else {
      if (planetCriteria === 0 || !planetRows || planetRows.length >= atlas.exoPlanetCount) return off
      mask.fill(0)
      for (let k = 0; k < planetRows.length; k++) {
        const star = atlas.systems[atlas.planets[planetRows[k]].system].star
        if (star >= 0) mask[star] = 255
      }
    }
    return { active: true, mask }
  }, [atlas, tab, mirror, starRows, planetRows, starCriteria, planetCriteria, mask])
}
