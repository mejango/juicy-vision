import { useState, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatStore, useSettingsStore, useThemeStore, LANGUAGES, type Message, type Attachment } from '../../stores'
import { streamChatResponse, generateConversationTitle } from '../../services/claude'
import MessageList from './MessageList'
import ChatInput from './ChatInput'
import WelcomeScreen from './WelcomeScreen'
import WelcomeGreeting from './WelcomeGreeting'
import ConversationHistory from './ConversationHistory'
import WalletInfo from './WalletInfo'
import { SettingsPanel, PrivacySelector } from '../settings'
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

interface ChatContainerProps {
  topOnly?: boolean
  bottomOnly?: boolean
}

export default function ChatContainer({ topOnly, bottomOnly }: ChatContainerProps = {}) {
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

  const { claudeApiKey, isConfigured, language, setLanguage } = useSettingsStore()
  const { theme, toggleTheme } = useThemeStore()
  const { t } = useTranslation()
  const [error, setError] = useState<string | null>(null)
  const [isPromptStuck, setIsPromptStuck] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [langMenuOpen, setLangMenuOpen] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const dockRef = useRef<HTMLDivElement | null>(null)

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

          // Generate/refine title at key milestones
          // After first exchange, then periodically as context deepens
          const conv = useChatStore.getState().conversations.find(c => c.id === convId)
          if (conv) {
            const messageCount = conv.messages.length
            // Generate title after: first exchange (2), then at 4, 8, 12 messages
            const shouldUpdateTitle = messageCount === 2 ||
              (messageCount >= 4 && messageCount % 4 === 0)

            if (shouldUpdateTitle) {
              const apiMessages = conv.messages.map(m => ({
                role: m.role,
                content: m.content
              }))
              const title = await generateConversationTitle(
                claudeApiKey,
                apiMessages,
                conv.title
              )
              updateConversationTitle(convId!, title)
            }
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
  // Only listen if we're the instance with the input (bottomOnly or neither specified)
  // This prevents duplicate message handling when split into topOnly/bottomOnly
  useEffect(() => {
    // Skip if we're topOnly (no input to handle messages)
    if (topOnly) return

    const handleComponentMessage = (event: CustomEvent<{ message: string }>) => {
      if (event.detail?.message) {
        handleSend(event.detail.message)
      }
    }

    window.addEventListener('juice:send-message', handleComponentMessage as EventListener)
    return () => {
      window.removeEventListener('juice:send-message', handleComponentMessage as EventListener)
    }
  }, [handleSend, topOnly])

  // Detect when dock is scrolled to show background on sticky prompt
  useEffect(() => {
    const dock = dockRef.current
    if (!dock) return

    const handleScroll = () => {
      // Show background when scrolled more than a few pixels
      setIsPromptStuck(dock.scrollTop > 10)
    }

    dock.addEventListener('scroll', handleScroll)
    return () => dock.removeEventListener('scroll', handleScroll)
  }, [messages.length])

  return (
    <div className="flex h-full overflow-hidden relative">
      {/* Main content area - chips, mascot, messages, input */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
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

        {messages.length === 0 ? (
          <>
            {/* Welcome screen (recommendations) - only show if topOnly or neither specified */}
            {(topOnly || (!topOnly && !bottomOnly)) && (
              <div className="flex-1 overflow-hidden">
                <WelcomeScreen onSuggestionClick={handleSuggestionClick} />
              </div>
            )}

            {/* Prompt dock - only show if bottomOnly or neither specified */}
            {(bottomOnly || (!topOnly && !bottomOnly)) && (
              <div
                ref={dockRef}
                className={`${bottomOnly ? 'h-full' : 'absolute bottom-0 left-0 right-0 z-30 h-[38%] border-t-4 border-juice-orange'} overflow-y-auto backdrop-blur-md relative ${
                  theme === 'dark' ? 'bg-juice-dark/75' : 'bg-white/75'
                }`}
              >
                {/* Theme, Settings & Language controls - top right */}
                <div className="absolute top-3 right-4 flex items-center gap-1 z-50">
                  {/* Language selector */}
                  <div className="relative">
                    <button
                      onClick={() => setLangMenuOpen(!langMenuOpen)}
                      className={`px-2 py-1 text-xs transition-colors ${
                        theme === 'dark'
                          ? 'text-gray-400 hover:text-white'
                          : 'text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      {LANGUAGES.find(l => l.code === language)?.native || 'English'}
                    </button>
                    {langMenuOpen && (
                      <div
                        className={`absolute top-full right-0 mt-1 py-1 border shadow-lg ${
                          theme === 'dark'
                            ? 'bg-juice-dark border-white/20'
                            : 'bg-white border-gray-200'
                        }`}
                        onMouseLeave={() => setLangMenuOpen(false)}
                      >
                        {LANGUAGES.map(lang => (
                          <button
                            key={lang.code}
                            onClick={() => {
                              setLanguage(lang.code)
                              setLangMenuOpen(false)
                            }}
                            className={`w-full px-4 py-2 text-sm text-left whitespace-nowrap transition-colors ${
                              language === lang.code
                                ? theme === 'dark'
                                  ? 'bg-green-500/20 text-green-400'
                                  : 'bg-green-50 text-green-700'
                                : theme === 'dark'
                                  ? 'text-white/80 hover:bg-white/10'
                                  : 'text-gray-700 hover:bg-gray-100'
                            }`}
                          >
                            {lang.native}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Privacy mode */}
                  <PrivacySelector />
                  {/* Theme toggle */}
                  <button
                    onClick={toggleTheme}
                    className={`p-1.5 transition-colors ${
                      theme === 'dark'
                        ? 'text-gray-400 hover:text-white'
                        : 'text-gray-500 hover:text-gray-900'
                    }`}
                    title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                  >
                    {theme === 'dark' ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                      </svg>
                    )}
                  </button>
                  {/* Settings */}
                  <button
                    onClick={() => setSettingsOpen(true)}
                    className={`p-1.5 transition-colors ${
                      theme === 'dark'
                        ? 'text-gray-400 hover:text-white'
                        : 'text-gray-500 hover:text-gray-900'
                    }`}
                    title="Settings"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </button>
                </div>

                {/* Spacer to position prompt at 38% from top (golden ratio) - includes greeting */}
                {/* Subtracts 1rem for ChatInput's py-4 top padding */}
                <div className="h-[calc(38%-1rem)] flex flex-col justify-end">
                  <WelcomeGreeting />
                </div>
                {/* Prompt bar sticks at top when scrolled - background only when stuck */}
                <div className={`sticky top-0 z-10 transition-colors ${
                  isPromptStuck
                    ? theme === 'dark' ? 'bg-juice-dark/95 backdrop-blur-sm' : 'bg-white/95 backdrop-blur-sm'
                    : ''
                }`}>
                  <ChatInput
                    onSend={handleSend}
                    disabled={isStreaming}
                    hideBorder={true}
                    hideWalletInfo={true}
                    compact={true}
                    placeholder={placeholder}
                  />
                </div>
                {/* Subtext hint - scrolls with content */}
                <div className="flex gap-3 px-6 pb-4">
                  <div className="w-[48px] shrink-0" />
                  <div className={`text-xs ${theme === 'dark' ? 'text-gray-600' : 'text-gray-400'}`}>
                    {t('dock.askAbout', 'or ask about any juicebox ecosystem project')}
                  </div>
                </div>
                {/* Wallet info and conversation history scroll */}
                <WalletInfo />
                <ConversationHistory />
              </div>
            )}
          </>
        ) : (
          <>
            {/* Messages scrollable area - only show if topOnly or neither specified */}
            {(topOnly || (!topOnly && !bottomOnly)) && (
              <div className="overflow-y-auto flex-1">
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
              </div>
            )}

            {/* Input dock - only show if bottomOnly or neither specified */}
            {(bottomOnly || (!topOnly && !bottomOnly)) && (
              <div className={`${bottomOnly ? 'h-full flex flex-col justify-center' : 'shrink-0'}`}>
                <ChatInput
                  onSend={handleSend}
                  disabled={isStreaming}
                  hideBorder={false}
                  hideWalletInfo={false}
                  compact={false}
                  placeholder={placeholder}
                />
              </div>
            )}
          </>
        )}
      </div>
      <SettingsPanel isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
