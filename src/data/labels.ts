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

/**
 * Discovery methods as drawn on the discovery timeline: the four that found nearly every planet,
 * and the rest together. The order is the stacking order, and it is part of the palette: these
 * four hues were checked as neighbours (colour-blind separation and contrast on the panel
 * surface) in exactly this sequence. Gold, green and the accent blue are left out on purpose —
 * elsewhere in the app they mean "hosts planets", "habitable zone" and "selected".
 */
export const METHOD_GROUPS: ReadonlyArray<{ key: string; label: string; color: string; title: string; methods: readonly string[] }> = [
  { key: 'transit', label: 'Geçiş', color: '#3987e5', title: 'Gezegen yıldızının önünden geçerken ışığını azaltır', methods: ['Transit'] },
  { key: 'rv', label: 'Dikine hız', color: '#d95926', title: 'Gezegen yıldızını ileri geri çeker; tayf çizgileri kayar', methods: ['Radial Velocity'] },
  { key: 'lensing', label: 'Mikromercekleme', color: '#9085e9', title: 'Gezegenin kütleçekimi arkadaki bir yıldızın ışığını büker', methods: ['Microlensing'] },
  { key: 'imaging', label: 'Görüntüleme', color: '#d55181', title: 'Gezegenin kendi ışığı doğrudan görüntülenir', methods: ['Imaging'] },
  { key: 'other', label: 'Diğer', color: '#687188', title: 'Zamanlama yöntemleri, astrometri ve ötekiler', methods: [] },
]

/** Index into METHOD_GROUPS for an archive method name; anything unlisted lands in the last group. */
export function methodGroup(name: string | undefined): number {
  const index = METHOD_GROUPS.findIndex((group) => name !== undefined && group.methods.includes(name))
  return index >= 0 ? index : METHOD_GROUPS.length - 1
}

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
