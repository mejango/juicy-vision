import { getClaudeClient } from './client'
import { SYSTEM_PROMPT, formatConversationHistory } from './prompts'

export interface StreamOptions {
  apiKey: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  onToken: (token: string) => void
  onComplete: (fullText: string) => void
  onError: (error: Error) => void
  signal?: AbortSignal
}

export async function streamChatResponse({
  apiKey,
  messages,
  onToken,
  onComplete,
  onError,
  signal,
}: StreamOptions): Promise<void> {
  const client = getClaudeClient(apiKey)
  let fullText = ''

  try {
    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: formatConversationHistory(messages),
    })

    for await (const event of stream) {
      if (signal?.aborted) {
        stream.controller.abort()
        break
      }

      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const token = event.delta.text
        fullText += token
        onToken(token)
      }
    }

    if (!signal?.aborted) {
      onComplete(fullText)
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return
    }
    onError(error instanceof Error ? error : new Error('Unknown error'))
  }
}

