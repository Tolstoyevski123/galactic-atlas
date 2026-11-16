/** Number and unit formatting for the Turkish UI. */

import { PC_TO_LY } from './astro'

export type Unit = 'ly' | 'pc'

export const UNIT_LABEL: Record<Unit, string> = { ly: 'ıy', pc: 'pc' }
export const UNIT_NAME: Record<Unit, string> = { ly: 'ışık yılı', pc: 'parsek' }

const formatters = new Map<string, Intl.NumberFormat>()
function formatter(min: number, max: number): Intl.NumberFormat {
  const key = `${min}:${max}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: min, maximumFractionDigits: max })
    formatters.set(key, f)
  }
  return f
}

export const DASH = '—'

/** Fixed number of decimals, Turkish separators; "—" for missing values. */
export function fixed(value: number | null | undefined, decimals = 0): string {
  if (value == null || !Number.isFinite(value)) return DASH
  return formatter(decimals, decimals).format(value)
}

/**
 * About `digits` significant figures without scientific notation or trailing zeros:
 * 0.01154 → "0,0115", 12.43 → "12,4", 1234.5 → "1.235".
 */
export function sig(value: number | null | undefined, digits = 3): string {
  if (value == null || !Number.isFinite(value)) return DASH
  if (value === 0) return '0'
  const magnitude = Math.floor(Math.log10(Math.abs(value)))
  const decimals = Math.max(0, Math.min(6, digits - 1 - magnitude))
  return formatter(0, decimals).format(value)
}

export const toUnit = (parsec: number, unit: Unit): number => (unit === 'ly' ? parsec * PC_TO_LY : parsec)
export const fromUnit = (value: number, unit: Unit): number => (unit === 'ly' ? value / PC_TO_LY : value)

/** "8,6 ıy" / "2,64 pc". */
export function formatDistance(parsec: number | null | undefined, unit: Unit, digits = 3): string {
  if (parsec == null || !Number.isFinite(parsec)) return DASH
  return `${sig(toUnit(parsec, unit), digits)} ${UNIT_LABEL[unit]}`
}

/** Days → a human-scale period: "4,23 gün", "1,05 yıl", "165 yıl". */
export function formatPeriod(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days)) return DASH
  if (days < 1) return `${sig(days * 24, 3)} saat`
  if (days < 800) return `${sig(days, 3)} gün`
  return `${sig(days / 365.25, 3)} yıl`
}

/** Right ascension in hours → "06s 45d 09sn". */
export function formatRa(hours: number): string {
  const total = Math.round(hours * 3600)
  const h = Math.floor(total / 3600) % 24
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${pad(h)}s ${pad(m)}d ${pad(s)}sn`
}

/** Declination in degrees → "−16° 42′ 58″". */
export function formatDec(degrees: number): string {
  const sign = degrees < 0 ? '−' : '+'
  const total = Math.round(Math.abs(degrees) * 3600)
  const d = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${sign}${pad(d)}° ${pad(m)}′ ${pad(s)}″`
}

/** Whole numbers with thousands separators: 113330 → "113.330". */
export const count = (value: number): string => formatter(0, 0).format(value)
