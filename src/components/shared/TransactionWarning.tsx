import { useState } from 'react'
import type { TransactionDoubt } from '../../utils/transactionVerification'

export interface TransactionWarningProps {
  doubts: TransactionDoubt[]
  onConfirm: () => void
  onCancel: () => void
  isDark: boolean
}

export default function TransactionWarning({
  doubts,
  onConfirm,
  onCancel,
  isDark,
}: TransactionWarningProps) {
  const [acknowledged, setAcknowledged] = useState(false)

  if (doubts.length === 0) return null

  const criticalDoubts = doubts.filter(d => d.severity === 'critical')
  const warningDoubts = doubts.filter(d => d.severity === 'warning')
  const hasCritical = criticalDoubts.length > 0

  return (
    <div className={`border ${
      hasCritical
        ? isDark ? 'bg-red-500/10 border-red-500/30' : 'bg-red-50 border-red-200'
        : isDark ? 'bg-yellow-500/10 border-yellow-500/30' : 'bg-yellow-50 border-yellow-200'
    }`}>
      {/* Header */}
      <div className={`px-4 py-3 border-b ${
        hasCritical
          ? isDark ? 'border-red-500/20' : 'border-red-200'
          : isDark ? 'border-yellow-500/20' : 'border-yellow-200'
      }`}>
        <div className="flex items-center gap-2">
          <span className="text-lg">
            {hasCritical ? '!' : '!'}
          </span>
          <h3 className={`font-semibold ${
            hasCritical
              ? isDark ? 'text-red-400' : 'text-red-700'
              : isDark ? 'text-yellow-400' : 'text-yellow-700'
          }`}>
            {hasCritical ? 'Review Required' : 'Please Review'}
          </h3>
        </div>
        <p className={`text-sm mt-1 ${
          hasCritical
            ? isDark ? 'text-red-400/70' : 'text-red-600'
            : isDark ? 'text-yellow-400/70' : 'text-yellow-600'
        }`}>
          {hasCritical
            ? 'The following issues require your attention before proceeding.'
            : 'The following items may need your review.'}
        </p>
      </div>

      {/* Doubts list */}
      <div className="px-4 py-3 space-y-3">
        {/* Critical doubts first */}
        {criticalDoubts.map((doubt, index) => (
          <div key={`critical-${index}`} className="flex gap-3">
            <span className={`shrink-0 px-1.5 py-0.5 text-xs font-medium ${
              isDark ? 'bg-red-500/20 text-red-400' : 'bg-red-100 text-red-700'
            }`}>
              Critical
            </span>
            <div className="flex-1 min-w-0">
              <p className={isDark ? 'text-white' : 'text-gray-900'}>
                {doubt.message}
              </p>
              {doubt.technicalNote && (
                <p className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
                  Technical: {doubt.technicalNote}
                </p>
              )}
            </div>
          </div>
        ))}

        {/* Warning doubts */}
        {warningDoubts.map((doubt, index) => (
          <div key={`warning-${index}`} className="flex gap-3">
            <span className={`shrink-0 px-1.5 py-0.5 text-xs font-medium ${
              isDark ? 'bg-yellow-500/20 text-yellow-400' : 'bg-yellow-100 text-yellow-700'
            }`}>
              Warning
            </span>
            <div className="flex-1 min-w-0">
              <p className={isDark ? 'text-white' : 'text-gray-900'}>
                {doubt.message}
              </p>
              {doubt.technicalNote && (
                <p className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
                  Technical: {doubt.technicalNote}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Acknowledgment checkbox */}
      <div className={`px-4 py-3 border-t ${
        hasCritical
          ? isDark ? 'border-red-500/20' : 'border-red-200'
          : isDark ? 'border-yellow-500/20' : 'border-yellow-200'
      }`}>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className={`mt-0.5 w-4 h-4 rounded border-2 ${
              hasCritical
                ? 'border-red-400 text-red-500 focus:ring-red-500'
                : 'border-yellow-400 text-yellow-500 focus:ring-yellow-500'
            }`}
          />
          <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            {hasCritical
              ? 'I understand the risks and want to proceed anyway'
              : 'I have reviewed the warnings and want to proceed'}
          </span>
        </label>
      </div>

      {/* Actions */}
      <div className={`px-4 py-3 flex gap-3 border-t ${
        hasCritical
          ? isDark ? 'border-red-500/20' : 'border-red-200'
          : isDark ? 'border-yellow-500/20' : 'border-yellow-200'
      }`}>
        <button
          onClick={onCancel}
          className={`flex-1 py-2 px-4 font-medium border transition-colors ${
            isDark
              ? 'border-white/20 text-white hover:bg-white/10'
              : 'border-gray-200 text-gray-700 hover:bg-gray-50'
          }`}
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={!acknowledged}
          className={`flex-1 py-2 px-4 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            hasCritical
              ? 'bg-red-500 text-white hover:bg-red-600 disabled:hover:bg-red-500'
              : isDark
                ? 'bg-yellow-500 text-black hover:bg-yellow-400 disabled:hover:bg-yellow-500'
                : 'bg-yellow-500 text-black hover:bg-yellow-600 disabled:hover:bg-yellow-500'
          }`}
        >
          Proceed Anyway
        </button>
      </div>
    </div>
  )
}
