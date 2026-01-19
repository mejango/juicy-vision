import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const CURRENT_BENDYSTRAW_ENDPOINT = 'https://bendystraw.xyz/3ZNJpGtazh5fwYoSW59GWDEj/graphql'
export const DEFAULT_THEGRAPH_API_KEY = '02c70b717f22ba9a341a29655139ebd9'

interface SettingsState {
  claudeApiKey: string
  paraApiKey: string
  pinataJwt: string
  ankrApiKey: string
  theGraphApiKey: string
  bendystrawEndpoint: string
  relayrEndpoint: string

  setClaudeApiKey: (key: string) => void
  setParaApiKey: (key: string) => void
  setPinataJwt: (jwt: string) => void
  setAnkrApiKey: (key: string) => void
  setTheGraphApiKey: (key: string) => void
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
      theGraphApiKey: DEFAULT_THEGRAPH_API_KEY,
      bendystrawEndpoint: CURRENT_BENDYSTRAW_ENDPOINT,
      relayrEndpoint: 'https://api.relayr.ba5ed.com',

      setClaudeApiKey: (key) => set({ claudeApiKey: key }),
      setParaApiKey: (key) => set({ paraApiKey: key }),
      setPinataJwt: (jwt) => set({ pinataJwt: jwt }),
      setAnkrApiKey: (key) => set({ ankrApiKey: key }),
      setTheGraphApiKey: (key) => set({ theGraphApiKey: key }),
      setBendystrawEndpoint: (endpoint) => set({ bendystrawEndpoint: endpoint }),
      setRelayrEndpoint: (endpoint) => set({ relayrEndpoint: endpoint }),

      clearSettings: () => set({
        claudeApiKey: '',
        paraApiKey: '',
        pinataJwt: '',
        ankrApiKey: '',
        theGraphApiKey: '',
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
      version: 6,
      migrate: (persistedState: unknown, version: number) => {
        let state = persistedState as SettingsState & { pinataApiKey?: string; pinataApiSecret?: string }

        // Apply migrations cumulatively
        if (version < 2) {
          state = {
            ...state,
            bendystrawEndpoint: CURRENT_BENDYSTRAW_ENDPOINT,
          }
        }
        if (version < 5) {
          // Migration: remove old pinataApiKey/Secret, use pinataJwt
          state = {
            ...state,
            pinataJwt: '',
            ankrApiKey: '',
          }
        }
        if (version < 6) {
          // Migration: add theGraphApiKey with default
          state = {
            ...state,
            theGraphApiKey: DEFAULT_THEGRAPH_API_KEY,
          }
        }
        return state
      },
    }
  )
)
