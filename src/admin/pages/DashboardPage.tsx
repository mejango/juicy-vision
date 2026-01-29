import { useThemeStore } from '../../stores'
import DauChart from '../components/DauChart'
import { useDauData } from '../hooks/useDauData'
import { useAdminChats } from '../hooks/useAdminChats'

export default function DashboardPage() {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const { data: dauData } = useDauData()
  const { data: chatsData } = useAdminChats(1, 1) // Just to get total count

  // Calculate summary stats
  const todayDau = dauData?.[dauData.length - 1]?.dau || 0
  const totalChats = chatsData?.pagination?.total || 0

  return (
    <div className="p-6">
      <h1 className={`text-2xl font-bold mb-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>
        Dashboard
      </h1>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className={`p-4 border ${
          isDark ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-gray-200'
        }`}>
          <div className={`text-sm font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Today's DAU
          </div>
          <div className={`text-3xl font-bold mt-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {todayDau.toLocaleString()}
          </div>
        </div>

        <div className={`p-4 border ${
          isDark ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-gray-200'
        }`}>
          <div className={`text-sm font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Total Chats
          </div>
          <div className={`text-3xl font-bold mt-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {totalChats.toLocaleString()}
          </div>
        </div>

        <div className={`p-4 border ${
          isDark ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-gray-200'
        }`}>
          <div className={`text-sm font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Environment
          </div>
          <div className={`text-3xl font-bold mt-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {window.location.hostname.includes('staging') ? 'Staging' : 'Production'}
          </div>
        </div>
      </div>

      {/* DAU Chart */}
      <div className="mb-6">
        <DauChart />
      </div>
    </div>
  )
}
