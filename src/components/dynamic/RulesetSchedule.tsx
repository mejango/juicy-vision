import { useState, useEffect } from 'react'
import { useThemeStore } from '../../stores'

interface RulesetScheduleProps {
  projectId: string
  chainId?: string
}

interface Ruleset {
  id: number
  name: string
  start: number
  duration: number
  weight: string
  decayPercent: number
  reservedPercent: number
  cashOutTaxRate: number
  isActive: boolean
}

function formatDate(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatPercent(bps: number, divisor = 10000) {
  return `${(bps / divisor * 100).toFixed(1)}%`
}

export default function RulesetSchedule({
  projectId,
  chainId = '1',
}: RulesetScheduleProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [rulesets, setRulesets] = useState<Ruleset[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Simulate loading rulesets - replace with real data
    setLoading(true)
    const timeout = setTimeout(() => {
      const now = Math.floor(Date.now() / 1000)
      const mockRulesets: Ruleset[] = [
        {
          id: 1,
          name: 'Launch',
          start: now - 86400 * 30,
          duration: 86400 * 30,
          weight: '1,000,000',
          decayPercent: 0,
          reservedPercent: 2000,
          cashOutTaxRate: 0,
          isActive: true,
        },
        {
          id: 2,
          name: 'Growth',
          start: now,
          duration: 86400 * 90,
          weight: '800,000',
          decayPercent: 50000000,
          reservedPercent: 3000,
          cashOutTaxRate: 1000,
          isActive: false,
        },
        {
          id: 3,
          name: 'Mature',
          start: now + 86400 * 90,
          duration: 0,
          weight: '500,000',
          decayPercent: 20000000,
          reservedPercent: 4000,
          cashOutTaxRate: 2000,
          isActive: false,
        },
      ]
      setRulesets(mockRulesets)
      setLoading(false)
    }, 500)

    return () => clearTimeout(timeout)
  }, [projectId, chainId])

  const now = Math.floor(Date.now() / 1000)

  return (
    <div className={`rounded-lg border overflow-hidden ${
      isDark ? 'bg-juice-dark-lighter border-white/10' : 'bg-white border-gray-200'
    }`}>
      {/* Header */}
      <div className={`px-4 py-3 border-b flex items-center justify-between ${
        isDark ? 'border-white/10' : 'border-gray-100'
      }`}>
        <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
          Ruleset Schedule
        </span>
        <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          Project #{projectId}
        </span>
      </div>

      {loading ? (
        <div className={`px-4 py-8 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          Loading schedule...
        </div>
      ) : (
        <>
          {/* Timeline visualization */}
          <div className="px-4 py-4">
            <div className="relative">
              {/* Timeline bar */}
              <div className={`h-2 rounded-full overflow-hidden flex ${
                isDark ? 'bg-white/10' : 'bg-gray-100'
              }`}>
                {rulesets.map((ruleset) => {
                  const width = ruleset.duration === 0 ? 30 : Math.min(30, Math.max(10, 100 / rulesets.length))
                  return (
                    <div
                      key={ruleset.id}
                      className={`h-full transition-colors ${
                        ruleset.isActive
                          ? 'bg-juice-orange'
                          : ruleset.start < now
                            ? isDark ? 'bg-white/20' : 'bg-gray-300'
                            : isDark ? 'bg-white/10' : 'bg-gray-200'
                      }`}
                      style={{ width: `${width}%` }}
                    />
                  )
                })}
              </div>

              {/* Now marker */}
              <div
                className="absolute top-0 w-0.5 h-4 -mt-1 bg-emerald-400"
                style={{ left: '33%' }}
              />
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 mt-3 text-xs">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-juice-orange" />
                <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Current</span>
              </span>
              <span className="flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${isDark ? 'bg-white/20' : 'bg-gray-300'}`} />
                <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Past</span>
              </span>
              <span className="flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
                <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Upcoming</span>
              </span>
            </div>
          </div>

          {/* Rulesets list */}
          <div className={`border-t divide-y ${
            isDark ? 'border-white/10 divide-white/5' : 'border-gray-100 divide-gray-50'
          }`}>
            {rulesets.map((ruleset) => (
              <div
                key={ruleset.id}
                className={`px-4 py-3 ${ruleset.isActive ? isDark ? 'bg-juice-orange/10' : 'bg-orange-50' : ''}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {ruleset.name}
                    </span>
                    {ruleset.isActive && (
                      <span className="px-1.5 py-0.5 text-xs bg-juice-orange/20 text-juice-orange rounded">
                        Active
                      </span>
                    )}
                  </div>
                  <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    {formatDate(ruleset.start)}
                    {ruleset.duration > 0 && ` - ${formatDate(ruleset.start + ruleset.duration)}`}
                    {ruleset.duration === 0 && ' onwards'}
                  </span>
                </div>
                <div className={`grid grid-cols-4 gap-2 text-xs ${
                  isDark ? 'text-gray-400' : 'text-gray-500'
                }`}>
                  <div>
                    <span className="block text-[10px] uppercase tracking-wider mb-0.5 opacity-60">Weight</span>
                    <span className={isDark ? 'text-gray-300' : 'text-gray-700'}>{ruleset.weight}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase tracking-wider mb-0.5 opacity-60">Decay</span>
                    <span className={isDark ? 'text-gray-300' : 'text-gray-700'}>
                      {formatPercent(ruleset.decayPercent, 1000000000)}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase tracking-wider mb-0.5 opacity-60">Reserved</span>
                    <span className={isDark ? 'text-gray-300' : 'text-gray-700'}>
                      {formatPercent(ruleset.reservedPercent)}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase tracking-wider mb-0.5 opacity-60">Cash Out Tax</span>
                    <span className={isDark ? 'text-gray-300' : 'text-gray-700'}>
                      {formatPercent(ruleset.cashOutTaxRate)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
