// Re-export system prompt from shared location (single source of truth)
export { SYSTEM_PROMPT } from '../../../shared/prompts'

import type { Attachment } from '../../stores/chatStore'

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

interface ImageBlock {
  type: 'image'
  source: {
    type: 'base64'
    media_type: ImageMediaType
    data: string
  }
}

interface TextBlock {
  type: 'text'
  text: string
}

type ContentBlock = ImageBlock | TextBlock

export const formatConversationHistory = (
  messages: { role: 'user' | 'assistant'; content: string; attachments?: Attachment[] }[]
) => {
  return messages.map((msg) => {
    // If message has attachments, format as array of content blocks
    if (msg.attachments && msg.attachments.length > 0 && msg.role === 'user') {
      const content: ContentBlock[] = []

      // Add image blocks first
      for (const attachment of msg.attachments) {
        if (attachment.type === 'image') {
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: attachment.mimeType as ImageMediaType,
              data: attachment.data,
            },
          })
        }
      }

      // Add text block if there's text content
      if (msg.content) {
        content.push({
          type: 'text',
          text: msg.content,
        })
      }

      return {
        role: msg.role as 'user' | 'assistant',
        content,
      }
    }

    // Regular message without attachments
    return {
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    }
  })
}
