import { useMemo, type CSSProperties } from 'react'
import type { AnchorPosition } from './Modal'

/**
 * Compute a fixed-position style for a popover anchored to a button rect.
 *
 * - Without `width`: right-aligns the popover's right edge with the button's
 *   right edge (clamped to a 16px viewport margin).
 * - With `width`: left-aligns the popover with the button's left edge and
 *   clamps it so a popover of that width stays within the viewport.
 *
 * In both modes the popover opens below the button, or above it when the
 * button sits in the lower half of the viewport. Falls back to the top-right
 * corner when no anchor is provided.
 */
export function useAnchoredPopoverStyle(
  anchorPosition: AnchorPosition | null | undefined,
  width?: number
): CSSProperties {
  return useMemo(() => {
    if (!anchorPosition) {
      // Fallback to top-right if no anchor
      return { top: 16, right: 16 }
    }

    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800
    const gap = 8 // Gap between button and popover

    // Check if button is in lower half of viewport
    const isInLowerHalf = anchorPosition.top > viewportHeight / 2

    if (width != null) {
      // Horizontal position: align left edge of popover with left edge of button
      // but ensure it doesn't overflow the viewport
      const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1200
      let left = anchorPosition.left
      if (left + width > viewportWidth - 16) {
        // Would overflow right edge, align to right edge instead
        left = viewportWidth - width - 16
      }
      left = Math.max(16, left)

      if (isInLowerHalf) {
        // Show above the button
        return { bottom: viewportHeight - anchorPosition.top + gap, left }
      }
      // Show below the button
      return { top: anchorPosition.top + anchorPosition.height + gap, left }
    }

    const right = Math.max(
      16,
      typeof window !== 'undefined' ? window.innerWidth - anchorPosition.left - anchorPosition.width : 16
    )

    if (isInLowerHalf) {
      // Show above the button
      return { bottom: viewportHeight - anchorPosition.top + gap, right }
    }
    // Show below the button
    return { top: anchorPosition.top + anchorPosition.height + gap, right }
  }, [anchorPosition, width])
}
