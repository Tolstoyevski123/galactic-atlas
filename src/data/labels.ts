/** Turkish display labels for catalogue vocabulary. */

import type { PlanetClass } from '../lib/astro'
import { SPECT_OTHER, SPECT_UNKNOWN } from './schema'

const METHODS: Record<string, { label: string; short: string }> = {
  Transit: { label: 'Geçiş (transit)', short: 'Geçiş' },
  'Radial Velocity': { label: 'Dikine hız', short: 'Dikine hız' },
  Microlensing: { label: 'Mikromercekleme', short: 'Mikromercek' },
  Imaging: { label: 'Doğrudan görüntüleme', short: 'Görüntüleme' },
  'Transit Timing Variations': { label: 'Geçiş zamanlama değişimi (TTV)', short: 'TTV' },
  'Eclipse Timing Variations': { label: 'Tutulma zamanlama değişimi (ETV)', short: 'ETV' },
  'Orbital Brightness Modulation': { label: 'Yörüngesel parlaklık modülasyonu', short: 'Parlaklık mod.' },
  Astrometry: { label: 'Astrometri', short: 'Astrometri' },
  'Pulsar Timing': { label: 'Pulsar zamanlaması', short: 'Pulsar' },
  'Pulsation Timing Variations': { label: 'Zonklama zamanlama değişimi', short: 'Zonklama' },
  'Disk Kinematics': { label: 'Disk kinematiği', short: 'Disk kin.' },
}

export const methodLabel = (name: string | undefined): string => (name ? (METHODS[name]?.label ?? name) : '—')
export const methodShort = (name: string | undefined): string => (name ? (METHODS[name]?.short ?? name) : '—')

export const PLANET_CLASS_LABEL: Record<PlanetClass, string> = {
  rocky: 'Kayaç gezegen',
  subneptune: 'Alt-Neptün',
  neptunian: 'Neptün benzeri',
  jovian: 'Gaz devi',
  unknown: 'Sınıfı bilinmiyor',
}

/** Chip label and swatch colour for each spectral class code. */
export const SPECTRAL_CHIPS: Array<{ code: number; label: string; color: string; title: string }> = [
  { code: 0, label: 'O', color: '#9bb0ff', title: 'O — ≥ 30.000 K, mavi' },
  { code: 1, label: 'B', color: '#aabfff', title: 'B — 10.000–30.000 K, mavi-beyaz' },
  { code: 2, label: 'A', color: '#cad7ff', title: 'A — 7.500–10.000 K, beyaz' },
  { code: 3, label: 'F', color: '#f8f7ff', title: 'F — 6.000–7.500 K, sarı-beyaz' },
  { code: 4, label: 'G', color: '#fff0d9', title: 'G — 5.200–6.000 K, sarı (Güneş)' },
  { code: 5, label: 'K', color: '#ffd09a', title: 'K — 3.700–5.200 K, turuncu' },
  { code: 6, label: 'M', color: '#ffab73', title: 'M — 2.400–3.700 K, kırmızı cüce' },
  { code: SPECT_OTHER, label: 'Diğer', color: '#b9a8e0', title: 'Beyaz cüceler, L/T cüceleri, Wolf–Rayet, karbon yıldızları' },
  { code: SPECT_UNKNOWN, label: '?', color: '#687188', title: 'Tayf tipi bilinmiyor' },
]

export function spectralColor(code: number): string {
  return SPECTRAL_CHIPS.find((c) => c.code === code)?.color ?? '#687188'
}
