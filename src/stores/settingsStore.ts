import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const CURRENT_BENDYSTRAW_ENDPOINT = 'https://bendystraw.xyz/3ZNJpGtazh5fwYoSW59GWDEj/graphql'

interface SettingsState {
  claudeApiKey: string
  paraApiKey: string
  pinataJwt: string
  ankrApiKey: string
  bendystrawEndpoint: string
  relayrEndpoint: string

  setClaudeApiKey: (key: string) => void
  setParaApiKey: (key: string) => void
  setPinataJwt: (jwt: string) => void
  setAnkrApiKey: (key: string) => void
  setBendystrawEndpoint: (endpoint: string) => void
  setRelayrEndpoint: (endpoint: string) => void
  clearSettings: () => void
  isConfigured: () => boolean
  isPinataConfigured: () => boolean
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      claudeApiKey: '',
      paraApiKey: '',
      pinataJwt: '',
      ankrApiKey: '',
      bendystrawEndpoint: CURRENT_BENDYSTRAW_ENDPOINT,
      relayrEndpoint: 'https://api.relayr.ba5ed.com',

      setClaudeApiKey: (key) => set({ claudeApiKey: key }),
      setParaApiKey: (key) => set({ paraApiKey: key }),
      setPinataJwt: (jwt) => set({ pinataJwt: jwt }),
      setAnkrApiKey: (key) => set({ ankrApiKey: key }),
      setBendystrawEndpoint: (endpoint) => set({ bendystrawEndpoint: endpoint }),
      setRelayrEndpoint: (endpoint) => set({ relayrEndpoint: endpoint }),

      clearSettings: () => set({
        claudeApiKey: '',
        paraApiKey: '',
        pinataJwt: '',
        ankrApiKey: '',
      }),

      isConfigured: () => {
        const state = get()
        return Boolean(state.claudeApiKey)
      },

      isPinataConfigured: () => {
        const state = get()
        return Boolean(state.pinataJwt)
      },
    }),
    {
      name: 'juice-settings',
      version: 5,
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as SettingsState & { pinataApiKey?: string; pinataApiSecret?: string }
        if (version < 2) {
          return {
            ...state,
            bendystrawEndpoint: CURRENT_BENDYSTRAW_ENDPOINT,
          }
        }
        if (version < 5) {
          // Migration: remove old pinataApiKey/Secret, use pinataJwt
          return {
            ...state,
            pinataJwt: '',
            ankrApiKey: '',
          }
        }
        return state
      },
    }
  )
)
