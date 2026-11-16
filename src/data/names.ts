/** Star designations: formatting for display and folding for search. Pure functions only. */

import { CONSTELLATIONS } from './constellations'

/** HYG Bayer token → [Greek letter, spelled-out name, abbreviation used by the NASA archive]. */
const GREEK: Record<string, [string, string, string]> = {
  Alp: ['α', 'alpha', 'alf'],
  Bet: ['β', 'beta', 'bet'],
  Gam: ['γ', 'gamma', 'gam'],
  Del: ['δ', 'delta', 'del'],
  Eps: ['ε', 'epsilon', 'eps'],
  Zet: ['ζ', 'zeta', 'zet'],
  Eta: ['η', 'eta', 'eta'],
  The: ['θ', 'theta', 'tet'],
  Iot: ['ι', 'iota', 'iot'],
  Kap: ['κ', 'kappa', 'kap'],
  Lam: ['λ', 'lambda', 'lam'],
  Mu: ['μ', 'mu', 'mu'],
  Nu: ['ν', 'nu', 'nu'],
  Xi: ['ξ', 'xi', 'ksi'],
  Omi: ['ο', 'omicron', 'omi'],
  Pi: ['π', 'pi', 'pi'],
  Rho: ['ρ', 'rho', 'rho'],
  Sig: ['σ', 'sigma', 'sig'],
  Tau: ['τ', 'tau', 'tau'],
  Ups: ['υ', 'upsilon', 'ups'],
  Phi: ['φ', 'phi', 'phi'],
  Chi: ['χ', 'chi', 'chi'],
  Psi: ['ψ', 'psi', 'psi'],
  Ome: ['ω', 'omega', 'ome'],
}

const SUPERSCRIPT = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹']

function splitBayer(token: string): { letter: string; index: string } {
  const [letter, index = ''] = token.split('-')
  return { letter, index }
}

/** ("Alp-1", "Cen") → "α¹ Cen". */
export function formatBayer(token: string, con: string): string {
  const { letter, index } = splitBayer(token)
  const greek = GREEK[letter]?.[0] ?? letter
  const sup = [...index].map((d) => SUPERSCRIPT[Number(d)] ?? d).join('')
  return `${greek}${sup} ${con}`.trim()
}

/** Every spelling of a Bayer designation someone might type: "alp cen", "alpha centauri", "alf cen" … */
export function bayerSearchForms(token: string, con: string): string {
  const { letter, index } = splitBayer(token)
  const g = GREEK[letter]
  if (!g) return `${token} ${con}`
  const genitive = CONSTELLATIONS[con]?.[1] ?? ''
  const n = index
  return [
    `${g[0]}${n} ${con}`,
    `${letter}${n} ${con}`,
    `${g[1]}${n} ${con}`,
    `${g[2]}${n} ${con}`,
    genitive ? `${g[1]}${n} ${genitive}` : '',
  ].join(' ')
}

/**
 * Case-, diacritic- and Turkish-dotless-i-insensitive form used on both sides of a search.
 * "Güneş" → "gunes", "SIRIUS" → "sirius".
 */
export function fold(text: string): string {
  return text
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
}
