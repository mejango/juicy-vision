import { ReactNode, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useThemeStore } from '../../stores'

export interface AnchorPosition {
  top: number
  left: number
  width: number
  height: number
}

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  anchorPosition?: AnchorPosition | null
}

export default function Modal({ isOpen, onClose, title, children, size = 'md', anchorPosition }: ModalProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
    }
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, handleEscape])

  // Calculate popover position based on anchor
  const popoverStyle = useMemo(() => {
    if (!anchorPosition) {
      // Fallback to top-right if no anchor
      return { top: 16, right: 16 }
    }

    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800
    const gap = 8 // Gap between button and popover

    // Check if button is in lower half of viewport
    const isInLowerHalf = anchorPosition.top > viewportHeight / 2

    if (isInLowerHalf) {
      // Show above the button
      return {
        bottom: viewportHeight - anchorPosition.top + gap,
        right: Math.max(16, typeof window !== 'undefined' ? window.innerWidth - anchorPosition.left - anchorPosition.width : 16),
      }
    } else {
      // Show below the button
      return {
        top: anchorPosition.top + anchorPosition.height + gap,
        right: Math.max(16, typeof window !== 'undefined' ? window.innerWidth - anchorPosition.left - anchorPosition.width : 16),
      }
    }
  }, [anchorPosition])

  if (!isOpen) return null

  const sizes = {
    sm: 'w-80',
    md: 'w-96',
    lg: 'w-[28rem]',
    xl: 'w-[32rem]',
  }

  return createPortal(
    <div className="fixed z-50" style={popoverStyle}>
      {/* Popover content */}
      <div
        className={`
          ${sizes[size]} max-h-[85vh] flex flex-col
          border shadow-xl rounded-lg
          ${isDark
            ? 'bg-juice-dark border-white/20'
            : 'bg-white border-gray-200'
          }
        `}
      >
        {/* Header */}
        {title && (
          <div className={`flex items-center justify-between px-4 py-3 border-b shrink-0 ${
            isDark ? 'border-white/10' : 'border-gray-100'
          }`}>
            <h2 className={`text-sm font-semibold pr-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>{title}</h2>
            <button
              onClick={onClose}
              className={`transition-colors p-1 ${
                isDark
                  ? 'text-gray-500 hover:text-white'
                  : 'text-gray-400 hover:text-gray-900'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Body */}
        <div className="p-4 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>,
    document.body
  )
}
