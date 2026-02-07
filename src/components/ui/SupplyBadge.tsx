import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { fetchMultiChainTierSupply, type MultiChainTierSupply } from '../../services/nft/multichain'

interface SupplyBadgeProps {
  tierId: number
  currentRemaining: number
  connectedChains?: Array<{ chainId: number; projectId: number }>
  isDark: boolean
}

/**
 * Supply badge that shows remaining NFT supply.
 * For multi-chain projects, shows total across all chains with click for breakdown.
 */
export default function SupplyBadge({
  tierId,
  currentRemaining,
  connectedChains,
  isDark,
}: SupplyBadgeProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [supplyData, setSupplyData] = useState<MultiChainTierSupply | null>(null)
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({})
  const [isNearViewport, setIsNearViewport] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const isMultiChain = connectedChains && connectedChains.length > 1

  // For multi-chain, use total; otherwise use current chain
  const displayRemaining = supplyData ? supplyData.totalRemaining : currentRemaining
  const soldOut = displayRemaining === 0

  // Intersection Observer to detect when badge is near viewport
  useEffect(() => {
    if (!isMultiChain || !buttonRef.current) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsNearViewport(true)
          observer.disconnect() // Only need to trigger once
        }
      },
      {
        rootMargin: '200px', // Trigger 200px before entering viewport
        threshold: 0,
      }
    )

    observer.observe(buttonRef.current)
    return () => observer.disconnect()
  }, [isMultiChain])

  // Close on click outside or scroll
  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (
        buttonRef.current && !buttonRef.current.contains(e.target as Node) &&
        popoverRef.current && !popoverRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
      }
    }
    const handleScroll = () => setIsOpen(false)
    document.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [isOpen])

  // Fetch multi-chain data when near viewport
  useEffect(() => {
    if (!isMultiChain || !isNearViewport || supplyData) return

    setLoading(true)
    fetchMultiChainTierSupply(tierId, connectedChains)
      .then(setSupplyData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [isMultiChain, isNearViewport, tierId, connectedChains, supplyData])

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()

    // Only show popover for multi-chain projects
    if (!isMultiChain) return

    if (!isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      const popoverWidth = 200
      const popoverHeight = 150

      const spaceAbove = rect.top
      const spaceBelow = window.innerHeight - rect.bottom
      const spaceRight = window.innerWidth - rect.right

      const styles: React.CSSProperties = {
        position: 'fixed',
        zIndex: 9999,
        width: popoverWidth,
      }

      // Vertical position - prefer below
      if (spaceBelow >= popoverHeight || spaceBelow > spaceAbove) {
        styles.top = rect.bottom + 4
      } else {
        styles.bottom = window.innerHeight - rect.top + 4
      }

      // Horizontal position - align right edge with button
      if (spaceRight >= popoverWidth) {
        styles.left = rect.left
      } else {
        styles.right = window.innerWidth - rect.right
      }

      setPopoverStyle(styles)
    }
    setIsOpen(!isOpen)
  }

  // Render the popover content
  const popoverContent = isOpen && isMultiChain ? (
    <div
      ref={popoverRef}
      className={`p-3 shadow-lg text-xs ${
        isDark
          ? 'bg-gray-800 text-gray-300 border border-gray-700'
          : 'bg-white text-gray-600 border border-gray-200'
      }`}
      style={popoverStyle}
    >
      {/* Close button */}
      <button
        onClick={(e) => { e.stopPropagation(); setIsOpen(false) }}
        className={`absolute top-1 right-1 w-5 h-5 flex items-center justify-center hover:bg-opacity-10 ${
          isDark ? 'text-gray-400 hover:bg-white' : 'text-gray-500 hover:bg-black'
        }`}
      >
        ×
      </button>

      <div className="pr-4">
        <div className={`text-[10px] font-medium uppercase tracking-wide mb-2 ${
          isDark ? 'text-gray-500' : 'text-gray-400'
        }`}>
          Supply by network
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-2">
            <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            <span>Loading...</span>
          </div>
        ) : supplyData ? (
          <div className="space-y-1.5">
            {supplyData.perChain.map((chain) => (
              <div key={chain.chainId} className="flex justify-between items-center">
                <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>
                  {chain.chainName}
                </span>
                <span className={`font-mono ${
                  chain.remaining === 0
                    ? 'text-red-400'
                    : isDark ? 'text-white' : 'text-gray-900'
                }`}>
                  {chain.remaining}
                </span>
              </div>
            ))}

            {/* Total row */}
            <div className={`flex justify-between items-center pt-1.5 mt-1.5 border-t ${
              isDark ? 'border-gray-700' : 'border-gray-200'
            }`}>
              <span className={`font-medium ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                Total
              </span>
              <span className={`font-mono font-medium ${
                supplyData.totalRemaining === 0
                  ? 'text-red-400'
                  : isDark ? 'text-white' : 'text-gray-900'
              }`}>
                {supplyData.totalRemaining}
              </span>
            </div>
          </div>
        ) : (
          <div className={`py-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            Failed to load
          </div>
        )}
      </div>
    </div>
  ) : null

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleClick}
        className={`px-2 py-0.5 text-xs font-medium ${
          soldOut
            ? 'bg-red-500/90 text-white'
            : isDark ? 'bg-black/70 text-white' : 'bg-white/90 text-gray-900'
        } ${isMultiChain ? 'cursor-pointer hover:opacity-80 transition-opacity' : 'cursor-default'}`}
        title={isMultiChain ? 'Click to see supply by network' : undefined}
      >
        {loading && isMultiChain ? (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 border border-current border-t-transparent rounded-full animate-spin" />
            <span>left</span>
          </span>
        ) : soldOut ? (
          'Sold Out'
        ) : (
          <>
            {displayRemaining} left
            {isMultiChain && <span className="ml-1 opacity-60">+</span>}
          </>
        )}
      </button>

      {/* Render popover in portal to escape overflow:hidden containers */}
      {popoverContent && createPortal(popoverContent, document.body)}
    </>
  )
}
