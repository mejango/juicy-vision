import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const CURRENT_BENDYSTRAW_ENDPOINT = 'https://bendystraw.xyz/3ZNJpGtazh5fwYoSW59GWDEj/graphql'

interface SettingsState {
  claudeApiKey: string
  paraApiKey: string
  bendystrawEndpoint: string
  relayrEndpoint: string

  setClaudeApiKey: (key: string) => void
  setParaApiKey: (key: string) => void
  setBendystrawEndpoint: (endpoint: string) => void
  setRelayrEndpoint: (endpoint: string) => void
  clearSettings: () => void
  isConfigured: () => boolean
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      claudeApiKey: '',
      paraApiKey: '',
      bendystrawEndpoint: CURRENT_BENDYSTRAW_ENDPOINT,
      relayrEndpoint: 'https://api.relayr.ba5ed.com',

      setClaudeApiKey: (key) => set({ claudeApiKey: key }),
      setParaApiKey: (key) => set({ paraApiKey: key }),
      setBendystrawEndpoint: (endpoint) => set({ bendystrawEndpoint: endpoint }),
      setRelayrEndpoint: (endpoint) => set({ relayrEndpoint: endpoint }),

      clearSettings: () => set({
        claudeApiKey: '',
        paraApiKey: '',
      }),

      isConfigured: () => {
        const state = get()
        return Boolean(state.claudeApiKey)
      },
    }),
    {
      name: 'juice-settings',
      version: 2,
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as SettingsState
        if (version < 2) {
          // Migration: fix old bendystraw endpoint
          return {
            ...state,
            bendystrawEndpoint: CURRENT_BENDYSTRAW_ENDPOINT,
          }
        }
        return state
      },
    }
  )
)
