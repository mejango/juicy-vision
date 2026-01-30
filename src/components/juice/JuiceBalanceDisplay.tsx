/**
 * Juice Balance Display Component
 *
 * Shows the user's Juice balance with a "Buy More" button
 */

import { useState } from 'react'
import { useThemeStore } from '../../stores'
import { useJuiceBalance } from '../../hooks/useJuiceBalance'
import BuyJuiceModal from './BuyJuiceModal'

interface JuiceBalanceDisplayProps {
  compact?: boolean
}

export default function JuiceBalanceDisplay({ compact = false }: JuiceBalanceDisplayProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { balance, loading, refetch, hasBalance } = useJuiceBalance()
  const [showBuyModal, setShowBuyModal] = useState(false)

  if (loading) {
    return (
      <div className={`animate-pulse ${compact ? 'h-6 w-20' : 'h-10 w-32'} rounded ${
        isDark ? 'bg-gray-700' : 'bg-gray-200'
      }`} />
    )
  }

  const handlePurchaseSuccess = () => {
    refetch()
  }

  if (compact) {
    return (
      <>
        <button
          onClick={() => setShowBuyModal(true)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors ${
            isDark
              ? 'bg-juice-orange/10 hover:bg-juice-orange/20 text-juice-orange'
              : 'bg-orange-50 hover:bg-orange-100 text-orange-600'
          }`}
        >
          <span className="text-lg">🧃</span>
          <span className="font-medium">
            {balance?.balance?.toLocaleString() ?? 0}
          </span>
          <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            +
          </span>
        </button>

        <BuyJuiceModal
          isOpen={showBuyModal}
          onClose={() => setShowBuyModal(false)}
          onSuccess={handlePurchaseSuccess}
        />
      </>
    )
  }

  return (
    <>
      <div className={`p-4 rounded-xl ${isDark ? 'bg-gray-800' : 'bg-gray-50'}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">💳</span>
            <span className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Pay Credits
            </span>
          </div>
          <button
            onClick={() => setShowBuyModal(true)}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-juice-orange text-white hover:bg-juice-orange/90 transition-colors"
          >
            Buy More
          </button>
        </div>

        <div className="flex items-baseline gap-1">
          <span className={`text-3xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {balance?.balance?.toLocaleString() ?? 0}
          </span>
          <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            credits
          </span>
        </div>

        {hasBalance && balance && (
          <div className={`mt-3 pt-3 border-t space-y-1 ${
            isDark ? 'border-gray-700' : 'border-gray-200'
          }`}>
            <div className="flex justify-between text-sm">
              <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>
                Lifetime purchased
              </span>
              <span className={isDark ? 'text-gray-300' : 'text-gray-700'}>
                ${balance.lifetimePurchased.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>
                Total spent
              </span>
              <span className={isDark ? 'text-gray-300' : 'text-gray-700'}>
                ${balance.lifetimeSpent.toLocaleString()}
              </span>
            </div>
          </div>
        )}

        {!hasBalance && (
          <p className={`mt-2 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Buy Juice to pay projects with your credit card
          </p>
        )}
      </div>

      <BuyJuiceModal
        isOpen={showBuyModal}
        onClose={() => setShowBuyModal(false)}
        onSuccess={handlePurchaseSuccess}
      />
    </>
  )
}
