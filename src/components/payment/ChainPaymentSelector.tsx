import { useState, useCallback, useMemo } from 'react'
import { formatEther } from 'viem'
import { useThemeStore } from '../../stores'
import { useWalletBalances } from '../../hooks'
import { CHAINS } from '../../constants'
import type { PaymentOption } from '../../services/relayr'

interface ChainPaymentSelectorProps {
  paymentOptions: PaymentOption[]
  selectedChainId: number | null
  onSelect: (chainId: number) => void
  disabled?: boolean
}

interface ChainBalance {
  chainId: number
  balance: bigint
}

/**
 * Dropdown for selecting which chain to pay gas from.
 * Shows cost per chain and user's balance, highlights cheapest option.
 *
 * @example
 * <ChainPaymentSelector
 *   paymentOptions={bundleState.paymentOptions}
 *   selectedChainId={bundleState.selectedPaymentChain}
 *   onSelect={setPaymentChain}
 * />
 */
export default function ChainPaymentSelector({
  paymentOptions,
  selectedChainId,
  onSelect,
  disabled = false,
}: ChainPaymentSelectorProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const [isOpen, setIsOpen] = useState(false)

  // Get user's ETH balance per chain
  const { perChain } = useWalletBalances()

  // Find the chain balance for a given chain ID
  const getChainBalance = useCallback((chainId: number): bigint => {
    const chainBalance = perChain.find(b => b.chainId === chainId)
    return chainBalance ? chainBalance.eth : 0n
  }, [perChain])

  // Sort options: cheapest first, then by whether user has enough balance
  const sortedOptions = useMemo(() => {
    return [...paymentOptions].sort((a, b) => {
      const aAmount = BigInt(a.amount)
      const bAmount = BigInt(b.amount)
      const aBalance = getChainBalance(a.chainId)
      const bBalance = getChainBalance(b.chainId)

      // First, prioritize options where user has enough balance
      const aHasEnough = aBalance >= aAmount
      const bHasEnough = bBalance >= bAmount

      if (aHasEnough && !bHasEnough) return -1
      if (!aHasEnough && bHasEnough) return 1

      // Then sort by amount (cheapest first)
      return aAmount < bAmount ? -1 : aAmount > bAmount ? 1 : 0
    })
  }, [paymentOptions, getChainBalance])

  const cheapestOption = sortedOptions[0]
  const selectedOption = paymentOptions.find(o => o.chainId === selectedChainId)

  const formatAmount = (amount: string) => {
    const eth = formatEther(BigInt(amount))
    const num = parseFloat(eth)
    if (num < 0.0001) return '<0.0001 ETH'
    return `${num.toFixed(4)} ETH`
  }

  const formatBalance = (balance: bigint) => {
    const eth = formatEther(balance)
    const num = parseFloat(eth)
    if (num < 0.0001) return '<0.0001'
    return num.toFixed(4)
  }

  const handleSelect = (chainId: number) => {
    onSelect(chainId)
    setIsOpen(false)
  }

  if (paymentOptions.length === 0) {
    return null
  }

  return (
    <div className="relative">
      {/* Label */}
      <div className={`text-xs uppercase tracking-wide mb-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
        Pay Gas From
      </div>

      {/* Selected option button */}
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`w-full p-3 flex items-center justify-between transition-colors ${
          isDark
            ? 'bg-white/5 border border-white/10 hover:bg-white/10'
            : 'bg-gray-50 border border-gray-200 hover:bg-gray-100'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        {selectedOption ? (
          <div className="flex items-center gap-3">
            <span
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: CHAINS[selectedOption.chainId]?.color || '#888' }}
            />
            <div className="text-left">
              <div className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {CHAINS[selectedOption.chainId]?.name || `Chain ${selectedOption.chainId}`}
              </div>
              <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {formatAmount(selectedOption.amount)}
                {selectedOption.chainId === cheapestOption?.chainId && (
                  <span className="ml-2 text-green-500">Cheapest</span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Select payment chain</span>
        )}
        <svg
          className={`w-5 h-5 transition-transform ${isOpen ? 'rotate-180' : ''} ${isDark ? 'text-gray-400' : 'text-gray-500'}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />

          {/* Options */}
          <div className={`absolute z-20 w-full mt-1 py-1 border shadow-lg ${
            isDark ? 'bg-juice-dark border-white/10' : 'bg-white border-gray-200'
          }`}>
            {sortedOptions.map((option, idx) => {
              const chainInfo = CHAINS[option.chainId]
              const balance = getChainBalance(option.chainId)
              const hasEnough = balance >= BigInt(option.amount)
              const isSelected = option.chainId === selectedChainId
              const isCheapest = idx === 0

              return (
                <button
                  key={option.chainId}
                  onClick={() => handleSelect(option.chainId)}
                  className={`w-full p-3 flex items-center justify-between transition-colors ${
                    isSelected
                      ? isDark ? 'bg-purple-500/20' : 'bg-purple-50'
                      : isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: chainInfo?.color || '#888' }}
                    />
                    <div className="text-left">
                      <div className="flex items-center gap-2">
                        <span className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                          {chainInfo?.name || `Chain ${option.chainId}`}
                        </span>
                        {isCheapest && (
                          <span className={`text-xs px-1.5 py-0.5 ${
                            isDark ? 'bg-green-500/20 text-green-400' : 'bg-green-100 text-green-700'
                          }`}>
                            Cheapest
                          </span>
                        )}
                      </div>
                      <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        Cost: {formatAmount(option.amount)}
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className={`text-sm font-mono ${
                      hasEnough
                        ? isDark ? 'text-gray-300' : 'text-gray-600'
                        : 'text-red-400'
                    }`}>
                      {formatBalance(balance)} ETH
                    </div>
                    {!hasEnough && (
                      <div className="text-xs text-red-400">
                        Insufficient
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
