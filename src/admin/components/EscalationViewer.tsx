import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useThemeStore } from '../../stores'
import { useAuthStore } from '../../stores/authStore'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

interface Escalation {
  id: string
  chat_id: string
  message_id: string
  user_query: string
  ai_response: string
  confidence_level: 'high' | 'medium' | 'low'
  confidence_reason: string | null
  status: 'pending' | 'approved' | 'corrected'
  admin_correction: string | null
  review_notes: string | null
  created_at: string
  reviewed_at: string | null
  reviewed_by: string | null
}

interface ContextMessage {
  role: string
  content: string
  created_at: string
}

interface EscalationViewerProps {
  escalation: Escalation
  onClose: () => void
  onResolved: () => void
}

export default function EscalationViewer({ escalation, onClose, onResolved }: EscalationViewerProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const token = useAuthStore((state) => state.token)

  const [reviewNotes, setReviewNotes] = useState(escalation.review_notes || '')
  const [adminCorrection, setAdminCorrection] = useState(escalation.admin_correction || '')

  // Fetch escalation detail with context
  const { data: detailData, isLoading } = useQuery({
    queryKey: ['escalation-detail', escalation.id],
    queryFn: async () => {
      const response = await fetch(`${API_BASE_URL}/admin/escalations/${escalation.id}`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      })
      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to fetch escalation detail')
      }
      return data.data as {
        escalation: Escalation
        context: ContextMessage[]
      }
    },
    enabled: !!token,
  })

  // Resolve mutation
  const resolveMutation = useMutation({
    mutationFn: async (status: 'approved' | 'corrected') => {
      const response = await fetch(`${API_BASE_URL}/admin/escalations/${escalation.id}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          status,
          reviewNotes: reviewNotes || undefined,
          adminCorrection: status === 'corrected' ? adminCorrection : undefined,
        }),
      })
      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to resolve escalation')
      }
      return data.data
    },
    onSuccess: () => {
      onResolved()
    },
  })

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getConfidenceBadge = (level: string) => {
    const colors = {
      high: isDark ? 'bg-green-900/50 text-green-300' : 'bg-green-100 text-green-800',
      medium: isDark ? 'bg-yellow-900/50 text-yellow-300' : 'bg-yellow-100 text-yellow-800',
      low: isDark ? 'bg-red-900/50 text-red-300' : 'bg-red-100 text-red-800',
    }
    return colors[level as keyof typeof colors] || colors.low
  }

  const isPending = escalation.status === 'pending'

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Slide-over panel */}
      <div className={`relative w-full max-w-2xl h-full overflow-y-auto ${
        isDark ? 'bg-zinc-900' : 'bg-white'
      }`}>
        {/* Header */}
        <div className={`sticky top-0 z-10 px-6 py-4 border-b ${
          isDark ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-gray-200'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                Escalation Review
              </h2>
              <div className="flex items-center gap-2 mt-1">
                <span className={`px-2 py-0.5 text-xs rounded-full ${getConfidenceBadge(escalation.confidence_level)}`}>
                  {escalation.confidence_level} confidence
                </span>
                <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  {formatDate(escalation.created_at)}
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              className={`p-2 rounded-lg ${
                isDark ? 'hover:bg-zinc-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="p-6 text-center">
            <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Loading...</div>
          </div>
        ) : (
          <div className="p-6 space-y-6">
            {/* Confidence reason */}
            {escalation.confidence_reason && (
              <div>
                <div className={`text-xs font-medium uppercase mb-2 ${
                  isDark ? 'text-gray-500' : 'text-gray-400'
                }`}>
                  Confidence Reason
                </div>
                <div className={`text-sm p-3 rounded-lg ${
                  isDark ? 'bg-zinc-800 text-gray-300' : 'bg-gray-50 text-gray-700'
                }`}>
                  {escalation.confidence_reason}
                </div>
              </div>
            )}

            {/* User query */}
            <div>
              <div className={`text-xs font-medium uppercase mb-2 ${
                isDark ? 'text-gray-500' : 'text-gray-400'
              }`}>
                User Query
              </div>
              <div className={`text-sm p-3 rounded-lg border-l-2 ${
                isDark
                  ? 'bg-zinc-800 text-gray-200 border-blue-500'
                  : 'bg-blue-50 text-gray-800 border-blue-500'
              }`}>
                {escalation.user_query}
              </div>
            </div>

            {/* AI response */}
            <div>
              <div className={`text-xs font-medium uppercase mb-2 ${
                isDark ? 'text-gray-500' : 'text-gray-400'
              }`}>
                AI Response (Flagged)
              </div>
              <div className={`text-sm p-3 rounded-lg border-l-2 whitespace-pre-wrap ${
                isDark
                  ? 'bg-zinc-800 text-gray-200 border-red-500'
                  : 'bg-red-50 text-gray-800 border-red-500'
              }`}>
                {escalation.ai_response}
              </div>
            </div>

            {/* Conversation context */}
            {detailData?.context && detailData.context.length > 0 && (
              <div>
                <div className={`text-xs font-medium uppercase mb-2 ${
                  isDark ? 'text-gray-500' : 'text-gray-400'
                }`}>
                  Conversation Context
                </div>
                <div className={`rounded-lg border overflow-hidden ${
                  isDark ? 'border-zinc-700' : 'border-gray-200'
                }`}>
                  {detailData.context.map((msg, i) => (
                    <div
                      key={i}
                      className={`p-3 text-sm ${
                        i > 0 ? (isDark ? 'border-t border-zinc-800' : 'border-t border-gray-100') : ''
                      } ${
                        msg.role === 'assistant'
                          ? isDark ? 'bg-zinc-800/50' : 'bg-gray-50'
                          : ''
                      }`}
                    >
                      <div className={`text-xs mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        {msg.role === 'assistant' ? 'AI' : 'User'} - {formatDate(msg.created_at)}
                      </div>
                      <div className={`whitespace-pre-wrap ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                        {msg.content.length > 500 ? msg.content.slice(0, 500) + '...' : msg.content}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Review form (only for pending) */}
            {isPending && (
              <>
                <div>
                  <label className={`block text-xs font-medium uppercase mb-2 ${
                    isDark ? 'text-gray-500' : 'text-gray-400'
                  }`}>
                    Review Notes (optional)
                  </label>
                  <textarea
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    rows={2}
                    placeholder="Add notes about this review..."
                    className={`w-full px-3 py-2 text-sm rounded-lg border resize-none ${
                      isDark
                        ? 'bg-zinc-800 border-zinc-700 text-gray-200 placeholder-gray-500'
                        : 'bg-white border-gray-200 text-gray-800 placeholder-gray-400'
                    }`}
                  />
                </div>

                <div>
                  <label className={`block text-xs font-medium uppercase mb-2 ${
                    isDark ? 'text-gray-500' : 'text-gray-400'
                  }`}>
                    Admin Correction (if marking as corrected)
                  </label>
                  <textarea
                    value={adminCorrection}
                    onChange={(e) => setAdminCorrection(e.target.value)}
                    rows={3}
                    placeholder="What should the AI have said instead?"
                    className={`w-full px-3 py-2 text-sm rounded-lg border resize-none ${
                      isDark
                        ? 'bg-zinc-800 border-zinc-700 text-gray-200 placeholder-gray-500'
                        : 'bg-white border-gray-200 text-gray-800 placeholder-gray-400'
                    }`}
                  />
                </div>

                {/* Action buttons */}
                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => resolveMutation.mutate('approved')}
                    disabled={resolveMutation.isPending}
                    className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                      resolveMutation.isPending
                        ? 'opacity-50 cursor-not-allowed'
                        : isDark
                          ? 'bg-blue-600 text-white hover:bg-blue-500'
                          : 'bg-blue-500 text-white hover:bg-blue-600'
                    }`}
                  >
                    Approve as-is
                  </button>
                  <button
                    onClick={() => resolveMutation.mutate('corrected')}
                    disabled={resolveMutation.isPending || !adminCorrection.trim()}
                    className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                      resolveMutation.isPending || !adminCorrection.trim()
                        ? 'opacity-50 cursor-not-allowed'
                        : isDark
                          ? 'bg-purple-600 text-white hover:bg-purple-500'
                          : 'bg-purple-500 text-white hover:bg-purple-600'
                    }`}
                  >
                    Mark as Corrected
                  </button>
                </div>

                {resolveMutation.isError && (
                  <div className="text-sm text-red-500">
                    {resolveMutation.error instanceof Error ? resolveMutation.error.message : 'Failed to resolve'}
                  </div>
                )}
              </>
            )}

            {/* Already resolved info */}
            {!isPending && (
              <div className={`p-4 rounded-lg ${isDark ? 'bg-zinc-800' : 'bg-gray-50'}`}>
                <div className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  <strong>Resolved:</strong> {escalation.status} by {escalation.reviewed_by || 'admin'}
                  {escalation.reviewed_at && (
                    <span className={`ml-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      on {formatDate(escalation.reviewed_at)}
                    </span>
                  )}
                </div>
                {escalation.review_notes && (
                  <div className={`mt-2 text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                    <strong>Notes:</strong> {escalation.review_notes}
                  </div>
                )}
                {escalation.admin_correction && (
                  <div className={`mt-2 text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                    <strong>Correction:</strong> {escalation.admin_correction}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
