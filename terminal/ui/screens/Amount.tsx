/**
 * Amount Entry Screen
 *
 * Keypad interface for entering payment amount.
 * Optimized for touch screen on Raspberry Pi.
 */

import { useState, useCallback } from 'react'
import Keypad from '../components/Keypad'

interface AmountScreenProps {
  onSubmit: (amount: number) => void
  onSettings: () => void
  error: string | null
  onClearError: () => void
}

export default function AmountScreen({ onSubmit, onSettings, error, onClearError }: AmountScreenProps) {
  const [amount, setAmount] = useState('0')

  const handleKeyPress = useCallback((key: string) => {
    onClearError()

    if (key === 'C') {
      setAmount('0')
      return
    }

    if (key === '⌫') {
      setAmount(prev => {
        if (prev.length <= 1) return '0'
        return prev.slice(0, -1)
      })
      return
    }

    if (key === '.') {
      if (amount.includes('.')) return
      setAmount(prev => prev + '.')
      return
    }

    // Max 2 decimal places
    if (amount.includes('.')) {
      const decimals = amount.split('.')[1]
      if (decimals && decimals.length >= 2) return
    }

    // Max amount $9999.99
    const newAmount = amount === '0' ? key : amount + key
    if (parseFloat(newAmount) > 9999.99) return

    setAmount(newAmount)
  }, [amount, onClearError])

  const handleSubmit = () => {
    const numAmount = parseFloat(amount)
    if (numAmount <= 0) {
      return
    }
    onSubmit(numAmount)
  }

  const formattedAmount = parseFloat(amount || '0').toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })

  return (
    <div className="h-full flex flex-col">
      {/* Amount Display */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 py-4">
        <p className="text-gray-500 text-sm mb-2">Enter Amount</p>
        <div className="amount-display flex items-baseline">
          <span className="text-3xl mr-2">$</span>
          <span>{formattedAmount}</span>
        </div>

        {/* Error message */}
        {error && (
          <div className="mt-4 px-4 py-2 bg-red-500/20 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}
      </div>

      {/* Keypad */}
      <div className="px-4 pb-4">
        <Keypad onKeyPress={handleKeyPress} />
      </div>

      {/* Action buttons */}
      <div className="px-4 pb-4 flex gap-3">
        <button
          onClick={onSettings}
          className="px-4 py-3 bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
        <button
          onClick={handleSubmit}
          disabled={parseFloat(amount) <= 0}
          className={`flex-1 py-3 font-semibold text-lg transition-colors ${
            parseFloat(amount) > 0
              ? 'bg-juice-cyan text-juice-dark hover:bg-juice-cyan/90'
              : 'bg-white/10 text-gray-500 cursor-not-allowed'
          }`}
        >
          Charge ${formattedAmount}
        </button>
      </div>
    </div>
  )
}
