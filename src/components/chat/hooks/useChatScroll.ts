/**
 * Scroll behavior hook for chat dock
 *
 * Handles:
 * - Dock scroll with RAF batching for smooth updates
 * - Sticky prompt detection (when prompt hits top of container)
 * - Scroll direction detection for showing/hiding action bar
 * - Global scroll forwarding when cursor leaves dock
 */

import { useEffect, useRef, useState, useCallback, type RefObject } from 'react'
import { UI_TIMING, SCROLL_THRESHOLDS } from '../../../constants'

// Type for dock scroll tracking
declare global {
  interface Window {
    __dockScrollActive?: boolean
    __dockScrollLocked?: boolean
  }
}

interface UseChatScrollOptions {
  /** Ref to the dock container element */
  dockRef: RefObject<HTMLDivElement | null>
  /** Ref to the sticky prompt element */
  stickyPromptRef: RefObject<HTMLDivElement | null>
  /** Ref to the messages scroll container */
  messagesScrollRef: RefObject<HTMLDivElement | null>
  /** Whether there are messages (affects scroll behavior) */
  hasMessages: boolean
}

interface UseChatScrollResult {
  /** Whether the sticky prompt is stuck to the top */
  isPromptStuck: boolean
  /** Whether the action bar should be visible */
  showActionBar: boolean
}

export function useChatScroll({
  dockRef,
  stickyPromptRef,
  messagesScrollRef,
  hasMessages,
}: UseChatScrollOptions): UseChatScrollResult {
  const [isPromptStuck, setIsPromptStuck] = useState(false)
  const [showActionBar, setShowActionBar] = useState(true)
  const lastScrollTop = useRef(0)

  // Track dock scroll position for direction detection
  const lastDockScrollTop = useRef(0)

  // Track hasMessages in ref so wheel handler closure sees updates
  const hasMessagesRef = useRef(hasMessages)
  hasMessagesRef.current = hasMessages

  // Detect when sticky prompt hits top of container
  // Also dispatch scroll direction for header shrinking
  useEffect(() => {
    const dock = dockRef.current
    const stickyPrompt = stickyPromptRef.current
    if (!dock || !stickyPrompt) return

    const handleScroll = () => {
      const dockRect = dock.getBoundingClientRect()
      const promptRect = stickyPrompt.getBoundingClientRect()
      // Element is stuck when its top equals the container's top
      setIsPromptStuck(promptRect.top <= dockRect.top)

      // Dispatch scroll direction event for header to shrink/expand
      const currentScrollTop = dock.scrollTop
      const scrollDelta = currentScrollTop - lastDockScrollTop.current

      // Thresholds for detecting intentional scroll direction
      const scrollDownThreshold = 5  // Small threshold to detect scroll down
      const scrollUpThreshold = 12   // Threshold to show header on scroll up

      const isScrollingDown = scrollDelta > scrollDownThreshold
      const isGenuineScrollUp = scrollDelta < -scrollUpThreshold

      lastDockScrollTop.current = currentScrollTop

      // Only dispatch direction change on significant scroll movement
      // When scroll stops (delta near 0), maintain current header state
      if (isScrollingDown) {
        window.dispatchEvent(new CustomEvent('juice:scroll-direction', {
          detail: { isScrollingDown: true, scrollTop: currentScrollTop }
        }))
      } else if (isGenuineScrollUp) {
        window.dispatchEvent(new CustomEvent('juice:scroll-direction', {
          detail: { isScrollingDown: false, scrollTop: currentScrollTop }
        }))
      }
      // Otherwise, don't dispatch - maintain current state
    }

    dock.addEventListener('scroll', handleScroll)
    return () => dock.removeEventListener('scroll', handleScroll)
  }, [dockRef, stickyPromptRef, hasMessages])

  // Handle dock scrolling: manually scroll since native scroll doesn't work on inner elements,
  // and continue scrolling when cursor leaves dock until user moves their mouse
  useEffect(() => {
    const dock = dockRef.current
    if (!dock) return

    let scrollTimeout: number | null = null
    let lastMousePos = { x: 0, y: 0 }
    let pendingScroll = 0
    let rafId: number | null = null

    const clearDockActive = () => {
      window.__dockScrollActive = false
    }

    const refreshTimeout = () => {
      if (scrollTimeout) clearTimeout(scrollTimeout)
      scrollTimeout = window.setTimeout(clearDockActive, UI_TIMING.DOCK_CLEAR_DELAY)
    }

    // Apply scroll with RAF for smooth updates
    const applyScroll = () => {
      if (pendingScroll !== 0) {
        dock.scrollTop += pendingScroll
        pendingScroll = 0
      }
      rafId = null
    }

    const queueScroll = (delta: number) => {
      pendingScroll += delta
      if (!rafId) {
        rafId = requestAnimationFrame(applyScroll)
      }
    }

    // Mouse movement clears dock scroll lock only if moved significantly
    const handleMouseMove = (e: MouseEvent) => {
      if (window.__dockScrollActive) {
        const dx = Math.abs(e.clientX - lastMousePos.x)
        const dy = Math.abs(e.clientY - lastMousePos.y)
        if (dx > SCROLL_THRESHOLDS.SNAP_THRESHOLD || dy > SCROLL_THRESHOLDS.SNAP_THRESHOLD) {
          clearDockActive()
          if (scrollTimeout) {
            clearTimeout(scrollTimeout)
            scrollTimeout = null
          }
        }
      }
      lastMousePos = { x: e.clientX, y: e.clientY }
    }

    // Global wheel handler - scroll dock manually and track active state
    const handleGlobalWheel = (e: WheelEvent) => {
      // Skip if scroll is locked (during dock animation)
      if (window.__dockScrollLocked) return

      // Don't allow scrolling the dock when there are no messages
      if (!hasMessagesRef.current) return

      const isInDock = dock.contains(e.target as Element)

      if (isInDock) {
        // Cursor on dock - queue scroll and mark active
        queueScroll(e.deltaY)
        window.__dockScrollActive = true
        lastMousePos = { x: e.clientX, y: e.clientY }
        refreshTimeout()
        return
      }

      // Cursor outside dock - forward scroll if dock was recently scrolled
      if (window.__dockScrollActive) {
        queueScroll(e.deltaY)
        e.preventDefault()
        e.stopPropagation()
        refreshTimeout()
      }
    }

    document.addEventListener('mousemove', handleMouseMove, { passive: true })
    document.addEventListener('wheel', handleGlobalWheel, { capture: true, passive: false })

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('wheel', handleGlobalWheel, { capture: true })
      if (scrollTimeout) clearTimeout(scrollTimeout)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [dockRef])

  // Show/hide action bar based on scroll direction
  // Also dispatch event for header to shrink/expand
  useEffect(() => {
    const container = messagesScrollRef.current
    if (!container) return

    const handleScroll = () => {
      const currentScrollTop = container.scrollTop
      const scrollDelta = currentScrollTop - lastScrollTop.current

      // Thresholds for detecting intentional scroll direction
      const scrollDownThreshold = 5  // Small threshold to detect scroll down
      const scrollUpThreshold = 12   // Threshold to show header on scroll up

      const isScrollingDown = scrollDelta > scrollDownThreshold

      // Detect if we're at/near the bottom of the scroll container
      // This helps ignore iOS elastic bounce which falsely registers as "scroll up"
      const distanceFromBottom = container.scrollHeight - container.clientHeight - currentScrollTop
      const isAtBottom = distanceFromBottom < SCROLL_THRESHOLDS.SNAP_THRESHOLD

      // Require meaningful scroll delta to show action bar - small deltas from bounce are ignored
      const isGenuineScrollUp = scrollDelta < -scrollUpThreshold && !isAtBottom

      // Use same threshold as header - both compact/hide together
      const shouldCompact = isScrollingDown && currentScrollTop > SCROLL_THRESHOLDS.SHOW_SCROLL_BUTTON

      // Show action bar only on genuine scroll up, hide on scroll down
      // When scroll stops, maintain current state
      if (isGenuineScrollUp) {
        setShowActionBar(true)
      } else if (shouldCompact) {
        setShowActionBar(false)
      }

      lastScrollTop.current = currentScrollTop

      // Dispatch event for header to shrink/expand
      // Only dispatch on significant scroll movement - maintain state when scroll stops
      if (isScrollingDown) {
        window.dispatchEvent(new CustomEvent('juice:scroll-direction', {
          detail: { isScrollingDown: true, scrollTop: currentScrollTop }
        }))
      } else if (isGenuineScrollUp) {
        window.dispatchEvent(new CustomEvent('juice:scroll-direction', {
          detail: { isScrollingDown: false, scrollTop: currentScrollTop }
        }))
      }
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [messagesScrollRef, hasMessages])

  return {
    isPromptStuck,
    showActionBar,
  }
}
