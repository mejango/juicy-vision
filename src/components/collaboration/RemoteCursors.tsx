/**
 * RemoteCursors component for displaying other users' cursor positions
 *
 * Usage:
 * 1. Wrap your component with a relative-positioned container
 * 2. Add RemoteCursors inside and pass the cursors from useComponentCollaboration
 * 3. Call onMouseMove with normalized coordinates (0-1) from parent mouse events
 *
 * Example:
 * ```tsx
 * const { remoteCursors, sendCursor } = useComponentCollaboration({ chatId, messageId })
 *
 * <div
 *   className="relative"
 *   onMouseMove={(e) => {
 *     const rect = e.currentTarget.getBoundingClientRect()
 *     sendCursor(groupId, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height)
 *   }}
 *   onMouseLeave={() => sendCursor(groupId, -1, -1)} // Hide cursor when leaving
 * >
 *   <RemoteCursors cursors={remoteCursors.get(groupId)} />
 *   {children}
 * </div>
 * ```
 */

import { useThemeStore } from '../../stores'
import type { RemoteCursor } from '../../hooks/useComponentCollaboration'

interface RemoteCursorsProps {
  cursors?: RemoteCursor[]
}

export function RemoteCursors({ cursors }: RemoteCursorsProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  if (!cursors || cursors.length === 0) return null

  return (
    <>
      {cursors.map((cursor) => {
        // Don't render if cursor is outside bounds (used as "hide" signal)
        if (cursor.x < 0 || cursor.y < 0 || cursor.x > 1 || cursor.y > 1) return null

        return (
          <div
            key={cursor.address}
            className="absolute pointer-events-none z-50 transition-all duration-75 ease-out"
            style={{
              left: `${cursor.x * 100}%`,
              top: `${cursor.y * 100}%`,
              transform: 'translate(-2px, -2px)',
            }}
          >
            {/* Cursor pointer */}
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              className="drop-shadow-sm"
            >
              <path
                d="M1 1L1 14L5 10L9 14L11 12L7 8L11 4L1 1Z"
                fill={isDark ? '#fff' : '#000'}
                stroke={isDark ? '#000' : '#fff'}
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
            {/* Emoji label */}
            <span
              className={`absolute left-3 top-3 text-xs px-1 py-0.5 rounded shadow-sm whitespace-nowrap animate-fade-in ${
                isDark ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
              }`}
            >
              {cursor.emoji}
            </span>
          </div>
        )
      })}
    </>
  )
}

export default RemoteCursors
