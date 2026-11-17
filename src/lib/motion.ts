let reducedMotion: MediaQueryList | null | undefined

/** True when the viewer asked the system for less motion. Cheap enough to ask every frame. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  if (reducedMotion === undefined) reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null
  return reducedMotion?.matches === true
}

/** Coarse pointer and a small screen: treat as a phone/tablet and lighten the scene. */
export function isCompactDevice(): boolean {
  if (typeof window === 'undefined') return false
  const coarse = window.matchMedia?.('(pointer: coarse)').matches === true
  return coarse && Math.min(window.innerWidth, window.innerHeight) < 820
}
