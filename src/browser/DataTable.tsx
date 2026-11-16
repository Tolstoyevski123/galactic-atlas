import { memo, useEffect, useMemo, useRef, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import {
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type ReactTable,
  type Row,
  type SortingState,
  type Updater,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDownIcon, ArrowUpIcon } from '../ui/icons'
import { cx } from '../ui/controls'
import type { Sort } from './filterEngine'

export const features = tableFeatures({ rowSortingFeature })
export type Features = typeof features

/** A table row is just an index into the catalogue; cells look the values up themselves. */
export interface RowRef {
  row: number
}

export interface ColumnLayout {
  width: number
  align?: 'left' | 'right' | 'center'
  /** Takes the leftover width and stays pinned while scrolling sideways. */
  primary?: boolean
  /** Tooltip explaining the column. */
  hint?: string
}

type Layout = Record<string, ColumnLayout>
type Tone = 'gold' | 'hz' | null

const ROW_HEIGHT = 34
/** Height of the sticky header row (Tailwind h-8). */
const HEADER_HEIGHT = 32

function cellStyle(layout: Layout, id: string): CSSProperties {
  const spec = layout[id]
  return spec?.primary ? { flex: `1 0 ${spec.width}px`, minWidth: spec.width } : { flex: `0 0 ${spec?.width ?? 80}px` }
}

function alignClass(layout: Layout, id: string): string {
  const align = layout[id]?.align
  return align === 'right' ? 'justify-end text-right' : align === 'center' ? 'justify-center text-center' : 'justify-start'
}

interface Handlers {
  onActivate: (row: number) => void
  onOpen?: (row: number) => void
  onHover: (row: number | null) => void
}

interface TableRowProps {
  row: Row<Features, RowRef>
  table: ReactTable<Features, RowRef>
  id: number
  index: number
  start: number
  selected: boolean
  tone: Tone
  layout: Layout
  handlers: RefObject<Handlers>
}

/**
 * One visible row. Memoised on what it actually shows, so scrolling only renders the rows that
 * enter the window — the ~30 already on screen are left untouched. (The table hands out fresh
 * row objects on every scroll step; comparing those would defeat the point.)
 */
const TableRow = memo(
  function TableRow({ row, table, id, index, start, selected, tone, layout, handlers }: TableRowProps) {
    return (
      <div
        role="row"
        aria-rowindex={index + 1}
        aria-selected={selected}
        onClick={() => handlers.current.onActivate(id)}
        onDoubleClick={() => handlers.current.onOpen?.(id)}
        onMouseEnter={() => handlers.current.onHover(id)}
        style={{ height: ROW_HEIGHT, transform: `translateY(${start}px)` }}
        className={cx(
          'group/row absolute top-0 left-0 flex w-full cursor-pointer border-b border-white/[0.035] text-[12.5px] transition-colors duration-100',
          selected ? 'bg-[#12243a] text-white' : 'bg-[#090c15] text-ink/90 hover:bg-[#111626]',
        )}
      >
        {row.getAllCells().map((cell) => {
          const columnId = cell.column.id
          const primary = layout[columnId]?.primary
          return (
            <div
              key={cell.id}
              role="gridcell"
              style={{ ...cellStyle(layout, columnId), background: primary ? 'inherit' : undefined }}
              className={cx(
                'flex min-w-0 items-center px-2 tabular-nums',
                alignClass(layout, columnId),
                primary && 'sticky left-0 z-10',
                primary && selected && 'shadow-[inset_2px_0_0_var(--color-accent)]',
                primary && !selected && tone === 'gold' && 'shadow-[inset_2px_0_0_rgb(246_196_83/0.55)]',
                primary && !selected && tone === 'hz' && 'shadow-[inset_2px_0_0_rgb(74_222_128/0.6)]',
              )}
            >
              <table.FlexRender cell={cell} />
            </div>
          )
        })}
      </div>
    )
  },
  (a, b) => a.id === b.id && a.index === b.index && a.start === b.start && a.selected === b.selected && a.tone === b.tone && a.layout === b.layout,
)

interface DataTableProps<K extends string> {
  /** Matching catalogue rows in display order; null while the first query is running. */
  rows: Int32Array | null
  columns: Array<ColumnDef<Features, RowRef>>
  layout: Layout
  sort: Sort<K>
  onSort: (sort: Sort<K>) => void
  defaultSortKey: K
  selected: number | null
  onActivate: (row: number) => void
  onOpen?: (row: number) => void
  onHover: (row: number | null) => void
  rowTone?: (row: number) => Tone
  label: string
  empty: ReactNode
}

/**
 * Virtualised table. TanStack Table owns the column model, header state and cell rendering;
 * TanStack Virtual decides which ~30 of the (up to 113k) rows exist in the DOM. Sorting and
 * filtering are "manual": they happen in the worker, this component only reports intent.
 */
export function DataTable<K extends string>({
  rows,
  columns,
  layout,
  sort,
  onSort,
  defaultSortKey,
  selected,
  onActivate,
  onOpen,
  onHover,
  rowTone,
  label,
  empty,
}: DataTableProps<K>) {
  const scroller = useRef<HTMLDivElement>(null)
  const count = rows?.length ?? 0

  // Rows call back through a ref, so new callback identities never force them to re-render.
  const handlers = useRef<Handlers>({ onActivate, onOpen, onHover })
  handlers.current = { onActivate, onOpen, onHover }

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  })
  // While the list is being scrolled, rows sliding under a resting cursor must not each count
  // as a hover: every one of them would update the 3D view's highlight and tooltip.
  const scrolling = virtualizer.isScrolling
  handlers.current.onHover = (row) => {
    if (!scrolling) onHover(row)
  }
  const items = virtualizer.getVirtualItems()
  const first = items.length > 0 ? items[0].index : 0
  const last = items.length > 0 ? items[items.length - 1].index : -1

  // Only the visible window is handed to the table.
  const data = useMemo<RowRef[]>(() => {
    const out: RowRef[] = []
    if (rows) for (let i = first; i <= last && i < rows.length; i++) out.push({ row: rows[i] })
    return out
  }, [rows, first, last])

  const sorting = useMemo<SortingState>(
    () => (sort.key === defaultSortKey ? [] : [{ id: sort.key, desc: sort.desc }]),
    [sort, defaultSortKey],
  )
  const onSortingChange = (updater: Updater<SortingState>) => {
    const next = typeof updater === 'function' ? updater(sorting) : updater
    onSort(next.length === 0 ? { key: defaultSortKey, desc: false } : { key: next[0].id as K, desc: next[0].desc })
  }

  const table = useTable({
    features,
    columns,
    data,
    getRowId: (item) => String(item.row),
    state: { sorting },
    onSortingChange,
    manualSorting: true,
    enableMultiSort: false,
    enableSortingRemoval: true,
    sortDescFirst: false, // every column cycles the same way: ascending → descending → default
  })

  // New result set → back to the top.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
  }, [rows])

  // Selection made elsewhere (the 3D map, a link) → bring its row into view. This follows the
  // *selection*, not the result set: after re-sorting or filtering the list stays at the top.
  // Rows already on screen are left alone, so clicking in the list never makes it jump.
  const selectedIndex = useMemo(() => (rows && selected !== null ? rows.indexOf(selected) : -1), [rows, selected])
  const latestIndex = useRef(selectedIndex)
  latestIndex.current = selectedIndex
  const hasRows = rows !== null
  useEffect(() => {
    const element = scroller.current
    const index = latestIndex.current
    if (!element || index < 0) return
    const top = index * ROW_HEIGHT
    const visibleHeight = element.clientHeight - HEADER_HEIGHT
    if (top >= element.scrollTop && top + ROW_HEIGHT <= element.scrollTop + visibleHeight) return
    element.scrollTo({ top: Math.max(0, top - (visibleHeight - ROW_HEIGHT) / 2) })
  }, [selected, hasRows])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!rows || rows.length === 0) return
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : event.key === 'PageDown' ? 10 : event.key === 'PageUp' ? -10 : 0
    if (step !== 0) {
      event.preventDefault()
      const from = selectedIndex >= 0 ? selectedIndex : step > 0 ? -1 : rows.length
      onActivate(rows[Math.max(0, Math.min(rows.length - 1, from + step))])
    } else if (event.key === 'Enter' && selected !== null && onOpen) {
      event.preventDefault()
      onOpen(selected)
    }
  }

  const totalWidth = table.getAllColumns().reduce((sum, column) => sum + (layout[column.id]?.width ?? 80), 0)

  return (
    <div
      ref={scroller}
      role="grid"
      aria-label={label}
      aria-rowcount={count}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseLeave={() => onHover(null)}
      className="relative h-full overflow-auto overscroll-contain rounded-b-[17px] bg-[#090c15] [contain:content] focus-visible:outline-none"
    >
      <div style={{ minWidth: totalWidth }}>
        <div role="row" className="sticky top-0 z-20 flex h-8 border-b border-line bg-[#0d111c]">
          {table.getHeaderGroups()[0]?.headers.map((header) => {
            const id = header.column.id
            const direction = header.column.getIsSorted()
            const sortable = header.column.getCanSort()
            return (
              <div
                key={header.id}
                role="columnheader"
                aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}
                style={cellStyle(layout, id)}
                className={cx('flex items-stretch bg-[#0d111c]', layout[id]?.primary && 'sticky left-0 z-10')}
              >
                {sortable ? (
                  <button
                    type="button"
                    title={layout[id]?.hint}
                    onClick={header.column.getToggleSortingHandler()}
                    className={cx(
                      'flex w-full items-center gap-1 px-2 text-[11px] font-semibold tracking-wide whitespace-nowrap transition-colors',
                      alignClass(layout, id),
                      direction ? 'text-accent' : 'text-faint hover:text-ink',
                    )}
                  >
                    <table.FlexRender header={header} />
                    {direction === 'asc' && <ArrowUpIcon size={11} />}
                    {direction === 'desc' && <ArrowDownIcon size={11} />}
                  </button>
                ) : (
                  <div className={cx('flex w-full items-center px-2 text-[11px] font-semibold text-faint', alignClass(layout, id))} title={layout[id]?.hint}>
                    <table.FlexRender header={header} />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {rows !== null && count === 0 ? (
          <div className="sticky left-0 w-full max-w-[min(100%,460px)]">{empty}</div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {table.getRowModel().rows.map((row, offset) => {
              const item = items[offset]
              if (!item) return null
              const id = row.original.row
              return (
                <TableRow
                  key={row.id}
                  row={row}
                  table={table}
                  id={id}
                  index={item.index}
                  start={item.start}
                  selected={id === selected}
                  tone={rowTone?.(id) ?? null}
                  layout={layout}
                  handlers={handlers}
                />
              )
            })}
          </div>
        )}
      </div>

      {rows === null && (
        <div className="absolute inset-x-0 top-8 space-y-px">
          {Array.from({ length: 14 }, (_, i) => (
            <div key={i} className="flex h-[34px] items-center gap-3 px-3" style={{ opacity: 1 - i * 0.065 }}>
              <div className="h-2.5 w-2/5 animate-pulse rounded bg-white/8" />
              <div className="h-2.5 w-1/6 animate-pulse rounded bg-white/6" />
              <div className="h-2.5 w-1/6 animate-pulse rounded bg-white/6" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
