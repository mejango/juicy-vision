import { describe, it, expect, vi, beforeEach } from 'vitest'

// Track constructor calls
const mockConstructorCalls: Array<{ apiKey: string; dangerouslyAllowBrowser: boolean }> = []

// Mock the Anthropic SDK with a proper class
vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = class {
    apiKey: string
    dangerouslyAllowBrowser: boolean
    messages = {
      create: vi.fn(),
      stream: vi.fn(),
    }

    constructor(config: { apiKey: string; dangerouslyAllowBrowser: boolean }) {
      this.apiKey = config.apiKey
      this.dangerouslyAllowBrowser = config.dangerouslyAllowBrowser
      mockConstructorCalls.push(config)
    }
  }

  return { default: MockAnthropic }
})

describe('getClaudeClient', () => {
  beforeEach(() => {
    mockConstructorCalls.length = 0
    vi.resetModules()
  })

  it('creates a new client with the provided API key', async () => {
    const { getClaudeClient } = await import('./client')

    const client = getClaudeClient('test-api-key-123')

    expect(mockConstructorCalls).toHaveLength(1)
    expect(mockConstructorCalls[0].apiKey).toBe('test-api-key-123')
    expect(client).toBeDefined()
  })

  it('returns the same client instance for the same API key', async () => {
    const { getClaudeClient } = await import('./client')

    const client1 = getClaudeClient('same-key')
    const client2 = getClaudeClient('same-key')

    // Should only create one instance
    expect(mockConstructorCalls).toHaveLength(1)
    expect(client1).toBe(client2)
  })

  it('creates a new client when API key changes', async () => {
    const { getClaudeClient } = await import('./client')

    const client1 = getClaudeClient('first-key')
    const client2 = getClaudeClient('second-key')

    // Should create two instances for different keys
    expect(mockConstructorCalls).toHaveLength(2)
    expect(mockConstructorCalls[0].apiKey).toBe('first-key')
    expect(mockConstructorCalls[1].apiKey).toBe('second-key')
    expect(client1).not.toBe(client2)
  })

  it('sets dangerouslyAllowBrowser to true', async () => {
    const { getClaudeClient } = await import('./client')

    getClaudeClient('any-key')

    expect(mockConstructorCalls[0].dangerouslyAllowBrowser).toBe(true)
  })

  it('returns a client with messages API', async () => {
    const { getClaudeClient } = await import('./client')

    const client = getClaudeClient('api-key') as { messages: { create: unknown; stream: unknown } }

    expect(client.messages).toBeDefined()
    expect(client.messages.create).toBeDefined()
    expect(client.messages.stream).toBeDefined()
  })
})
