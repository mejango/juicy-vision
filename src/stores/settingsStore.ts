import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { changeLanguage } from '../i18n'
import {
  DEFAULT_BENDYSTRAW_ENDPOINT as ENV_BENDYSTRAW_ENDPOINT,
  DEFAULT_RELAYR_ENDPOINT as ENV_RELAYR_ENDPOINT,
} from '../config/environment'

// Environment-aware endpoints - uses testnet endpoints when IS_TESTNET is true
const DEFAULT_BENDYSTRAW_ENDPOINT = ENV_BENDYSTRAW_ENDPOINT
const DEFAULT_RELAYR_ENDPOINT = ENV_RELAYR_ENDPOINT

// No default API key - users must provide their own in settings
export const DEFAULT_THEGRAPH_API_KEY = ''

export type Language = 'en' | 'zh' | 'pt' | 'es'

export const LANGUAGES: { code: Language; label: string; native: string }[] = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'zh', label: 'Chinese', native: '中文' },
  { code: 'pt', label: 'Portuguese', native: 'Português' },
  { code: 'es', label: 'Spanish', native: 'Español' },
]

interface SettingsState {
  claudeApiKey: string
  paraApiKey: string
  pinataJwt: string
  ankrApiKey: string
  theGraphApiKey: string
  relayrApiKey: string
  bendystrawEndpoint: string
  relayrEndpoint: string
  language: Language
  selectedFruit: string | null // null = use address-based default
  privateMode: boolean // true = chats are private, backend won't store for study

  setClaudeApiKey: (key: string) => void
  setParaApiKey: (key: string) => void
  setPinataJwt: (jwt: string) => void
  setAnkrApiKey: (key: string) => void
  setTheGraphApiKey: (key: string) => void
  setRelayrApiKey: (key: string) => void
  setBendystrawEndpoint: (endpoint: string) => void
  setRelayrEndpoint: (endpoint: string) => void
  setLanguage: (lang: Language) => void
  setSelectedFruit: (fruit: string | null) => void
  setPrivateMode: (isPrivate: boolean) => void
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
      relayrApiKey: '',
      bendystrawEndpoint: DEFAULT_BENDYSTRAW_ENDPOINT,
      relayrEndpoint: DEFAULT_RELAYR_ENDPOINT,
      language: 'en',
      selectedFruit: null,
      privateMode: false, // default to open (not private) - allows backend to study chats

      setClaudeApiKey: (key) => set({ claudeApiKey: key }),
      setParaApiKey: (key) => set({ paraApiKey: key }),
      setPinataJwt: (jwt) => set({ pinataJwt: jwt }),
      setAnkrApiKey: (key) => set({ ankrApiKey: key }),
      setTheGraphApiKey: (key) => set({ theGraphApiKey: key }),
      setRelayrApiKey: (key) => set({ relayrApiKey: key }),
      setBendystrawEndpoint: (endpoint) => set({ bendystrawEndpoint: endpoint }),
      setRelayrEndpoint: (endpoint) => set({ relayrEndpoint: endpoint }),
      setLanguage: (lang) => {
        changeLanguage(lang)
        set({ language: lang })
      },
      setSelectedFruit: (fruit) => set({ selectedFruit: fruit }),
      setPrivateMode: (isPrivate) => set({ privateMode: isPrivate }),

      clearSettings: () => set({
        claudeApiKey: '',
        paraApiKey: '',
        pinataJwt: '',
        ankrApiKey: '',
        theGraphApiKey: '',
        relayrApiKey: '',
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
      version: 10,
      onRehydrateStorage: () => (state) => {
        // Sync i18n with persisted language on app start
        if (state?.language) {
          changeLanguage(state.language)
        }
      },
      migrate: (persistedState: unknown, version: number) => {
        let state = persistedState as SettingsState & { pinataApiKey?: string; pinataApiSecret?: string }

        // Apply migrations cumulatively
        if (version < 2) {
          state = {
            ...state,
            bendystrawEndpoint: DEFAULT_BENDYSTRAW_ENDPOINT,
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
        if (version < 7) {
          // Migration: add language preference
          state = {
            ...state,
            language: 'en',
          }
        }
        if (version < 8) {
          // Migration: add selectedFruit preference
          state = {
            ...state,
            selectedFruit: null,
          }
        }
        if (version < 9) {
          // Migration: add privateMode preference (default false = open/shareable)
          state = {
            ...state,
            privateMode: false,
          }
        }
        if (version < 10) {
          // Migration: add relayrApiKey
          state = {
            ...state,
            relayrApiKey: '',
          }
        }
        return state
      },
    }
  )
)
