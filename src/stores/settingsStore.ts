import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const CURRENT_BENDYSTRAW_ENDPOINT = 'https://bendystraw.xyz/3ZNJpGtazh5fwYoSW59GWDEj/graphql'

interface SettingsState {
  claudeApiKey: string
  paraApiKey: string
  pinataApiKey: string
  pinataApiSecret: string
  bendystrawEndpoint: string
  relayrEndpoint: string

  setClaudeApiKey: (key: string) => void
  setParaApiKey: (key: string) => void
  setPinataApiKey: (key: string) => void
  setPinataApiSecret: (secret: string) => void
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
      pinataApiKey: '',
      pinataApiSecret: '',
      bendystrawEndpoint: CURRENT_BENDYSTRAW_ENDPOINT,
      relayrEndpoint: 'https://api.relayr.ba5ed.com',

      setClaudeApiKey: (key) => set({ claudeApiKey: key }),
      setParaApiKey: (key) => set({ paraApiKey: key }),
      setPinataApiKey: (key) => set({ pinataApiKey: key }),
      setPinataApiSecret: (secret) => set({ pinataApiSecret: secret }),
      setBendystrawEndpoint: (endpoint) => set({ bendystrawEndpoint: endpoint }),
      setRelayrEndpoint: (endpoint) => set({ relayrEndpoint: endpoint }),

      clearSettings: () => set({
        claudeApiKey: '',
        paraApiKey: '',
        pinataApiKey: '',
        pinataApiSecret: '',
      }),

      isConfigured: () => {
        const state = get()
        return Boolean(state.claudeApiKey)
      },

      isPinataConfigured: () => {
        const state = get()
        return Boolean(state.pinataApiKey && state.pinataApiSecret)
      },
    }),
    {
      name: 'juice-settings',
      version: 4,
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as SettingsState & { pinataJwt?: string }
        if (version < 2) {
          return {
            ...state,
            bendystrawEndpoint: CURRENT_BENDYSTRAW_ENDPOINT,
          }
        }
        if (version < 4) {
          // Migration: convert pinataJwt to pinataApiKey/Secret
          return {
            ...state,
            pinataApiKey: '',
            pinataApiSecret: '',
          }
        }
        return state
      },
    }
  )
)
