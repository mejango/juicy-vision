import { describe, it, expect, beforeEach } from 'vitest'
import { useThemeStore } from './themeStore'

describe('themeStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useThemeStore.setState({ theme: 'dark' })
    localStorage.clear()
  })

  describe('initial state', () => {
    it('defaults to dark theme', () => {
      const { theme } = useThemeStore.getState()
      expect(theme).toBe('dark')
    })
  })

  describe('setTheme', () => {
    it('sets theme to light', () => {
      const store = useThemeStore.getState()
      store.setTheme('light')

      expect(useThemeStore.getState().theme).toBe('light')
    })

    it('sets theme to dark', () => {
      useThemeStore.setState({ theme: 'light' })
      const store = useThemeStore.getState()
      store.setTheme('dark')

      expect(useThemeStore.getState().theme).toBe('dark')
    })
  })

  describe('toggleTheme', () => {
    it('toggles from dark to light', () => {
      const store = useThemeStore.getState()
      expect(store.theme).toBe('dark')

      store.toggleTheme()

      expect(useThemeStore.getState().theme).toBe('light')
    })

    it('toggles from light to dark', () => {
      useThemeStore.setState({ theme: 'light' })
      const store = useThemeStore.getState()

      store.toggleTheme()

      expect(useThemeStore.getState().theme).toBe('dark')
    })

    it('toggles correctly in sequence', () => {
      const store = useThemeStore.getState()

      // Start dark
      expect(store.theme).toBe('dark')

      // Toggle to light
      store.toggleTheme()
      expect(useThemeStore.getState().theme).toBe('light')

      // Toggle back to dark
      useThemeStore.getState().toggleTheme()
      expect(useThemeStore.getState().theme).toBe('dark')

      // Toggle to light again
      useThemeStore.getState().toggleTheme()
      expect(useThemeStore.getState().theme).toBe('light')
    })
  })
})
