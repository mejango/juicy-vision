import Anthropic from '@anthropic-ai/sdk'

let clientInstance: Anthropic | null = null

export function getClaudeClient(apiKey: string): Anthropic {
  if (!clientInstance || (clientInstance as unknown as { apiKey: string }).apiKey !== apiKey) {
    clientInstance = new Anthropic({
      apiKey,
      dangerouslyAllowBrowser: true,
    })
  }
  return clientInstance
}
