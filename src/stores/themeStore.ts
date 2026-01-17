import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'dark' | 'light'

interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'dark',

      setTheme: (theme) => set({ theme }),

      toggleTheme: () => {
        const current = get().theme
        set({ theme: current === 'dark' ? 'light' : 'dark' })
      },
    }),
    {
      name: 'juice-theme',
    }
  )
)
