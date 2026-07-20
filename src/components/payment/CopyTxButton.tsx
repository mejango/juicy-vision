import { useEffect, useRef, useState } from 'react'
import { buildTxLinkUrl, type TxLinkEntry } from '../../utils/txlink'
import { copyToClipboard } from '../../utils/clipboard'

interface CopyTxButtonProps {
  getEntries: () => TxLinkEntry[] | Promise<TxLinkEntry[]>
  isDark: boolean
  disabled?: boolean
  disabledReason?: string
}

export default function CopyTxButton({ getEntries, isDark, disabled, disabledReason }: CopyTxButtonProps) {
  const [label, setLabel] = useState('Copy tx')
  const [busy, setBusy] = useState(false)
  const resetTimer = useRef<number | null>(null)

  useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
  }, [])

  const showFeedback = (next: string) => {
    setLabel(next)
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
    resetTimer.current = window.setTimeout(() => setLabel('Copy tx'), 2000)
  }

  const handleCopy = async () => {
    if (busy) return
    setBusy(true)
    try {
      const entries = await getEntries()
      if (entries.length === 0) {
        showFeedback('Link unavailable')
        return
      }
      const copied = await copyToClipboard(entries.map(buildTxLinkUrl).join('\n'))
      if (!copied) {
        showFeedback('Copy failed')
        return
      }
      showFeedback(entries.length === 1 ? 'Copied tx link' : `Copied ${entries.length} tx links`)
    } catch {
      showFeedback('Copy failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={disabled || busy}
      title={disabled
        ? disabledReason
        : 'Copy a shareable link that lets someone else send this exact transaction'}
      className={`border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50 ${
        isDark ? 'border-white/20 text-gray-300 hover:bg-white/10' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  )
}
