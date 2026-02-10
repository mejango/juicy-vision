import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useThemeStore } from '../../stores'
import { useAuthStore } from '../../stores/authStore'
import EscalationViewer from '../components/EscalationViewer'

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
  chat_title?: string
  message_count?: number
}

interface EscalationStats {
  pending: number
  approved: number
  corrected: number
  avgReviewTimeHours: number | null
}

type StatusFilter = 'pending' | 'approved' | 'corrected' | undefined

export default function EscalationsPage() {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const token = useAuthStore((state) => state.token)

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending')
  const [page, setPage] = useState(1)
  const [selectedEscalation, setSelectedEscalation] = useState<Escalation | null>(null)
  const limit = 20

  const { data: statsData } = useQuery({
    queryKey: ['escalation-stats'],
    queryFn: async () => {
      const response = await fetch(`${API_BASE_URL}/admin/escalations/stats`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      })
      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to fetch stats')
      }
      return data.data as EscalationStats
    },
    enabled: !!token,
  })

  const { data: escalationsData, isLoading, refetch } = useQuery({
    queryKey: ['escalations', statusFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String((page - 1) * limit),
      })
      if (statusFilter) {
        params.set('status', statusFilter)
      }

      const response = await fetch(`${API_BASE_URL}/admin/escalations?${params}`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      })
      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to fetch escalations')
      }
      return {
        escalations: data.data as Escalation[],
        total: data.total as number,
      }
    },
    enabled: !!token,
  })

  const totalPages = escalationsData ? Math.ceil(escalationsData.total / limit) : 0

  const handleResolved = () => {
    refetch()
    setSelectedEscalation(null)
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const truncate = (text: string, maxLength: number) => {
    if (text.length <= maxLength) return text
    return text.slice(0, maxLength) + '...'
  }

  const getConfidenceBadge = (level: string) => {
    const colors = {
      high: isDark ? 'bg-green-900/50 text-green-300' : 'bg-green-100 text-green-800',
      medium: isDark ? 'bg-yellow-900/50 text-yellow-300' : 'bg-yellow-100 text-yellow-800',
      low: isDark ? 'bg-red-900/50 text-red-300' : 'bg-red-100 text-red-800',
    }
    return colors[level as keyof typeof colors] || colors.low
  }

  const getStatusBadge = (status: string) => {
    const colors = {
      pending: isDark ? 'bg-orange-900/50 text-orange-300' : 'bg-orange-100 text-orange-800',
      approved: isDark ? 'bg-blue-900/50 text-blue-300' : 'bg-blue-100 text-blue-800',
      corrected: isDark ? 'bg-purple-900/50 text-purple-300' : 'bg-purple-100 text-purple-800',
    }
    return colors[status as keyof typeof colors] || colors.pending
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
          AI Escalations
        </h1>
      </div>

      {/* Stats cards */}
      {statsData && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className={`p-4 rounded-lg ${isDark ? 'bg-zinc-800' : 'bg-white border border-gray-200'}`}>
            <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Pending Review</div>
            <div className={`text-2xl font-bold ${isDark ? 'text-orange-400' : 'text-orange-600'}`}>
              {statsData.pending}
            </div>
          </div>
          <div className={`p-4 rounded-lg ${isDark ? 'bg-zinc-800' : 'bg-white border border-gray-200'}`}>
            <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Approved</div>
            <div className={`text-2xl font-bold ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>
              {statsData.approved}
            </div>
          </div>
          <div className={`p-4 rounded-lg ${isDark ? 'bg-zinc-800' : 'bg-white border border-gray-200'}`}>
            <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Corrected</div>
            <div className={`text-2xl font-bold ${isDark ? 'text-purple-400' : 'text-purple-600'}`}>
              {statsData.corrected}
            </div>
          </div>
          <div className={`p-4 rounded-lg ${isDark ? 'bg-zinc-800' : 'bg-white border border-gray-200'}`}>
            <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Avg Review Time</div>
            <div className={`text-2xl font-bold ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
              {statsData.avgReviewTimeHours
                ? `${statsData.avgReviewTimeHours.toFixed(1)}h`
                : '-'}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        {(['pending', 'approved', 'corrected', undefined] as const).map((status) => (
          <button
            key={status || 'all'}
            onClick={() => {
              setStatusFilter(status)
              setPage(1)
            }}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              statusFilter === status
                ? isDark
                  ? 'bg-juice-cyan text-black'
                  : 'bg-teal-500 text-white'
                : isDark
                  ? 'bg-zinc-800 text-gray-300 hover:bg-zinc-700'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {status === undefined ? 'All' : status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className={`border rounded-lg overflow-hidden ${
        isDark ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-gray-200'
      }`}>
        {isLoading ? (
          <div className="p-8 text-center">
            <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Loading...</div>
          </div>
        ) : escalationsData?.escalations.length === 0 ? (
          <div className="p-8 text-center">
            <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              No escalations found
            </div>
          </div>
        ) : (
          <table className="w-full">
            <thead className={isDark ? 'bg-zinc-800' : 'bg-gray-50'}>
              <tr>
                <th className={`px-4 py-3 text-left text-xs font-medium uppercase ${
                  isDark ? 'text-gray-400' : 'text-gray-500'
                }`}>
                  User Query
                </th>
                <th className={`px-4 py-3 text-left text-xs font-medium uppercase ${
                  isDark ? 'text-gray-400' : 'text-gray-500'
                }`}>
                  Confidence
                </th>
                <th className={`px-4 py-3 text-left text-xs font-medium uppercase ${
                  isDark ? 'text-gray-400' : 'text-gray-500'
                }`}>
                  Status
                </th>
                <th className={`px-4 py-3 text-left text-xs font-medium uppercase ${
                  isDark ? 'text-gray-400' : 'text-gray-500'
                }`}>
                  Created
                </th>
                <th className={`px-4 py-3 text-left text-xs font-medium uppercase ${
                  isDark ? 'text-gray-400' : 'text-gray-500'
                }`}>
                  Chat
                </th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDark ? 'divide-zinc-800' : 'divide-gray-100'}`}>
              {escalationsData?.escalations.map((escalation) => (
                <tr
                  key={escalation.id}
                  onClick={() => setSelectedEscalation(escalation)}
                  className={`cursor-pointer transition-colors ${
                    isDark ? 'hover:bg-zinc-800' : 'hover:bg-gray-50'
                  }`}
                >
                  <td className={`px-4 py-3 ${isDark ? 'text-gray-200' : 'text-gray-900'}`}>
                    <div className="max-w-md">
                      {truncate(escalation.user_query, 80)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${getConfidenceBadge(escalation.confidence_level)}`}>
                      {escalation.confidence_level}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${getStatusBadge(escalation.status)}`}>
                      {escalation.status}
                    </span>
                  </td>
                  <td className={`px-4 py-3 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    {formatDate(escalation.created_at)}
                  </td>
                  <td className={`px-4 py-3 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    {escalation.chat_title || 'Untitled'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className={`px-4 py-3 flex items-center justify-between border-t ${
            isDark ? 'border-zinc-800' : 'border-gray-100'
          }`}>
            <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Page {page} of {totalPages} ({escalationsData?.total} total)
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className={`px-3 py-1 text-sm rounded ${
                  page === 1
                    ? 'opacity-50 cursor-not-allowed'
                    : isDark
                      ? 'bg-zinc-800 text-gray-300 hover:bg-zinc-700'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Previous
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className={`px-3 py-1 text-sm rounded ${
                  page === totalPages
                    ? 'opacity-50 cursor-not-allowed'
                    : isDark
                      ? 'bg-zinc-800 text-gray-300 hover:bg-zinc-700'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Escalation viewer slide-over */}
      {selectedEscalation && (
        <EscalationViewer
          escalation={selectedEscalation}
          onClose={() => setSelectedEscalation(null)}
          onResolved={handleResolved}
        />
      )}
    </div>
  )
}
