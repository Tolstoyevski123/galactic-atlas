/**
 * localStorage wrappers that never throw: storage can be unavailable (private windows,
 * blocked site data), in which case the app simply runs without persistence.
 */

const PREFIX = 'galactic-atlas:'

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function writeJson(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}
