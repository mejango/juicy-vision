/**
 * Popover positioning hook
 *
 * Handles updating popover positions on scroll to keep them anchored
 * to their trigger elements. Uses capture phase to catch all scroll events.
 */

import { useEffect, useCallback, type RefObject } from 'react'

interface AnchorPosition {
  top: number
  left: number
  width: number
  height: number
}

interface BetaAnchorPosition {
  top: number
  bottom: number
  right: number
}

interface MenuPosition {
  top: number
  right: number
}

interface UsePopoverPositioningOptions {
  // Settings panel
  settingsOpen: boolean
  settingsButtonRef: RefObject<HTMLButtonElement | null>
  setSettingsAnchorPosition: (pos: AnchorPosition | null) => void

  // Language menu
  langMenuOpen: boolean
  langButtonRef: RefObject<HTMLButtonElement | null>
  setLangMenuPosition: (pos: MenuPosition | null) => void

  // Beta popover
  showBetaPopover: boolean
  betaButtonRef: RefObject<HTMLButtonElement | null>
  setBetaPopoverPosition: (pos: 'above' | 'below') => void
  setBetaAnchorPosition: (pos: BetaAnchorPosition | null) => void
}

export function usePopoverPositioning({
  settingsOpen,
  settingsButtonRef,
  setSettingsAnchorPosition,
  langMenuOpen,
  langButtonRef,
  setLangMenuPosition,
  showBetaPopover,
  betaButtonRef,
  setBetaPopoverPosition,
  setBetaAnchorPosition,
}: UsePopoverPositioningOptions): void {
  // Update Beta popover position on scroll
  useEffect(() => {
    if (!showBetaPopover || !betaButtonRef.current) return

    const updatePosition = () => {
      const button = betaButtonRef.current
      if (!button) return
      const rect = button.getBoundingClientRect()
      const isInBottomHalf = rect.top > window.innerHeight / 2
      setBetaPopoverPosition(isInBottomHalf ? 'above' : 'below')
      setBetaAnchorPosition({
        top: rect.bottom + 8,
        bottom: window.innerHeight - rect.top + 8,
        right: window.innerWidth - rect.right,
      })
    }

    // Update on any scroll event (capture phase to catch all scrolls)
    window.addEventListener('scroll', updatePosition, true)
    return () => window.removeEventListener('scroll', updatePosition, true)
  }, [showBetaPopover, betaButtonRef, setBetaPopoverPosition, setBetaAnchorPosition])

  // Update language menu position on scroll
  useEffect(() => {
    if (!langMenuOpen || !langButtonRef.current) return

    const updatePosition = () => {
      const button = langButtonRef.current
      if (!button) return
      const rect = button.getBoundingClientRect()
      setLangMenuPosition({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      })
    }

    // Update on any scroll event (capture phase to catch all scrolls)
    window.addEventListener('scroll', updatePosition, true)
    return () => window.removeEventListener('scroll', updatePosition, true)
  }, [langMenuOpen, langButtonRef, setLangMenuPosition])

  // Update settings panel position on scroll
  useEffect(() => {
    if (!settingsOpen || !settingsButtonRef.current) return

    const updatePosition = () => {
      const button = settingsButtonRef.current
      if (!button) return
      const rect = button.getBoundingClientRect()
      setSettingsAnchorPosition({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      })
    }

    // Update on any scroll event (capture phase to catch all scrolls)
    window.addEventListener('scroll', updatePosition, true)
    return () => window.removeEventListener('scroll', updatePosition, true)
  }, [settingsOpen, settingsButtonRef, setSettingsAnchorPosition])
}
