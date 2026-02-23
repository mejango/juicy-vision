/**
 * Mobile Keyboard Hook
 *
 * Handles mobile keyboard visibility by using the Visual Viewport API.
 * When an input is focused and the keyboard opens (viewport shrinks),
 * this hook ensures the focused element remains visible.
 *
 * Usage: Call this hook in any component with form inputs that may be
 * covered by the mobile keyboard.
 */

import { useEffect, useCallback, useRef } from 'react'

interface UseMobileKeyboardOptions {
  /** Whether the hook should be active */
  enabled?: boolean
  /** Container ref - if provided, will scroll within this container */
  containerRef?: React.RefObject<HTMLElement | null>
}

interface UseMobileKeyboardReturn {
  /** Current keyboard height (0 when closed) */
  keyboardHeight: number
  /** Whether keyboard is currently visible */
  isKeyboardVisible: boolean
}

export function useMobileKeyboard(options: UseMobileKeyboardOptions = {}): UseMobileKeyboardReturn {
  const { enabled = true, containerRef } = options
  const keyboardHeightRef = useRef(0)
  const isKeyboardVisibleRef = useRef(false)
  const lastViewportHeightRef = useRef(0)

  const scrollFocusedElementIntoView = useCallback(() => {
    const activeElement = document.activeElement as HTMLElement
    if (!activeElement) return

    // Only handle input elements
    const isInput = activeElement.tagName === 'INPUT' ||
                    activeElement.tagName === 'TEXTAREA' ||
                    activeElement.isContentEditable
    if (!isInput) return

    // Use scrollIntoView with a slight delay to let keyboard animation complete
    requestAnimationFrame(() => {
      activeElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest'
      })
    })
  }, [])

  useEffect(() => {
    if (!enabled) return

    // Check for Visual Viewport API support
    const visualViewport = window.visualViewport
    if (!visualViewport) return

    // Store initial viewport height
    lastViewportHeightRef.current = visualViewport.height

    const handleViewportResize = () => {
      const currentHeight = visualViewport.height
      const heightDiff = lastViewportHeightRef.current - currentHeight

      // Keyboard is considered open if viewport shrank by more than 150px
      // This threshold accounts for iOS Safari's address bar changes
      const wasKeyboardVisible = isKeyboardVisibleRef.current
      isKeyboardVisibleRef.current = heightDiff > 150
      keyboardHeightRef.current = isKeyboardVisibleRef.current ? heightDiff : 0

      // If keyboard just became visible, scroll focused element into view
      if (isKeyboardVisibleRef.current && !wasKeyboardVisible) {
        scrollFocusedElementIntoView()
      }
    }

    // Also handle focus events to scroll when input is focused
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement
      const isInput = target.tagName === 'INPUT' ||
                      target.tagName === 'TEXTAREA' ||
                      target.isContentEditable

      if (isInput) {
        // Small delay to let keyboard animation start
        setTimeout(() => {
          target.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'nearest'
          })
        }, 100)
      }
    }

    visualViewport.addEventListener('resize', handleViewportResize)
    document.addEventListener('focusin', handleFocusIn)

    return () => {
      visualViewport.removeEventListener('resize', handleViewportResize)
      document.removeEventListener('focusin', handleFocusIn)
    }
  }, [enabled, containerRef, scrollFocusedElementIntoView])

  return {
    keyboardHeight: keyboardHeightRef.current,
    isKeyboardVisible: isKeyboardVisibleRef.current
  }
}
