import { useState } from 'react'
import { useThemeStore } from '../../stores'
import DauChart from '../components/DauChart'
import { useAdminMetrics } from '../hooks/useDauData'

function MetricCard({
  label,
  value,
  sublabel,
  isDark,
  highlight,
}: {
  label: string
  value: string | number
  sublabel?: string
  isDark: boolean
  highlight?: boolean
}) {
  return (
    <div className={`p-4 border ${
      isDark ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-gray-200'
    }`}>
      <div className={`text-xs font-medium uppercase tracking-wide ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
        {label}
      </div>
      <div className={`text-2xl font-bold mt-1 ${
        highlight
          ? 'text-juice-orange'
          : isDark ? 'text-white' : 'text-gray-900'
      }`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {sublabel && (
        <div className={`text-xs mt-0.5 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          {sublabel}
        </div>
      )}
    </div>
  )
}

export default function DashboardPage() {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const [includeAnonymous, setIncludeAnonymous] = useState(false)

  const { data: metrics, isLoading } = useAdminMetrics()

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
          Dashboard
        </h1>
        <div className={`text-xs px-2 py-1 rounded ${
          window.location.hostname.includes('staging')
            ? 'bg-amber-500/20 text-amber-400'
            : 'bg-green-500/20 text-green-400'
        }`}>
          {window.location.hostname.includes('staging') ? 'Staging' : 'Production'}
        </div>
      </div>

      {/* Today's metrics */}
      <div className="mb-6">
        <h2 className={`text-sm font-semibold mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          Today
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            label="Messages"
            value={metrics?.today.messages || 0}
            isDark={isDark}
            highlight
          />
          <MetricCard
            label="AI Responses"
            value={metrics?.today.aiResponses || 0}
            isDark={isDark}
          />
          <MetricCard
            label="Chats Created"
            value={metrics?.today.chatsCreated || 0}
            isDark={isDark}
          />
          <MetricCard
            label="Unique Visitors"
            value={metrics?.today.newUsers || 0}
            isDark={isDark}
          />
        </div>
      </div>

      {/* This Week metrics */}
      <div className="mb-6">
        <h2 className={`text-sm font-semibold mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          This Week
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <MetricCard
            label="Chats Created"
            value={metrics?.week.chatsCreated || 0}
            isDark={isDark}
          />
          <MetricCard
            label="Unique Visitors"
            value={metrics?.week.newUsers || 0}
            isDark={isDark}
          />
          <MetricCard
            label="Returning Users"
            value={metrics?.week.returningUsers || 0}
            sublabel="2+ days active"
            isDark={isDark}
            highlight
          />
        </div>
      </div>

      {/* Engagement metrics */}
      <div className="mb-6">
        <h2 className={`text-sm font-semibold mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          Engagement
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <MetricCard
            label="Avg Messages/Chat"
            value={metrics?.engagement.avgMessagesPerChat?.toFixed(1) || '0'}
            sublabel="last 7 days"
            isDark={isDark}
          />
          <MetricCard
            label="Active Chats"
            value={metrics?.engagement.activeChats24h || 0}
            sublabel="last 24h"
            isDark={isDark}
          />
          <MetricCard
            label="Passkey Signup Rate"
            value={`${metrics?.engagement.passkeyConversionRate || 0}%`}
            sublabel="last 30 days"
            isDark={isDark}
            highlight
          />
        </div>
      </div>

      {/* DAU Chart */}
      <div className="mb-6">
        <DauChart
          includeAnonymous={includeAnonymous}
          onToggleAnonymous={setIncludeAnonymous}
        />
      </div>
    </div>
  )
}
