import { useState, useEffect } from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ParaProvider, Environment } from '@getpara/react-sdk'
import '@getpara/react-sdk/styles.css'
import { ChatContainer, ProtocolActivity } from './components/chat'
import { SettingsPanel } from './components/settings'
import { useSettingsStore, useChatStore, useThemeStore } from './stores'
import { useTransactionExecutor } from './hooks'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 2,
    },
  },
})

function Header() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { conversations, activeConversationId, createConversation, setActiveConversation, deleteConversation } = useChatStore()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { theme } = useThemeStore()

  const handleNewChat = () => {
    createConversation()
    setSidebarOpen(false)
  }

  return (
    <>
      <header className={`border-b sticky top-0 z-40 ${
        theme === 'dark'
          ? 'border-white/10 bg-juice-dark'
          : 'border-gray-200 bg-white'
      }`}>
        <div className="flex items-center justify-between px-4 pt-2 pb-1">
          {/* Left - Menu & Logo */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className={`lg:hidden p-2 ${
                theme === 'dark'
                  ? 'text-gray-400 hover:text-white hover:bg-white/10'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-200'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            <button
              onClick={() => {
                createConversation()
                // Focus the prompt bar after creating new conversation
                setTimeout(() => {
                  window.dispatchEvent(new CustomEvent('juice:prefill-prompt', {
                    detail: { text: '', focus: true }
                  }))
                }, 100)
              }}
              className="flex items-center gap-4 hover:opacity-80 transition-opacity"
            >
              <img
                src={theme === 'dark' ? '/head-dark.png' : '/head-light.png'}
                alt="Juicy Vision"
                className="h-24 -my-4"
              />
              <span className={`text-sm font-medium ${
                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
              }`}>juicy.vision</span>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <div className={`absolute left-0 top-0 bottom-0 w-72 border-r p-4 ${
            theme === 'dark'
              ? 'bg-juice-dark border-white/10'
              : 'bg-white border-gray-200'
          }`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className={`font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Conversations</h2>
              <button
                onClick={() => setSidebarOpen(false)}
                className={`p-2 ${theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <button
              onClick={handleNewChat}
              className="w-full mb-4 px-4 py-2 bg-juice-cyan text-juice-dark font-medium hover:bg-juice-cyan/90 transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Chat
            </button>

            <div className="space-y-1 overflow-y-auto max-h-[calc(100vh-150px)]">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                    conv.id === activeConversationId
                      ? 'bg-juice-orange/20 ' + (theme === 'dark' ? 'text-white' : 'text-gray-900')
                      : theme === 'dark'
                        ? 'text-gray-400 hover:bg-white/10 hover:text-white'
                        : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900'
                  }`}
                  onClick={() => {
                    setActiveConversation(conv.id)
                    setSidebarOpen(false)
                  }}
                >
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  <span className="truncate flex-1 text-sm">{conv.title}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteConversation(conv.id)
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-300"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <SettingsPanel isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  )
}

function MainContent({ hasHeader }: { hasHeader: boolean }) {
  return (
    <div className={`flex flex-col ${hasHeader ? 'h-[calc(100vh-81px)]' : 'h-screen'}`}>
      <ChatContainer />
    </div>
  )
}

function AppProviders({ children }: { children: React.ReactNode }) {
  const { paraApiKey } = useSettingsStore()

  return (
    <QueryClientProvider client={queryClient}>
      <ParaProvider
        paraClientConfig={{
          env: Environment.BETA,
          apiKey: paraApiKey || 'beta_e5108365cf0b2fd615914efb50c3ca82',
        }}
        config={{
          appName: 'Juicy Vision',
        }}
        externalWalletConfig={{
          appDescription: 'Juicy Vision - AI-powered Juicebox interface',
          appUrl: window.location.origin,
          appIcon: `${window.location.origin}/head-dark.png`,
        }}
        paraModalConfig={{
          logo: `${window.location.origin}/head-light.png`,
          theme: {
            accentColor: '#F5A623',
            font: 'Space Mono',
            borderRadius: 'none',
          },
          oAuthMethods: ['GOOGLE', 'APPLE'],
          authLayout: ['AUTH:FULL', 'EXTERNAL:FULL'],
          recoverySecretStepEnabled: true,
          onRampTestMode: true,
        }}
      >
        {children}
      </ParaProvider>
    </QueryClientProvider>
  )
}

function ActivitySidebar({ onProjectClick }: { onProjectClick: (query: string) => void }) {
  const { theme, toggleTheme } = useThemeStore()
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <>
      <div className={`w-[280px] flex-shrink-0 flex flex-col border-l h-screen fixed right-0 top-0 z-30 ${
        theme === 'dark'
          ? 'border-white/20 bg-juice-dark'
          : 'border-gray-300 bg-white'
      }`}>
        {/* Header with settings and theme - matches main header height */}
        <div className={`flex items-center justify-between px-4 pt-4 pb-5 border-b ${
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
            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className={`p-2 transition-colors ${
                theme === 'dark'
                  ? 'text-gray-400 hover:text-white hover:bg-white/10'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
              }`}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>
            {/* Settings */}
            <button
              onClick={() => setSettingsOpen(true)}
              className={`p-2 transition-colors ${
                theme === 'dark'
                  ? 'text-gray-400 hover:text-white hover:bg-white/10'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
              }`}
              title="Settings"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Activity list */}
        <div className="flex-1 overflow-y-auto px-4 hide-scrollbar">
          <ProtocolActivity onProjectClick={onProjectClick} />
        </div>
      </div>
      <SettingsPanel isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  )
}

// Component that activates transaction execution listener
function TransactionExecutor() {
  useTransactionExecutor()
  return null
}

function AppContent() {
  const { theme } = useThemeStore()
  const { getActiveConversation } = useChatStore()
  const conversation = getActiveConversation()
  const hasMessages = conversation && conversation.messages.length > 0

  useEffect(() => {
    document.documentElement.className = theme
  }, [theme])

  // Handle project clicks from activity feed
  const handleActivityProjectClick = (query: string) => {
    // Dispatch a custom event that ChatContainer can listen to
    window.dispatchEvent(new CustomEvent('juice:send-message', { detail: { message: query } }))
  }

  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'bg-juice-dark' : 'bg-white'}`}>
      {/* Transaction executor - listens for pay events */}
      <TransactionExecutor />
      {/* Main content with right margin for sidebar */}
      <div className="mr-[280px]">
        {hasMessages && <Header />}
        <Routes>
          <Route path="/" element={<MainContent hasHeader={!!hasMessages} />} />
          <Route path="*" element={<MainContent hasHeader={!!hasMessages} />} />
        </Routes>
      </div>
      {/* Full-height activity sidebar */}
      <ActivitySidebar onProjectClick={handleActivityProjectClick} />
    </div>
  )
}

export default function App() {
  return (
    <AppProviders>
      <HashRouter>
        <AppContent />
      </HashRouter>
    </AppProviders>
  )
}
