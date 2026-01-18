import type Anthropic from '@anthropic-ai/sdk'
import { getClaudeClient } from './client'
import { SYSTEM_PROMPT, formatConversationHistory } from './prompts'
import { MCP_TOOLS, isMcpTool, executeMcpTool } from '../mcp'

export interface StreamOptions {
  apiKey: string
  messages: { role: 'user' | 'assistant'; content: string }[]
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
        max_tokens: 4096,
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

      // Check if we need to handle tool calls
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
      } else {
        // No more tool calls, we're done
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

