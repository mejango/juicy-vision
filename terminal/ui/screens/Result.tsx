/**
 * Result Screen
 *
 * Shows payment success or failure.
 */

import { useEffect } from 'react'

interface PaymentSession {
  id: string
  amountUsd: number
  status: 'pending' | 'paying' | 'completed' | 'failed' | 'expired'
}

interface ResultScreenProps {
  session: PaymentSession
  onNewPayment: () => void
}

export default function ResultScreen({ session, onNewPayment }: ResultScreenProps) {
  const isSuccess = session.status === 'completed'
  const isFailed = session.status === 'failed'
  const isExpired = session.status === 'expired'

  // Auto-return to amount screen after 5 seconds for success
  useEffect(() => {
    if (isSuccess) {
      const timeout = setTimeout(onNewPayment, 5000)
      return () => clearTimeout(timeout)
    }
  }, [isSuccess, onNewPayment])

  return (
    <div className="h-full flex flex-col items-center justify-center p-8">
      {/* Success */}
      {isSuccess && (
        <>
          <div className="w-24 h-24 bg-green-500 flex items-center justify-center mb-6 success-animation">
            <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Payment Complete</h1>
          <p className="text-4xl font-bold text-green-400 mb-6">
            ${session.amountUsd.toFixed(2)}
          </p>
          <p className="text-gray-400 text-sm mb-8">Thank you!</p>
          <button
            onClick={onNewPayment}
            className="px-8 py-3 bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            New Payment
          </button>
        </>
      )}

      {/* Failed */}
      {isFailed && (
        <>
          <div className="w-24 h-24 bg-red-500 flex items-center justify-center mb-6">
            <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Payment Failed</h1>
          <p className="text-gray-400 text-sm mb-8">Please try again</p>
          <button
            onClick={onNewPayment}
            className="px-8 py-3 bg-juice-cyan text-juice-dark font-semibold hover:bg-juice-cyan/90 transition-colors"
          >
            Try Again
          </button>
        </>
      )}

      {/* Expired */}
      {isExpired && (
        <>
          <div className="w-24 h-24 bg-gray-600 flex items-center justify-center mb-6">
            <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Session Expired</h1>
          <p className="text-gray-400 text-sm mb-8">The payment window has closed</p>
          <button
            onClick={onNewPayment}
            className="px-8 py-3 bg-juice-cyan text-juice-dark font-semibold hover:bg-juice-cyan/90 transition-colors"
          >
            Start Over
          </button>
        </>
      )}
    </div>
  )
}
