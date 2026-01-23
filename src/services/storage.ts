/**
 * Typed localStorage wrapper
 *
 * Provides type-safe access to localStorage with JSON serialization
 * and error handling.
 */

import { STORAGE_KEYS, type StorageKey } from '../constants'

/**
 * Check if localStorage is available
 */
function isAvailable(): boolean {
  try {
    const test = '__storage_test__'
    localStorage.setItem(test, test)
    localStorage.removeItem(test)
    return true
  } catch {
    return false
  }
}

const storageAvailable = isAvailable()

/**
 * Get a raw string value from localStorage
 */
export function getString(key: StorageKey): string | null {
  if (!storageAvailable) return null
  return localStorage.getItem(key)
}

/**
 * Set a raw string value in localStorage
 */
export function setString(key: StorageKey, value: string): void {
  if (!storageAvailable) return
  localStorage.setItem(key, value)
}

/**
 * Get a JSON-parsed value from localStorage
 * Returns null if key doesn't exist or parsing fails
 */
export function getJSON<T>(key: StorageKey): T | null {
  const raw = getString(key)
  if (!raw) return null

  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/**
 * Set a JSON-serialized value in localStorage
 */
export function setJSON<T>(key: StorageKey, value: T): void {
  if (!storageAvailable) return
  localStorage.setItem(key, JSON.stringify(value))
}

/**
 * Remove a value from localStorage
 */
export function remove(key: StorageKey): void {
  if (!storageAvailable) return
  localStorage.removeItem(key)
}

/**
 * Check if a key exists in localStorage
 */
export function has(key: StorageKey): boolean {
  return getString(key) !== null
}

/**
 * Clear all app-specific storage keys
 * Does NOT clear other apps' data
 */
export function clearAll(): void {
  if (!storageAvailable) return
  Object.values(STORAGE_KEYS).forEach((key) => {
    localStorage.removeItem(key)
  })
}

// Re-export STORAGE_KEYS for convenience
export { STORAGE_KEYS }

/**
 * Storage service singleton with all methods
 */
export const storage = {
  getString,
  setString,
  getJSON,
  setJSON,
  remove,
  has,
  clearAll,
  isAvailable: () => storageAvailable,
  KEYS: STORAGE_KEYS,
} as const
