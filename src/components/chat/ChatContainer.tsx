import { useState, useCallback, useRef } from 'react'
import { useChatStore, useSettingsStore, useThemeStore } from '../../stores'
import { streamChatResponse } from '../../services/claude'
import MessageList from './MessageList'
import ChatInput from './ChatInput'
import WelcomeScreen from './WelcomeScreen'
import ProtocolActivity from './ProtocolActivity'
import { SettingsPanel } from '../settings'

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
  } = useChatStore()

  const { claudeApiKey, isConfigured } = useSettingsStore()
  const { theme, toggleTheme } = useThemeStore()
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  const conversation = getActiveConversation()
  const messages = conversation?.messages || []

  const handleSend = useCallback(async (content: string) => {
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

    // Add user message
    addMessage(convId, { role: 'user', content })

    // Create assistant message placeholder
    const assistantMsgId = addMessage(convId, { role: 'assistant', content: '', isStreaming: true })

    setIsStreaming(true)
    abortControllerRef.current = new AbortController()

    try {
      // Get updated messages for API call
      const currentConv = useChatStore.getState().conversations.find(c => c.id === convId)
      const apiMessages = currentConv?.messages
        .filter(m => m.id !== assistantMsgId)
        .map(m => ({ role: m.role, content: m.content })) || []

      let fullResponse = ''

      await streamChatResponse({
        apiKey: claudeApiKey,
        messages: apiMessages,
        onToken: (token) => {
          fullResponse += token
          updateMessage(convId!, assistantMsgId, fullResponse)
        },
        onComplete: () => {
          setMessageStreaming(convId!, assistantMsgId, false)
          setIsStreaming(false)
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
  }, [activeConversationId, claudeApiKey, isConfigured, createConversation, addMessage, updateMessage, setMessageStreaming, setIsStreaming])

  const handleSuggestionClick = (text: string) => {
    handleSend(text)
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main content area (left) - chips, mascot, messages, input */}
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
        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <WelcomeScreen onSuggestionClick={handleSuggestionClick} />
          ) : (
            <MessageList messages={messages} />
          )}
        </div>

        {/* Input - fixed at bottom */}
        <div className="shrink-0">
          <ChatInput
            onSend={handleSend}
            disabled={isStreaming}
            placeholder="What's your juicy vision?"
          />
        </div>
      </div>

      {/* Activity panel (right) - full height, always pinned */}
      <div className={`w-[280px] flex-shrink-0 flex flex-col border-l backdrop-blur-md ${
        theme === 'dark'
          ? 'border-white/20 bg-juice-dark/80'
          : 'border-gray-300 bg-white/80'
      }`}>
        {/* Header with settings */}
        <div className={`flex items-center justify-between px-4 py-3 border-b ${
          theme === 'dark' ? 'border-white/10' : 'border-gray-200'
        }`}>
          <div>
            <h2 className={`font-semibold ${
              theme === 'dark' ? 'text-white' : 'text-gray-900'
            }`}>
              Juicy Activity
            </h2>
            <p className={`text-xs ${
              theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
            }`}>
              Live
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={toggleTheme}
              className={`p-2 rounded transition-colors ${
                theme === 'dark'
                  ? 'text-gray-400 hover:text-white hover:bg-white/10'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-black/10'
              }`}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className={`p-2 rounded transition-colors ${
                theme === 'dark'
                  ? 'text-gray-400 hover:text-white hover:bg-white/10'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-black/10'
              }`}
              title="Settings"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Activity list */}
        <div className="flex-1 overflow-y-auto px-4 hide-scrollbar">
          <ProtocolActivity onProjectClick={handleSuggestionClick} />
        </div>
      </div>

      <SettingsPanel isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
