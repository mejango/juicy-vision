import { useState, useRef, useEffect } from 'react'
import { useThemeStore } from '../../stores'
import type { ResolvedNFTTier } from '../../services/nft'

interface TierEditPopoutProps {
  tier: ResolvedNFTTier
  isOpen: boolean
  onClose: () => void
  onSave: (updates: TierUpdates) => void
  anchorRef: React.RefObject<HTMLElement>
  canEditMetadata?: boolean
}

export interface TierUpdates {
  name?: string
  description?: string
  discount?: number
}

export default function TierEditPopout({
  tier,
  isOpen,
  onClose,
  onSave,
  anchorRef,
  canEditMetadata = true,
}: TierEditPopoutProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const popoutRef = useRef<HTMLDivElement>(null)

  // Form state
  const [name, setName] = useState(tier.name || '')
  const [description, setDescription] = useState(tier.description || '')
  const [discount, setDiscount] = useState(tier.discountPercent?.toString() || '0')
  const [discountError, setDiscountError] = useState<string | null>(null)

  // Reset form when tier changes or popout opens
  useEffect(() => {
    if (isOpen) {
      setName(tier.name || '')
      setDescription(tier.description || '')
      setDiscount(tier.discountPercent?.toString() || '0')
      setDiscountError(null)
    }
  }, [isOpen, tier])

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (
        popoutRef.current &&
        !popoutRef.current.contains(event.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(event.target as Node)
      ) {
        onClose()
      }
    }

    // Close on escape
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, onClose, anchorRef])

  // Validate discount
  const validateDiscount = (value: string): boolean => {
    const num = parseFloat(value)
    if (isNaN(num)) {
      setDiscountError('Must be a number')
      return false
    }
    if (num < 0) {
      setDiscountError('Cannot be negative')
      return false
    }
    if (num > 100) {
      setDiscountError('Cannot exceed 100%')
      return false
    }
    setDiscountError(null)
    return true
  }

  const handleDiscountChange = (value: string) => {
    setDiscount(value)
    if (value) {
      validateDiscount(value)
    } else {
      setDiscountError(null)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    // Validate
    if (discount && !validateDiscount(discount)) {
      return
    }

    const updates: TierUpdates = {}

    if (canEditMetadata && name !== tier.name) {
      updates.name = name
    }
    if (canEditMetadata && description !== tier.description) {
      updates.description = description
    }

    const discountNum = parseFloat(discount) || 0
    if (discountNum !== (tier.discountPercent ?? 0)) {
      updates.discount = discountNum
    }

    if (Object.keys(updates).length > 0) {
      onSave(updates)
    }
    onClose()
  }

  if (!isOpen) return null

  // Position the popout
  const anchorRect = anchorRef.current?.getBoundingClientRect()
  const style: React.CSSProperties = anchorRect
    ? {
        position: 'fixed',
        top: anchorRect.bottom + 8,
        left: Math.min(anchorRect.left, window.innerWidth - 300),
        zIndex: 100,
      }
    : {}

  return (
    <div
      ref={popoutRef}
      role="dialog"
      data-testid="tier-form"
      style={style}
      className={`w-72 p-4 shadow-xl border ${
        isDark
          ? 'bg-juice-dark border-white/20'
          : 'bg-white border-gray-200'
      }`}
    >
      <form onSubmit={handleSubmit}>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Edit Tier
          </h3>
          <button
            type="button"
            onClick={onClose}
            className={`p-1 transition-colors ${
              isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Name field */}
        <div className="mb-3">
          <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Name
          </label>
          <input
            type="text"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canEditMetadata}
            placeholder="Tier name"
            className={`w-full px-3 py-2 text-sm outline-none border ${
              !canEditMetadata
                ? isDark ? 'bg-white/5 border-white/5 text-gray-500 cursor-not-allowed' : 'bg-gray-50 border-gray-100 text-gray-400 cursor-not-allowed'
                : isDark
                  ? 'bg-juice-dark border-white/10 text-white placeholder-gray-500 focus:border-juice-orange'
                  : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400 focus:border-juice-orange'
            }`}
          />
          {!canEditMetadata && (
            <p className={`text-[10px] mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              Managed by on-chain resolver
            </p>
          )}
        </div>

        {/* Description field */}
        <div className="mb-3">
          <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Description
          </label>
          <textarea
            name="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!canEditMetadata}
            placeholder="Tier description"
            rows={2}
            className={`w-full px-3 py-2 text-sm outline-none border resize-none ${
              !canEditMetadata
                ? isDark ? 'bg-white/5 border-white/5 text-gray-500 cursor-not-allowed' : 'bg-gray-50 border-gray-100 text-gray-400 cursor-not-allowed'
                : isDark
                  ? 'bg-juice-dark border-white/10 text-white placeholder-gray-500 focus:border-juice-orange'
                  : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400 focus:border-juice-orange'
            }`}
          />
        </div>

        {/* Discount field */}
        <div className="mb-4">
          <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Discount %
          </label>
          <input
            type="number"
            name="discount"
            value={discount}
            onChange={(e) => handleDiscountChange(e.target.value)}
            min="0"
            max="100"
            step="1"
            placeholder="0"
            className={`w-full px-3 py-2 text-sm outline-none border ${
              discountError
                ? 'border-red-500 focus:border-red-500'
                : isDark
                  ? 'bg-juice-dark border-white/10 text-white placeholder-gray-500 focus:border-juice-orange'
                  : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400 focus:border-juice-orange'
            }`}
          />
          {discountError && (
            <p className="text-[10px] mt-1 text-red-400">{discountError}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className={`flex-1 px-3 py-2 text-sm font-medium border transition-colors ${
              isDark
                ? 'border-white/20 text-gray-300 hover:bg-white/5'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="flex-1 px-3 py-2 text-sm font-medium bg-juice-orange text-black hover:bg-juice-orange/90 transition-colors"
          >
            Save
          </button>
        </div>
      </form>
    </div>
  )
}
