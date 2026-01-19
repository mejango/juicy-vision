import { useState, useCallback, useRef, useEffect } from 'react'
import { useChatStore, useSettingsStore, useThemeStore, type Message, type Attachment } from '../../stores'
import { streamChatResponse, generateConversationTitle } from '../../services/claude'
import MessageList from './MessageList'
import ChatInput from './ChatInput'
import WelcomeScreen from './WelcomeScreen'
import WelcomeGreeting from './WelcomeGreeting'
import ConversationHistory from './ConversationHistory'
import WalletInfo from './WalletInfo'
import { stripComponents } from '../../utils/messageParser'

// Convert messages to markdown format
function exportToMarkdown(messages: Message[], title: string): string {
  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  let md = `# ${title}\n\n`
  md += `*Exported on ${date}*\n\n---\n\n`

  for (const msg of messages) {
    const role = msg.role === 'user' ? '**You**' : '**Juicy**'
    // Strip juice-component tags for cleaner output
    const content = stripComponents(msg.content)
    md += `${role}:\n\n${content}\n\n---\n\n`
  }

  return md
}

// Trigger download of markdown file
function downloadMarkdown(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function ChatContainer() {
  const {
    activeConversationId,
    getActiveConversation,
    createConversation,
    addMessage,
    updateMessage,
    setMessageStreaming,
    isStreaming,
    setIsStreaming,
    updateConversationTitle,
  } = useChatStore()

  const { claudeApiKey, isConfigured } = useSettingsStore()
  const { theme } = useThemeStore()
  const [error, setError] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const conversation = getActiveConversation()
  const messages = conversation?.messages || []

  // Static placeholder - no longer changes contextually
  const placeholder = "What's your juicy vision?"

  const handleSend = useCallback(async (content: string, attachments?: Attachment[]) => {
    if (!isConfigured()) {
      setError('Please configure your Claude API key in settings')
      return
    }

    setError(null)

    // Get or create conversation
    let convId = activeConversationId
    if (!convId) {
      convId = createConversation()
    }

    // Add user message with attachments
    addMessage(convId, { role: 'user', content }, attachments)

    // Create assistant message placeholder
    const assistantMsgId = addMessage(convId, { role: 'assistant', content: '', isStreaming: true })

    setIsStreaming(true)
    abortControllerRef.current = new AbortController()

    try {
      // Get updated messages for API call
      const currentConv = useChatStore.getState().conversations.find(c => c.id === convId)
      const apiMessages = currentConv?.messages
        .filter(m => m.id !== assistantMsgId)
        .map(m => ({ role: m.role, content: m.content, attachments: m.attachments })) || []

      let fullResponse = ''

      await streamChatResponse({
        apiKey: claudeApiKey,
        messages: apiMessages,
        onToken: (token) => {
          fullResponse += token
          updateMessage(convId!, assistantMsgId, fullResponse)
        },
        onComplete: async () => {
          setMessageStreaming(convId!, assistantMsgId, false)
          setIsStreaming(false)

          // Generate better title after first exchange
          const conv = useChatStore.getState().conversations.find(c => c.id === convId)
          if (conv && conv.messages.length === 2) {
            const userMsg = conv.messages[0]?.content || ''
            const title = await generateConversationTitle(claudeApiKey, userMsg, fullResponse)
            updateConversationTitle(convId!, title)
          }
        },
        onError: (err) => {
          setError(err.message)
          setMessageStreaming(convId!, assistantMsgId, false)
          setIsStreaming(false)
          if (!fullResponse) {
            updateMessage(convId!, assistantMsgId, 'Sorry, an error occurred. Please try again.')
          }
        },
        signal: abortControllerRef.current.signal,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setIsStreaming(false)
    }
  }, [activeConversationId, claudeApiKey, isConfigured, createConversation, addMessage, updateMessage, setMessageStreaming, setIsStreaming, updateConversationTitle])

  const handleSuggestionClick = (text: string) => {
    handleSend(text)
  }

  const handleExport = () => {
    if (!conversation || messages.length === 0) return
    const md = exportToMarkdown(messages, conversation.title)
    const filename = `${conversation.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.md`
    downloadMarkdown(md, filename)
  }

  // Listen for messages from dynamic components (e.g., recommendation chips)
  useEffect(() => {
    const handleComponentMessage = (event: CustomEvent<{ message: string }>) => {
      if (event.detail?.message) {
        handleSend(event.detail.message)
      }
    }

    window.addEventListener('juice:send-message', handleComponentMessage as EventListener)
    return () => {
      window.removeEventListener('juice:send-message', handleComponentMessage as EventListener)
    }
  }, [handleSend])

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main content area - chips, mascot, messages, input */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Error banner */}
        {error && (
          <div className="bg-red-500/20 border-b border-red-500/50 px-4 py-2 text-red-300 text-sm shrink-0">
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-2 text-red-400 hover:text-red-200"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Messages or Welcome - scrollable area */}
        {/* Golden ratio: content ~62%, dock ~38% when on welcome screen */}
        <div className={`overflow-y-auto ${messages.length === 0 ? 'h-[62vh]' : 'flex-1'}`}>
          {messages.length === 0 ? (
            <WelcomeScreen onSuggestionClick={handleSuggestionClick} />
          ) : (
            <>
              {/* Export button */}
              <div className={`flex justify-end px-4 py-2 border-b ${
                theme === 'dark' ? 'border-white/10' : 'border-gray-200'
              }`}>
                <button
                  onClick={handleExport}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                    theme === 'dark'
                      ? 'text-gray-400 hover:text-white hover:bg-white/10'
                      : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Export
                </button>
              </div>
              <MessageList messages={messages} />
            </>
          )}
        </div>

        {/* Input dock - golden ratio (38%) when on welcome screen, shrink when chatting */}
        {/* Whole dock scrolls, prompt sticks at top when scrolled */}
        <div className={`relative z-20 ${messages.length === 0
          ? 'h-[38vh] overflow-y-auto'
          : 'shrink-0'
        }`}>
          {/* Welcome greeting scrolls away */}
          {messages.length === 0 && (
            <div className="pt-16">
              <WelcomeGreeting />
            </div>
          )}
          {/* Prompt bar sticks at top when scrolled */}
          <div className={messages.length === 0
            ? `sticky top-0 z-10 ${theme === 'dark' ? 'bg-[#1a1a1a]' : 'bg-white'}`
            : ''
          }>
            <ChatInput
              onSend={handleSend}
              disabled={isStreaming}
              hideBorder={messages.length === 0}
              hideWalletInfo={messages.length === 0}
              compact={messages.length === 0}
              placeholder={placeholder}
            />
          </div>
          {/* Wallet info and conversation history scroll */}
          {messages.length === 0 && (
            <>
              <WalletInfo />
              <ConversationHistory />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
