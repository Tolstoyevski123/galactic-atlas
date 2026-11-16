import type { ReactNode } from 'react'
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { planetKey, starKey, type Atlas } from '../data/atlas'
import { constellationName } from '../data/constellations'
import { methodLabel, methodShort, spectralColor } from '../data/labels'
import { FLAG_ABSMAG_EST, HZ_CONSERVATIVE, HZ_NONE, SPECT_UNKNOWN, SPECTRAL_CLASSES } from '../data/schema'
import { DASH, fixed, sig, toUnit, UNIT_LABEL, type Unit } from '../lib/format'
import { useAtlas } from '../store/useAtlas'
import { cx } from '../ui/controls'
import { LeafIcon, StarFilledIcon, StarIcon } from '../ui/icons'
import type { ColumnLayout, Features, RowRef } from './DataTable'

const helper = createColumnHelper<Features, RowRef>()

/** Star toggle shown in the first column; subscribes on its own so favouriting never rebuilds the table. */
function FavoriteCell({ id, name }: { id: string; name: string }) {
  const on = useAtlas((s) => s.favorites.includes(id))
  return (
    <button
      type="button"
      aria-label={on ? `${name}: favorilerden çıkar` : `${name}: favorilere ekle`}
      aria-pressed={on}
      onClick={(event) => {
        event.stopPropagation()
        useAtlas.getState().toggleFavorite(id)
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      className={cx(
        'grid size-6 place-items-center rounded-md transition',
        on ? 'text-gold' : 'text-faint opacity-0 group-hover/row:opacity-100 hover:text-gold focus-visible:opacity-100',
      )}
    >
      {on ? <StarFilledIcon size={13} /> : <StarIcon size={13} />}
    </button>
  )
}

/**
 * A sortable column. The accessor only exists so the table treats the column as sortable —
 * the actual ordering is done by the worker — and each cell renders from the row index.
 */
const column = (id: string, header: string, render: (row: number) => ReactNode) =>
  helper.accessor((item) => item.row, { id, header, cell: (context) => render(context.row.original.row) })

const muted = (text: string) => <span className="text-faint">{text}</span>
const number = (value: number, text: string) => (Number.isFinite(value) ? text : muted(DASH))

export interface TableColumns {
  columns: Array<ColumnDef<Features, RowRef>>
  layout: Record<string, ColumnLayout>
}

export function starColumns(atlas: Atlas, unit: Unit): TableColumns {
  const columns = helper.columns([
    helper.display({
      id: 'fav',
      header: () => null,
      enableSorting: false,
      cell: ({ row }) => <FavoriteCell id={starKey(atlas, row.original.row)} name={atlas.names[row.original.row]} />,
    }),
    column('name', 'Ad', (i) => (
      <span className={cx('truncate font-medium', atlas.planetCount[i] > 0 && 'text-gold')}>{atlas.names[i]}</span>
    )),
    column('dist', `Uzaklık (${UNIT_LABEL[unit]})`, (i) => sig(toUnit(atlas.dist[i], unit), 3)),
    column('mag', 'Kadir', (i) => number(atlas.mag[i], fixed(atlas.mag[i], 2))),
    column('absmag', 'Mutlak', (i) => {
      const estimated = (atlas.flags[i] & FLAG_ABSMAG_EST) !== 0
      return <span className={estimated ? 'text-muted' : undefined}>{(estimated ? '≈ ' : '') + fixed(atlas.absmag[i], 2)}</span>
    }),
    column('spect', 'Tayf', (i) => {
      const cls = atlas.spectClass[i]
      if (cls === SPECT_UNKNOWN) return muted(DASH)
      const text = atlas.meta.spectDict[atlas.spect[i]] || (cls < 7 ? `~${SPECTRAL_CLASSES[cls]}` : 'diğer')
      const color = spectralColor(cls)
      return (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="size-2 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}66` }} />
          <span className="truncate">{text}</span>
        </span>
      )
    }),
    column('ci', 'B−V', (i) => number(atlas.ci[i], fixed(atlas.ci[i], 2))),
    column('con', 'Tkm.', (i) => {
      const abbr = atlas.meta.constellations[atlas.con[i]]
      return abbr ? <span title={constellationName(abbr)}>{abbr}</span> : muted(DASH)
    }),
    column('planets', 'Gez.', (i) => {
      const n = atlas.planetCount[i]
      return n > 0 ? <span className="font-semibold text-gold">{n}</span> : muted('·')
    }),
  ])
  return {
    columns,
    layout: {
      fav: { width: 30, align: 'center' },
      name: { width: 148, primary: true },
      dist: { width: 88, align: 'right', hint: 'Güneş’e uzaklık' },
      mag: { width: 56, align: 'right', hint: 'Görünür kadir (V) — küçük sayı daha parlak' },
      absmag: { width: 68, align: 'right', hint: 'Mutlak kadir — 10 parsekten görünecek parlaklık' },
      spect: { width: 92, hint: 'Tayf tipi' },
      ci: { width: 52, align: 'right', hint: 'Renk indeksi B−V — küçük mavi, büyük kırmızı' },
      con: { width: 50, hint: 'Takımyıldız' },
      planets: { width: 46, align: 'right', hint: 'Onaylı ötegezegen sayısı' },
    },
  }
}

export function planetColumns(atlas: Atlas, unit: Unit): TableColumns {
  const planets = atlas.planets
  const value = (v: number | undefined, digits = 3) => (v != null ? sig(v, digits) : muted(DASH))
  const columns = helper.columns([
    helper.display({
      id: 'fav',
      header: () => null,
      enableSorting: false,
      cell: ({ row }) => <FavoriteCell id={planetKey(planets[row.original.row])} name={planets[row.original.row].name} />,
    }),
    column('name', 'Gezegen', (i) => {
      const p = planets[i]
      return (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium">{p.name}</span>
          {p.hz !== HZ_NONE && (
            <span className={cx('shrink-0', p.hz === HZ_CONSERVATIVE ? 'text-hz' : 'text-hz/55')}>
              <LeafIcon size={12} />
            </span>
          )}
        </span>
      )
    }),
    column('radius', 'R⊕', (i) => value(planets[i].radius)),
    column('mass', 'M⊕', (i) => value(planets[i].mass)),
    column('period', 'Periyot (g)', (i) => value(planets[i].period)),
    column('a', 'a (AU)', (i) => {
      const p = planets[i]
      if (p.a == null) return muted(DASH)
      return <span className={p.aEst ? 'text-muted' : undefined}>{(p.aEst ? '≈ ' : '') + sig(p.a, 3)}</span>
    }),
    column('eqt', 'T (K)', (i) => (planets[i].eqt != null ? fixed(planets[i].eqt, 0) : muted(DASH))),
    column('hz', 'HZ', (i) => {
      const hz = planets[i].hz
      if (hz === HZ_NONE) return muted('·')
      return (
        <span
          title={hz === HZ_CONSERVATIVE ? 'Muhafazakâr yaşanabilir bölgede' : 'İyimser yaşanabilir bölgede'}
          className={cx('size-2 rounded-full', hz === HZ_CONSERVATIVE ? 'bg-hz shadow-[0_0_6px_var(--color-hz)]' : 'border border-hz/70')}
        />
      )
    }),
    column('year', 'Yıl', (i) => planets[i].year ?? muted(DASH)),
    column('method', 'Yöntem', (i) => {
      const name = atlas.methods[planets[i].method]
      return (
        <span className="truncate" title={methodLabel(name)}>
          {methodShort(name)}
        </span>
      )
    }),
    column('dist', `Uzaklık (${UNIT_LABEL[unit]})`, (i) => {
      const d = atlas.systems[planets[i].system].dist
      return d != null ? sig(toUnit(d, unit), 3) : muted(DASH)
    }),
    column('pnum', 'Sist.', (i) => atlas.systems[planets[i].system].pnum),
  ])
  return {
    columns,
    layout: {
      fav: { width: 30, align: 'center' },
      name: { width: 156, primary: true },
      radius: { width: 54, align: 'right', hint: 'Yarıçap (Dünya = 1)' },
      mass: { width: 60, align: 'right', hint: 'Kütle veya M·sin i (Dünya = 1)' },
      period: { width: 86, align: 'right', hint: 'Yörünge periyodu, gün' },
      a: { width: 72, align: 'right', hint: 'Yarı-büyük eksen, astronomik birim' },
      eqt: { width: 56, align: 'right', hint: 'Denge sıcaklığı, Kelvin' },
      hz: { width: 40, align: 'center', hint: 'Yaşanabilir bölge' },
      year: { width: 50, align: 'right', hint: 'Keşif yılı' },
      method: { width: 100, hint: 'Keşif yöntemi' },
      dist: { width: 92, align: 'right', hint: 'Sistemin Güneş’e uzaklığı' },
      pnum: { width: 46, align: 'right', hint: 'Sistemdeki onaylı gezegen sayısı' },
    },
  }
}
