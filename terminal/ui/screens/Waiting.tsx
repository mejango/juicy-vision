/**
 * Waiting Screen
 *
 * Shows QR code and "Tap to Pay" animation while waiting for payment.
 */

import { useState, useEffect } from 'react'
import QRCode from '../components/QRCode'

interface PaymentSession {
  id: string
  amountUsd: number
  status: string
  paymentUrl: string
}

interface WaitingScreenProps {
  session: PaymentSession
  onCancel: () => void
}

export default function WaitingScreen({ session, onCancel }: WaitingScreenProps) {
  const [timeLeft, setTimeLeft] = useState(600) // 10 minutes

  // Countdown timer
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="h-full flex flex-col items-center justify-center p-8">
      {/* Amount */}
      <div className="text-center mb-8">
        <p className="text-gray-400 text-sm mb-1">Amount Due</p>
        <p className="text-4xl font-bold text-white">
          ${session.amountUsd.toFixed(2)}
        </p>
      </div>

      {/* QR Code */}
      <div className="mb-8">
        <QRCode value={session.paymentUrl} size={200} />
      </div>

      {/* Instructions */}
      <div className="text-center mb-8">
        <p className="text-lg text-white mb-2">Scan to Pay</p>
        <p className="text-sm text-gray-400">
          Or tap phone to NFC reader
        </p>
      </div>

      {/* Timer */}
      <div className={`text-sm mb-8 ${timeLeft < 60 ? 'text-red-400' : 'text-gray-500'}`}>
        Expires in {formatTime(timeLeft)}
      </div>

      {/* NFC animation indicator */}
      <div className="flex items-center gap-3 mb-8">
        <div className="relative">
          <div className="w-3 h-3 bg-juice-cyan rounded-full animate-ping absolute" />
          <div className="w-3 h-3 bg-juice-cyan rounded-full relative" />
        </div>
        <span className="text-sm text-gray-400">Waiting for payment...</span>
      </div>

      {/* Cancel button */}
      <button
        onClick={onCancel}
        className="px-6 py-2 text-sm text-gray-400 hover:text-white border border-white/10 hover:border-white/20 transition-colors"
      >
        Cancel
      </button>
    </div>
  )
}
