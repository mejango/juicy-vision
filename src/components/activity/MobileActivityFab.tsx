/**
 * The live activity / search / trending discovery surface.
 *
 * ActivitySidebar is the desktop right-rail content. MobileActivityFab wraps
 * it for sub-md viewports: a floating action button that opens the sidebar as
 * a full-screen overlay. It is the only mobile entry point to search,
 * trending, and activity, so every full-page host (home/chat, project
 * dashboard, account view) renders it.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ProtocolActivity, TrendingProjects, ProjectSearch } from '../chat'
import NetworkModeSelect from '../common/NetworkModeSelect'
import { useChatStore, useThemeStore } from '../../stores'
import { useIsMobile } from '../../hooks'

export function ActivitySidebar({ onProjectClick }: { onProjectClick: (query: string) => void }) {
  const { theme } = useThemeStore()
  const { t } = useTranslation()

  const handleAddNote = () => {
    window.dispatchEvent(new CustomEvent('juice:send-message', {
      detail: { message: 'Write a juicy note with a ~0 payment onto NANA' }
    }))
  }

  return (
    <div className={`w-full flex flex-col h-full ${
      theme === 'dark'
        ? 'bg-juice-dark'
        : 'bg-white'
    }`}>
      {/* Header */}
      <div className={`px-3 py-2 border-b flex items-center justify-between ${
        theme === 'dark' ? 'border-white/10' : 'border-gray-200'
      }`}>
        <div className="flex items-baseline gap-2.5 min-w-0">
          <h2 className={`text-sm font-semibold whitespace-nowrap ${
            theme === 'dark' ? 'text-white' : 'text-gray-900'
          }`}>
            {t('ui.liveActivity', 'Live juicy activity')}
          </h2>
          <NetworkModeSelect />
        </div>
        <button
          onClick={handleAddNote}
          className={`p-1 rounded transition-colors ${
            theme === 'dark'
              ? 'text-gray-400 hover:text-juice-cyan'
              : 'text-gray-500 hover:text-teal-600'
          }`}
          title={t('ui.addNote', 'Add a juicy note')}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* Activity list — top half */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 hide-scrollbar">
        <ProtocolActivity onProjectClick={onProjectClick} />
      </div>

      {/* Trending projects — bottom half (V6 only) */}
      <div className={`px-3 py-2 border-t border-b flex items-center ${
        theme === 'dark' ? 'border-white/10' : 'border-gray-200'
      }`}>
        <h2 className={`text-sm font-semibold whitespace-nowrap ${
          theme === 'dark' ? 'text-white' : 'text-gray-900'
        }`}>
          {t('ui.trendingProjects', 'Trending projects')}
        </h2>
      </div>
      {/* Project/account search — results overlay the trending list below */}
      <div className={`px-3 py-2 border-b ${
        theme === 'dark' ? 'border-white/10' : 'border-gray-200'
      }`}>
        <ProjectSearch />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 hide-scrollbar">
        <TrendingProjects onProjectClick={onProjectClick} />
      </div>
    </div>
  )
}

/**
 * Mobile-only floating toggle + full-screen ActivitySidebar overlay.
 *
 * Without `onProjectClick`, clicking an activity/trending project queues a new
 * chat with the generated query and navigates home, where ChatContainer picks
 * it up on mount (the same hand-off the project dashboard's chat dock uses) —
 * hosts without a mounted ChatContainer can't rely on the send-message event.
 */
export default function MobileActivityFab({
  onProjectClick,
}: {
  onProjectClick?: (query: string) => void
}) {
  const isMobile = useIsMobile()
  const { theme } = useThemeStore()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  if (!isMobile) return null

  const handleProjectClick = (query: string) => {
    setOpen(false)
    if (onProjectClick) {
      onProjectClick(query)
      return
    }
    useChatStore.getState().setActiveChat(null)
    useChatStore.getState().setQueuedNewChatMessage(query)
    navigate('/')
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Open live activity"
        title="Live activity, trending projects + search"
        className="fixed bottom-24 right-4 z-50 w-12 h-12 rounded-full bg-juice-orange text-juice-dark shadow-lg flex items-center justify-center"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      </button>
    )
  }

  return (
    <div className={`fixed inset-0 z-50 flex flex-col ${theme === 'dark' ? 'bg-juice-dark' : 'bg-white'}`}>
      <div className="flex items-center justify-between px-4 py-2 border-b border-juice-orange shrink-0">
        <span className={`text-sm font-medium ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
          Live Activity
        </span>
        <button
          onClick={() => setOpen(false)}
          aria-label="Close live activity"
          className={`p-2 rounded-lg ${theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <ActivitySidebar onProjectClick={handleProjectClick} />
      </div>
    </div>
  )
}
