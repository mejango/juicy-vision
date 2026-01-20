import { describe, it, expect } from 'vitest'
import { formatConversationHistory, SYSTEM_PROMPT } from './prompts'

describe('formatConversationHistory', () => {
  it('formats simple text messages correctly', () => {
    const messages = [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi there!' },
    ]

    const result = formatConversationHistory(messages)

    expect(result).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ])
  })

  it('preserves message roles correctly', () => {
    const messages = [
      { role: 'user' as const, content: 'Question' },
      { role: 'assistant' as const, content: 'Answer' },
      { role: 'user' as const, content: 'Follow-up' },
    ]

    const result = formatConversationHistory(messages)

    expect(result[0].role).toBe('user')
    expect(result[1].role).toBe('assistant')
    expect(result[2].role).toBe('user')
  })

  it('formats user messages with image attachments as content blocks', () => {
    const messages = [
      {
        role: 'user' as const,
        content: 'What is in this image?',
        attachments: [
          {
            id: '1',
            type: 'image' as const,
            mimeType: 'image/png',
            data: 'base64encodeddata',
            name: 'test.png',
          },
        ],
      },
    ]

    const result = formatConversationHistory(messages)

    expect(result).toHaveLength(1)
    expect(Array.isArray(result[0].content)).toBe(true)

    const content = result[0].content as Array<{ type: string; source?: { type: string; media_type: string; data: string }; text?: string }>
    expect(content).toHaveLength(2)

    // Image block first
    expect(content[0].type).toBe('image')
    expect(content[0].source?.type).toBe('base64')
    expect(content[0].source?.media_type).toBe('image/png')
    expect(content[0].source?.data).toBe('base64encodeddata')

    // Text block second
    expect(content[1].type).toBe('text')
    expect(content[1].text).toBe('What is in this image?')
  })

  it('formats multiple image attachments correctly', () => {
    const messages = [
      {
        role: 'user' as const,
        content: 'Compare these images',
        attachments: [
          {
            id: '1',
            type: 'image' as const,
            mimeType: 'image/jpeg',
            data: 'image1data',
            name: 'first.jpg',
          },
          {
            id: '2',
            type: 'image' as const,
            mimeType: 'image/webp',
            data: 'image2data',
            name: 'second.webp',
          },
        ],
      },
    ]

    const result = formatConversationHistory(messages)
    const content = result[0].content as Array<{ type: string }>

    expect(content).toHaveLength(3) // 2 images + 1 text
    expect(content[0].type).toBe('image')
    expect(content[1].type).toBe('image')
    expect(content[2].type).toBe('text')
  })

  it('handles user message with attachments but no text content', () => {
    const messages = [
      {
        role: 'user' as const,
        content: '',
        attachments: [
          {
            id: '1',
            type: 'image' as const,
            mimeType: 'image/gif',
            data: 'gifdata',
            name: 'animation.gif',
          },
        ],
      },
    ]

    const result = formatConversationHistory(messages)
    const content = result[0].content as Array<{ type: string }>

    // Should only have image block, no text block for empty string
    expect(content).toHaveLength(1)
    expect(content[0].type).toBe('image')
  })

  it('does not format assistant messages with attachments as content blocks', () => {
    // Assistant messages should always be plain text
    const messages = [
      {
        role: 'assistant' as const,
        content: 'Here is my response',
        attachments: [
          {
            id: '1',
            type: 'image' as const,
            mimeType: 'image/png',
            data: 'somedata',
            name: 'test.png',
          },
        ],
      },
    ]

    const result = formatConversationHistory(messages)

    // Assistant messages with attachments should still be plain string content
    expect(result[0].content).toBe('Here is my response')
  })

  it('handles empty messages array', () => {
    const result = formatConversationHistory([])
    expect(result).toEqual([])
  })

  it('handles messages without attachments field', () => {
    const messages = [
      { role: 'user' as const, content: 'No attachments here' },
    ]

    const result = formatConversationHistory(messages)

    expect(result[0].content).toBe('No attachments here')
  })

  it('handles messages with empty attachments array', () => {
    const messages = [
      { role: 'user' as const, content: 'Empty attachments', attachments: [] },
    ]

    const result = formatConversationHistory(messages)

    // Should be plain string, not content blocks
    expect(result[0].content).toBe('Empty attachments')
  })

  it('supports all valid image MIME types', () => {
    const mimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const

    for (const mimeType of mimeTypes) {
      const messages = [
        {
          role: 'user' as const,
          content: 'Test',
          attachments: [
            {
              id: '1',
              type: 'image' as const,
              mimeType,
              data: 'testdata',
              name: 'test.img',
            },
          ],
        },
      ]

      const result = formatConversationHistory(messages)
      const content = result[0].content as Array<{ type: string; source?: { media_type: string } }>

      expect(content[0].source?.media_type).toBe(mimeType)
    }
  })
})

describe('SYSTEM_PROMPT', () => {
  it('is a non-empty string', () => {
    expect(typeof SYSTEM_PROMPT).toBe('string')
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(0)
  })

  it('contains key Juicebox concepts', () => {
    expect(SYSTEM_PROMPT).toContain('project')
    expect(SYSTEM_PROMPT).toContain('token')
    expect(SYSTEM_PROMPT).toContain('cash out')
  })

  it('contains guidance about transactions', () => {
    expect(SYSTEM_PROMPT).toContain('transaction')
  })

  it('contains component references', () => {
    expect(SYSTEM_PROMPT).toContain('juice-component')
    expect(SYSTEM_PROMPT).toContain('project-card')
  })

  it('contains contract addresses', () => {
    // JBController5_1 address
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('0xf3cc99b11bd73a2e3b8815fb85fe0381b29987e1')
    // JBMultiTerminal5_1 address
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('0x52869db3d61dde1e391967f2ce5039ad0ecd371c')
  })

  it('contains chain IDs', () => {
    expect(SYSTEM_PROMPT).toContain('1') // Ethereum
    expect(SYSTEM_PROMPT).toContain('10') // Optimism
    expect(SYSTEM_PROMPT).toContain('8453') // Base
    expect(SYSTEM_PROMPT).toContain('42161') // Arbitrum
  })

  it('mentions the personality traits', () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('coach')
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('concise')
  })
})
