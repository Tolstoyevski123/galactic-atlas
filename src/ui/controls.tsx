import { useEffect, useId, useState, type ReactNode } from 'react'
import type { Range } from '../browser/filterEngine'

const cx = (...parts: Array<string | false | null | undefined>): string => parts.filter(Boolean).join(' ')
export { cx }

interface IconButtonProps {
  label: string
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  /** Where the tooltip appears. */
  tip?: 'top' | 'bottom' | 'left' | 'right' | 'none'
  size?: 'sm' | 'md'
  tone?: 'default' | 'gold'
  className?: string
  children: ReactNode
}

/** Square icon-only button with an accessible name and a styled tooltip. */
export function IconButton({ label, onClick, active, disabled, tip = 'top', size = 'md', tone = 'default', className, children }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      data-tip={tip === 'none' ? undefined : label}
      data-tip-pos={tip}
      className={cx(
        'tip grid shrink-0 place-items-center rounded-lg transition-colors duration-150',
        size === 'md' ? 'size-8' : 'size-7',
        active
          ? tone === 'gold'
            ? 'bg-gold/15 text-gold'
            : 'bg-accent/15 text-accent'
          : 'text-muted hover:bg-white/8 hover:text-ink',
        disabled && 'pointer-events-none opacity-40',
        className,
      )}
    >
      {children}
    </button>
  )
}

interface ChipProps {
  active: boolean
  onClick: () => void
  children: ReactNode
  title?: string
  tone?: 'accent' | 'gold' | 'hz'
}

const CHIP_TONE = {
  accent: 'border-accent/50 bg-accent/15 text-accent',
  gold: 'border-gold/50 bg-gold/15 text-gold',
  hz: 'border-hz/50 bg-hz/15 text-hz',
}

/** Toggleable pill. */
export function Chip({ active, onClick, children, title, tone = 'accent' }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={cx(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium leading-none transition-colors duration-150',
        active ? CHIP_TONE[tone] : 'border-line bg-white/[0.03] text-muted hover:border-line-strong hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

interface SegmentedProps<T extends string | number> {
  value: T
  options: Array<{ value: T; label: string; title?: string }>
  onChange: (value: T) => void
  label: string
  size?: 'sm' | 'md'
}

/** Mutually exclusive choice rendered as one control. */
export function Segmented<T extends string | number>({ value, options, onChange, label, size = 'md' }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-black/25 p-0.5">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={cx(
            'rounded-md font-medium leading-none transition-colors duration-150',
            size === 'md' ? 'h-7 px-2.5 text-[12px]' : 'h-6 px-2 text-[11.5px]',
            option.value === value ? 'bg-white/12 text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]' : 'text-muted hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  children: ReactNode
  tone?: 'accent' | 'gold'
}

export function Switch({ checked, onChange, children, tone = 'accent' }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group flex w-full items-center justify-between gap-3 rounded-lg py-1 text-left text-[12.5px] text-muted transition-colors hover:text-ink"
    >
      <span className={cx(checked && 'text-ink')}>{children}</span>
      <span
        className={cx(
          'relative h-[18px] w-8 shrink-0 rounded-full transition-colors duration-200',
          checked ? (tone === 'gold' ? 'bg-gold/80' : 'bg-accent/80') : 'bg-white/14',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 left-0.5 size-3.5 rounded-full bg-white shadow transition-transform duration-200 ease-out-soft',
            checked && 'translate-x-3.5',
          )}
        />
      </span>
    </button>
  )
}

const parseNumber = (text: string): number | null => {
  const trimmed = text.trim().replace(',', '.')
  if (trimmed === '' || trimmed === '-' || trimmed === '.') return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

const formatNumber = (value: number | null): string => (value === null ? '' : String(Number(value.toPrecision(6))).replace('.', ','))

interface RangeFieldProps {
  label: string
  unit?: string
  value: Range
  onChange: (range: Range) => void
  /** Hints shown as placeholders, e.g. the catalogue's extent. */
  placeholder?: [string, string]
}

/** A min–max pair. Accepts both "1,5" and "1.5"; an empty box means "no limit". */
export function RangeField({ label, unit, value, onChange, placeholder = ['min', 'maks'] }: RangeFieldProps) {
  const id = useId()
  const [text, setText] = useState<[string, string]>([formatNumber(value[0]), formatNumber(value[1])])
  const active = value[0] !== null || value[1] !== null

  // Follow outside changes (presets, "clear") without clobbering what is being typed.
  useEffect(() => {
    setText((current) => [
      parseNumber(current[0]) === value[0] ? current[0] : formatNumber(value[0]),
      parseNumber(current[1]) === value[1] ? current[1] : formatNumber(value[1]),
    ])
  }, [value])

  const edit = (side: 0 | 1, raw: string) => {
    if (!/^-?[\d.,]*$/.test(raw)) return
    const next: [string, string] = side === 0 ? [raw, text[1]] : [text[0], raw]
    setText(next)
    const range: Range = [parseNumber(next[0]), parseNumber(next[1])]
    if (range[0] !== value[0] || range[1] !== value[1]) onChange(range)
  }

  const inputClass =
    'h-7 w-full min-w-0 rounded-md border border-line bg-black/30 px-2 text-[12px] tabular-nums text-ink placeholder:text-faint/70 transition-colors hover:border-line-strong focus:border-accent/60 focus:outline-none'

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label htmlFor={`${id}-min`} className={cx('text-[11.5px] font-medium', active ? 'text-accent' : 'text-muted')}>
          {label}
        </label>
        {unit && <span className="text-[10.5px] text-faint">{unit}</span>}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          id={`${id}-min`}
          inputMode="decimal"
          autoComplete="off"
          aria-label={`${label} en az`}
          placeholder={placeholder[0]}
          value={text[0]}
          onChange={(e) => edit(0, e.target.value)}
          className={inputClass}
        />
        <span className="text-faint">–</span>
        <input
          inputMode="decimal"
          autoComplete="off"
          aria-label={`${label} en çok`}
          placeholder={placeholder[1]}
          value={text[1]}
          onChange={(e) => edit(1, e.target.value)}
          className={inputClass}
        />
      </div>
    </div>
  )
}

/** Label + value pair used in the detail panels. */
export function Stat({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0" title={hint}>
      <dt className="text-[11px] text-faint">{label}</dt>
      <dd className="mt-0.5 truncate font-display text-[14px] font-medium tabular-nums text-ink">{children}</dd>
    </div>
  )
}

export function Badge({ tone, children, title }: { tone: 'gold' | 'hz' | 'accent' | 'muted' | 'danger'; children: ReactNode; title?: string }) {
  const tones = {
    gold: 'border-gold/35 bg-gold/10 text-gold',
    hz: 'border-hz/35 bg-hz/10 text-hz',
    accent: 'border-accent/35 bg-accent/10 text-accent',
    muted: 'border-line bg-white/5 text-muted',
    danger: 'border-danger/35 bg-danger/10 text-danger',
  }
  return (
    <span
      title={title}
      className={cx('inline-flex h-[22px] items-center gap-1 rounded-full border px-2 text-[11px] font-medium leading-none whitespace-nowrap', tones[tone])}
    >
      {children}
    </span>
  )
}
