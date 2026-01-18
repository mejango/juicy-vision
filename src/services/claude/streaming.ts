import type Anthropic from '@anthropic-ai/sdk'
import { getClaudeClient } from './client'
import { SYSTEM_PROMPT, formatConversationHistory } from './prompts'
import { MCP_TOOLS, isMcpTool, executeMcpTool } from '../mcp'
import type { Attachment } from '../../stores/chatStore'

export async function generateConversationTitle(
  apiKey: string,
  userMessage: string,
  assistantResponse: string
): Promise<string> {
  const client = getClaudeClient(apiKey)

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 50,
      messages: [
        {
          role: 'user',
          content: `Generate a very short (2-5 words) title for this conversation. Just respond with the title, nothing else.

User asked: "${userMessage.slice(0, 200)}"
Assistant replied about: "${assistantResponse.slice(0, 300)}"`
        }
      ]
    })

    const titleBlock = response.content[0]
    if (titleBlock.type === 'text') {
      return titleBlock.text.trim().replace(/^["']|["']$/g, '')
    }
    return userMessage.slice(0, 30)
  } catch {
    return userMessage.slice(0, 30)
  }
}

export interface RefinementChip {
  text: string
  isFinal?: boolean // If true, clicking starts the conversation
}

export async function generateRefinementChips(
  apiKey: string,
  selectionPath: string[]
): Promise<RefinementChip[]> {
  const client = getClaudeClient(apiKey)

  const pathDescription = selectionPath.length === 1
    ? `The user clicked: "${selectionPath[0]}"`
    : `The user's selection path: ${selectionPath.map(s => `"${s}"`).join(' → ')}`

  try {
    const response = await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: `You help users refine their intent before starting a conversation with a Juicebox fundraising assistant.

${pathDescription}

Generate 4-6 short follow-up options (3-8 words each) that help narrow down what they want. Make them specific and actionable. Include 1-2 options marked as [FINAL] that are specific enough to start a conversation.

Format: One option per line. Mark final options with [FINAL] at the end.
Example:
For a solo dev project [FINAL]
For a team or organization
With token rewards for backers [FINAL]
Just exploring options

Be concise. No explanations.`
        }
      ]
    })

    const textBlock = response.content[0]
    if (textBlock.type !== 'text') return []

    const lines = textBlock.text.trim().split('\n').filter(line => line.trim())
    return lines.map(line => {
      const isFinal = line.includes('[FINAL]')
      const text = line.replace('[FINAL]', '').trim()
      return { text, isFinal }
    })
  } catch {
    return []
  }
}

export interface StreamOptions {
  apiKey: string
  messages: { role: 'user' | 'assistant'; content: string; attachments?: Attachment[] }[]
  onToken: (token: string) => void
  onComplete: (fullText: string) => void
  onError: (error: Error) => void
  onToolUse?: (toolName: string, status: 'calling' | 'complete') => void
  signal?: AbortSignal
}

type MessageParam = Anthropic.MessageParam
type ContentBlockParam = Anthropic.ContentBlockParam

export async function streamChatResponse({
  apiKey,
  messages,
  onToken,
  onComplete,
  onError,
  onToolUse,
  signal,
}: StreamOptions): Promise<void> {
  const client = getClaudeClient(apiKey)
  let fullText = ''
  let needsSpaceBefore = false // Track if we need space after tool call continuation

  // Convert messages to Anthropic format with proper typing
  const anthropicMessages: MessageParam[] = formatConversationHistory(messages)

  try {
    // Agentic loop to handle tool calls
    let continueLoop = true

    while (continueLoop) {
      if (signal?.aborted) break

      const stream = await client.messages.stream({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: anthropicMessages,
        tools: MCP_TOOLS,
      })

      let isFirstTokenOfStream = true

      for await (const event of stream) {
        if (signal?.aborted) {
          stream.controller.abort()
          break
        }

        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            let token = event.delta.text

            // Add space if continuing after tool call and spacing is needed
            if (isFirstTokenOfStream && needsSpaceBefore && fullText.length > 0) {
              const lastChar = fullText[fullText.length - 1]
              const firstChar = token[0]
              // Add space if last char isn't whitespace and first char isn't whitespace
              if (lastChar && !/\s/.test(lastChar) && firstChar && !/\s/.test(firstChar)) {
                token = ' ' + token
              }
              needsSpaceBefore = false
            }
            isFirstTokenOfStream = false

            fullText += token
            onToken(token)
          } else if (event.delta.type === 'input_json_delta') {
            // Tool input is being streamed - we'll handle it at the end
          }
        } else if (event.type === 'content_block_start') {
          if (event.content_block.type === 'tool_use') {
            onToolUse?.(event.content_block.name, 'calling')
          }
        }
      }

      // Get the final message to check for tool use
      const finalMessage = await stream.finalMessage()
      const stopReason = finalMessage.stop_reason

      // Check if we need to handle tool calls or continuation
      if (stopReason === 'tool_use') {
        // Extract tool use blocks from the response
        const toolUseBlocks = finalMessage.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
        )

        // Execute each tool and collect results
        const toolResults: Array<{
          type: 'tool_result'
          tool_use_id: string
          content: string
        }> = []

        for (const toolUse of toolUseBlocks) {
          if (isMcpTool(toolUse.name)) {
            try {
              const result = await executeMcpTool(
                toolUse.name,
                toolUse.input as Record<string, unknown>
              )
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: JSON.stringify(result, null, 2),
              })
              onToolUse?.(toolUse.name, 'complete')
            } catch (error) {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
              })
              onToolUse?.(toolUse.name, 'complete')
            }
          }
        }

        // Add assistant message with tool use to history
        anthropicMessages.push({
          role: 'assistant',
          content: finalMessage.content as ContentBlockParam[],
        })

        // Add tool results to history
        anthropicMessages.push({
          role: 'user',
          content: toolResults,
        })

        // Continue the loop to get Claude's response to tool results
        continueLoop = true
        needsSpaceBefore = true // May need space between previous text and continuation
      } else if (stopReason === 'max_tokens') {
        // Response was truncated - continue to get more content
        anthropicMessages.push({
          role: 'assistant',
          content: fullText,
        })
        anthropicMessages.push({
          role: 'user',
          content: 'Continue where you left off.',
        })
        continueLoop = true
        needsSpaceBefore = true
      } else {
        // end_turn or other - we're done
        continueLoop = false
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

