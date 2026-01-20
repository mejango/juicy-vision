import { useState, useMemo } from 'react'
import { useThemeStore } from '../../stores'

interface SuccessVisualizationProps {
  targetRaise?: string // e.g., "$50000" or "50000"
  supporterCount?: string // target number of supporters
  timeframe?: string // months
  growthRate?: string // monthly growth percentage
  avgContribution?: string // average contribution amount
}

interface Milestone {
  month: number
  raised: number
  supporters: number
  label?: string
}

export default function SuccessVisualization({
  targetRaise = '50000',
  supporterCount = '500',
  timeframe = '12',
  growthRate = '15',
  avgContribution = '100',
}: SuccessVisualizationProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [selectedScenario, setSelectedScenario] = useState<'conservative' | 'moderate' | 'optimistic'>('moderate')

  // Parse inputs
  const target = parseFloat(targetRaise.replace(/[$,]/g, '')) || 50000
  const targetSupporters = parseInt(supporterCount) || 500
  const months = parseInt(timeframe) || 12
  const monthlyGrowth = parseFloat(growthRate) / 100 || 0.15
  const avgAmount = parseFloat(avgContribution.replace(/[$,]/g, '')) || 100

  // Growth multipliers for different scenarios
  const scenarios = {
    conservative: 0.6,
    moderate: 1.0,
    optimistic: 1.5,
  }

  // Calculate projections
  const projections = useMemo(() => {
    const multiplier = scenarios[selectedScenario]
    const effectiveGrowth = monthlyGrowth * multiplier

    const data: Milestone[] = []
    let currentSupporters = Math.ceil(targetSupporters * 0.05) // Start with 5% of target
    let totalRaised = currentSupporters * avgAmount

    // Month 0 - starting point
    data.push({
      month: 0,
      raised: totalRaised,
      supporters: currentSupporters,
      label: 'Launch',
    })

    // Generate monthly data
    for (let i = 1; i <= months; i++) {
      // Compound growth with some randomization for realism
      const growthFactor = 1 + effectiveGrowth + (Math.random() - 0.5) * 0.05
      const newSupporters = Math.ceil(currentSupporters * growthFactor * 0.15)

      currentSupporters += newSupporters
      totalRaised += newSupporters * avgAmount * (0.8 + Math.random() * 0.4)

      const milestone: Milestone = {
        month: i,
        raised: Math.round(totalRaised),
        supporters: currentSupporters,
      }

      // Add milestone labels
      if (totalRaised >= target * 0.25 && data.every(d => !d.label?.includes('25%'))) {
        milestone.label = '25% Goal'
      } else if (totalRaised >= target * 0.5 && data.every(d => !d.label?.includes('50%'))) {
        milestone.label = '50% Goal'
      } else if (totalRaised >= target * 0.75 && data.every(d => !d.label?.includes('75%'))) {
        milestone.label = '75% Goal'
      } else if (totalRaised >= target && data.every(d => !d.label?.includes('Target'))) {
        milestone.label = 'Target Reached'
      }

      data.push(milestone)
    }

    return data
  }, [selectedScenario, monthlyGrowth, months, targetSupporters, avgAmount, target])

  // Get final values
  const finalData = projections[projections.length - 1]
  const maxRaised = Math.max(...projections.map(p => p.raised), target)
  const progressPercent = Math.min((finalData.raised / target) * 100, 150)
  const goalReached = finalData.raised >= target

  // Find milestone points for visualization
  const milestones = projections.filter(p => p.label)

  return (
    <div className="w-full max-w-2xl">
      <div className={`border overflow-hidden ${
        isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
      }`}>
        {/* Header */}
        <div className={`px-4 py-3 border-b ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          <h3 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Growth Projection
          </h3>
          <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Visualize your funding journey over {months} months
          </p>
        </div>

        {/* Scenario selector */}
        <div className={`px-4 py-3 border-b ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          <div className="flex gap-2">
            {(['conservative', 'moderate', 'optimistic'] as const).map((scenario) => (
              <button
                key={scenario}
                onClick={() => setSelectedScenario(scenario)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors capitalize ${
                  selectedScenario === scenario
                    ? scenario === 'conservative'
                      ? 'bg-blue-500 text-white'
                      : scenario === 'moderate'
                      ? 'bg-green-500 text-white'
                      : 'bg-orange-500 text-white'
                    : isDark
                    ? 'bg-white/5 text-gray-400 hover:bg-white/10'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {scenario}
              </button>
            ))}
          </div>
        </div>

        {/* Main stats */}
        <div className="px-4 py-4">
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="text-center">
              <div className={`text-2xl font-bold ${
                goalReached ? 'text-green-400' : isDark ? 'text-white' : 'text-gray-900'
              }`}>
                ${(finalData.raised / 1000).toFixed(1)}k
              </div>
              <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Projected Raised
              </div>
            </div>
            <div className="text-center">
              <div className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {finalData.supporters.toLocaleString()}
              </div>
              <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Supporters
              </div>
            </div>
            <div className="text-center">
              <div className={`text-2xl font-bold ${
                goalReached ? 'text-green-400' : isDark ? 'text-white' : 'text-gray-900'
              }`}>
                {progressPercent.toFixed(0)}%
              </div>
              <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                of ${(target / 1000).toFixed(0)}k Goal
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mb-6">
            <div className={`h-3 overflow-hidden ${isDark ? 'bg-white/10' : 'bg-gray-200'}`}>
              <div
                className={`h-full transition-all duration-500 ${
                  goalReached ? 'bg-green-500' : 'bg-juice-orange'
                }`}
                style={{ width: `${Math.min(progressPercent, 100)}%` }}
              />
            </div>
            <div className="flex justify-between mt-1 text-xs">
              <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>$0</span>
              <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>
                ${(target / 1000).toFixed(0)}k goal
              </span>
            </div>
          </div>

          {/* Simple chart visualization */}
          <div className={`p-4 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
            <div className="h-40 flex items-end gap-1">
              {projections.map((point, idx) => {
                const height = (point.raised / maxRaised) * 100
                const isGoalMet = point.raised >= target
                return (
                  <div
                    key={idx}
                    className="flex-1 flex flex-col items-center justify-end"
                    title={`Month ${point.month}: $${point.raised.toLocaleString()}`}
                  >
                    <div
                      className={`w-full transition-all ${
                        isGoalMet
                          ? 'bg-green-500'
                          : 'bg-juice-orange'
                      } ${point.label ? 'opacity-100' : 'opacity-70'}`}
                      style={{ height: `${Math.max(height, 2)}%` }}
                    />
                    {point.label && (
                      <div className={`absolute mt-2 text-[10px] whitespace-nowrap ${
                        isDark ? 'text-gray-400' : 'text-gray-500'
                      }`}>
                        •
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="flex justify-between mt-2 text-xs">
              <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Month 0</span>
              <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Month {months}</span>
            </div>
          </div>

          {/* Milestones */}
          {milestones.length > 0 && (
            <div className="mt-4">
              <h4 className={`text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                Key Milestones
              </h4>
              <div className="space-y-2">
                {milestones.map((milestone, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center gap-3 text-sm ${
                      isDark ? 'text-gray-400' : 'text-gray-500'
                    }`}
                  >
                    <span className={`w-2 h-2 ${
                      milestone.label?.includes('Target')
                        ? 'bg-green-500'
                        : 'bg-juice-orange'
                    }`} />
                    <span className="font-medium">{milestone.label}</span>
                    <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>
                      Month {milestone.month}
                    </span>
                    <span className="ml-auto font-mono">
                      ${milestone.raised.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Motivational footer */}
        <div className={`px-4 py-3 border-t ${isDark ? 'border-white/10 bg-white/5' : 'border-gray-100 bg-gray-50'}`}>
          <p className={`text-sm text-center ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {goalReached ? (
              <>With {selectedScenario} growth, you could reach your ${(target / 1000).toFixed(0)}k goal by month {
                projections.findIndex(p => p.raised >= target)
              }!</>
            ) : (
              <>Building momentum takes time. Stay consistent and engage your community!</>
            )}
          </p>
        </div>
      </div>
    </div>
  )
}
