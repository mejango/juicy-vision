import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useSettingsStore, LANGUAGES, type Language } from './settingsStore'

// Mock i18n
vi.mock('../i18n', () => ({
  changeLanguage: vi.fn(),
}))

describe('settingsStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useSettingsStore.setState({
      claudeApiKey: '',
      paraApiKey: '',
      pinataJwt: '',
      ankrApiKey: '',
      theGraphApiKey: '',
      bendystrawEndpoint: 'https://api.bendystraw.xyz/graphql',
      relayrEndpoint: 'https://api.relayr.ba5ed.com',
      language: 'en',
      selectedFruit: null,
    })
    localStorage.clear()
    vi.clearAllMocks()
  })

  describe('LANGUAGES constant', () => {
    it('defines all supported languages', () => {
      expect(LANGUAGES).toHaveLength(4)
      expect(LANGUAGES.map(l => l.code)).toEqual(['en', 'zh', 'pt', 'es'])
    })

    it('includes native names for each language', () => {
      expect(LANGUAGES.find(l => l.code === 'zh')?.native).toBe('中文')
      expect(LANGUAGES.find(l => l.code === 'pt')?.native).toBe('Português')
      expect(LANGUAGES.find(l => l.code === 'es')?.native).toBe('Español')
    })
  })

  describe('initial state', () => {
    it('has empty API keys by default', () => {
      const state = useSettingsStore.getState()
      expect(state.claudeApiKey).toBe('')
      expect(state.paraApiKey).toBe('')
      expect(state.pinataJwt).toBe('')
      expect(state.ankrApiKey).toBe('')
    })

    it('has default bendystraw endpoint', () => {
      const state = useSettingsStore.getState()
      expect(state.bendystrawEndpoint).toBe('https://api.bendystraw.xyz/graphql')
    })

    it('has default relayr endpoint', () => {
      const state = useSettingsStore.getState()
      expect(state.relayrEndpoint).toBe('https://api.relayr.ba5ed.com')
    })

    it('has English as default language', () => {
      const state = useSettingsStore.getState()
      expect(state.language).toBe('en')
    })

    it('has no selected fruit by default', () => {
      const state = useSettingsStore.getState()
      expect(state.selectedFruit).toBeNull()
    })
  })

  describe('setClaudeApiKey', () => {
    it('sets the Claude API key', () => {
      const store = useSettingsStore.getState()
      store.setClaudeApiKey('sk-ant-api03-test-key')

      expect(useSettingsStore.getState().claudeApiKey).toBe('sk-ant-api03-test-key')
    })

    it('allows clearing the key', () => {
      useSettingsStore.setState({ claudeApiKey: 'existing-key' })
      const store = useSettingsStore.getState()
      store.setClaudeApiKey('')

      expect(useSettingsStore.getState().claudeApiKey).toBe('')
    })
  })

  describe('setParaApiKey', () => {
    it('sets the Para API key', () => {
      const store = useSettingsStore.getState()
      store.setParaApiKey('para-api-key-123')

      expect(useSettingsStore.getState().paraApiKey).toBe('para-api-key-123')
    })
  })

  describe('setPinataJwt', () => {
    it('sets the Pinata JWT', () => {
      const store = useSettingsStore.getState()
      store.setPinataJwt('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...')

      expect(useSettingsStore.getState().pinataJwt).toBe('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...')
    })
  })

  describe('setAnkrApiKey', () => {
    it('sets the Ankr API key', () => {
      const store = useSettingsStore.getState()
      store.setAnkrApiKey('ankr-api-key')

      expect(useSettingsStore.getState().ankrApiKey).toBe('ankr-api-key')
    })
  })

  describe('setTheGraphApiKey', () => {
    it('sets The Graph API key', () => {
      const store = useSettingsStore.getState()
      store.setTheGraphApiKey('graph-api-key')

      expect(useSettingsStore.getState().theGraphApiKey).toBe('graph-api-key')
    })
  })

  describe('setBendystrawEndpoint', () => {
    it('sets custom bendystraw endpoint', () => {
      const store = useSettingsStore.getState()
      store.setBendystrawEndpoint('https://custom.endpoint/graphql')

      expect(useSettingsStore.getState().bendystrawEndpoint).toBe('https://custom.endpoint/graphql')
    })
  })

  describe('setRelayrEndpoint', () => {
    it('sets custom relayr endpoint', () => {
      const store = useSettingsStore.getState()
      store.setRelayrEndpoint('https://custom.relayr.com')

      expect(useSettingsStore.getState().relayrEndpoint).toBe('https://custom.relayr.com')
    })
  })

  describe('setLanguage', () => {
    it('sets language for all supported languages', () => {
      const languages: Language[] = ['en', 'zh', 'pt', 'es']

      for (const lang of languages) {
        const store = useSettingsStore.getState()
        store.setLanguage(lang)
        expect(useSettingsStore.getState().language).toBe(lang)
      }
    })

    it('calls changeLanguage from i18n', async () => {
      const { changeLanguage } = await import('../i18n')
      const store = useSettingsStore.getState()
      store.setLanguage('zh')

      expect(changeLanguage).toHaveBeenCalledWith('zh')
    })
  })

  describe('setSelectedFruit', () => {
    it('sets selected fruit', () => {
      const store = useSettingsStore.getState()
      store.setSelectedFruit('🍊')

      expect(useSettingsStore.getState().selectedFruit).toBe('🍊')
    })

    it('allows clearing fruit selection with null', () => {
      useSettingsStore.setState({ selectedFruit: '🍋' })
      const store = useSettingsStore.getState()
      store.setSelectedFruit(null)

      expect(useSettingsStore.getState().selectedFruit).toBeNull()
    })
  })

  describe('clearSettings', () => {
    it('clears all API keys', () => {
      useSettingsStore.setState({
        claudeApiKey: 'claude-key',
        paraApiKey: 'para-key',
        pinataJwt: 'pinata-jwt',
        ankrApiKey: 'ankr-key',
        theGraphApiKey: 'graph-key',
      })

      const store = useSettingsStore.getState()
      store.clearSettings()

      const state = useSettingsStore.getState()
      expect(state.claudeApiKey).toBe('')
      expect(state.paraApiKey).toBe('')
      expect(state.pinataJwt).toBe('')
      expect(state.ankrApiKey).toBe('')
      expect(state.theGraphApiKey).toBe('')
    })

    it('does not clear endpoints or language', () => {
      useSettingsStore.setState({
        bendystrawEndpoint: 'https://custom.endpoint',
        relayrEndpoint: 'https://custom.relayr',
        language: 'zh',
        selectedFruit: '🍇',
      })

      const store = useSettingsStore.getState()
      store.clearSettings()

      const state = useSettingsStore.getState()
      // These should remain unchanged
      expect(state.bendystrawEndpoint).toBe('https://custom.endpoint')
      expect(state.relayrEndpoint).toBe('https://custom.relayr')
      expect(state.language).toBe('zh')
      expect(state.selectedFruit).toBe('🍇')
    })
  })

  describe('isConfigured', () => {
    it('returns false when Claude API key is empty', () => {
      useSettingsStore.setState({ claudeApiKey: '' })
      const store = useSettingsStore.getState()

      expect(store.isConfigured()).toBe(false)
    })

    it('returns true when Claude API key is set', () => {
      useSettingsStore.setState({ claudeApiKey: 'sk-ant-api03-test' })
      const store = useSettingsStore.getState()

      expect(store.isConfigured()).toBe(true)
    })
  })

  describe('isPinataConfigured', () => {
    it('returns false when Pinata JWT is empty', () => {
      useSettingsStore.setState({ pinataJwt: '' })
      const store = useSettingsStore.getState()

      expect(store.isPinataConfigured()).toBe(false)
    })

    it('returns true when Pinata JWT is set', () => {
      useSettingsStore.setState({ pinataJwt: 'eyJ...' })
      const store = useSettingsStore.getState()

      expect(store.isPinataConfigured()).toBe(true)
    })
  })
})
