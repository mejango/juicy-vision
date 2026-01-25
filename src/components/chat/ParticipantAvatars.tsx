import { useMemo, useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useThemeStore, useSettingsStore } from '../../stores'
import { getWalletSession } from '../../services/siwe'
import { getSessionId, getCachedPseudoAddress } from '../../services/session'
import { updateMemberPermissions } from '../../services/chat'
import type { ChatMember } from '../../stores/chatStore'

interface ParticipantAvatarsProps {
  members: ChatMember[]
  onlineMembers?: string[]
  maxVisible?: number
  size?: 'sm' | 'md'
  className?: string
  chatId?: string
  currentUserMember?: ChatMember
  onMemberUpdated?: (member: ChatMember) => void
}

// Fruit and juice related emojis for anonymous users
export const FRUIT_EMOJIS = [
  '\ud83c\udf4a', // orange
  '\ud83c\udf4b', // lemon
  '\ud83c\udf4e', // apple
  '\ud83c\udf47', // grapes
  '\ud83c\udf53', // strawberry
  '\ud83c\udf52', // cherries
  '\ud83c\udf51', // peach
  '\ud83c\udf49', // watermelon
  '\ud83c\udf48', // melon
  '\ud83c\udf4d', // pineapple
  '\ud83e\udd5d', // kiwi
  '\ud83e\udd6d', // mango
  '\ud83c\udf50', // pear
  '\ud83c\udf4c', // banana
  '\ud83e\uddc3', // beverage box (juice)
  '\ud83e\udd64', // cup with straw
]

// Get emoji from address (deterministic based on address hash)
export function getEmojiFromAddress(address: string | undefined): string {
  if (!address) return '\ud83c\udf4a'
  // Use a hash of the address to pick a consistent emoji
  const hash = address.slice(-8)
  const index = parseInt(hash, 16) % FRUIT_EMOJIS.length
  return FRUIT_EMOJIS[isNaN(index) ? 0 : index]
}

// Get emoji for a user, respecting custom selection
// Priority: member's server-side customEmoji > current user's local selectedFruit > address-based default
export function getEmojiForUser(
  address: string | undefined,
  currentUserAddress: string | undefined,
  selectedFruit: string | null,
  memberCustomEmoji?: string | null
): string {
  // If member has a server-side custom emoji, use it
  if (memberCustomEmoji) {
    return memberCustomEmoji
  }
  // If this is the current user and they have a local custom fruit (fallback for unsynced), use it
  if (selectedFruit && currentUserAddress && address?.toLowerCase() === currentUserAddress.toLowerCase()) {
    return selectedFruit
  }
  return getEmojiFromAddress(address)
}

function getInitials(member: ChatMember): string {
  // If user has a display name (ENS or custom), use initials
  if (member.displayName) {
    const parts = member.displayName.split(' ')
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    }
    return member.displayName.slice(0, 2).toUpperCase()
  }
  // For anonymous users, return null to use emoji instead
  return ''
}

function getColorFromAddress(address: string | undefined): string {
  if (!address) return 'hsl(0, 0%, 50%)'
  // Generate a consistent color from address
  const hash = address.slice(-6)
  const hue = parseInt(hash, 16) % 360
  return `hsl(${hue}, 60%, 45%)`
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

// Juicy Identity type
interface JuicyIdentity {
  emoji: string
  username: string
  formatted: string
}

// Member info popover component - exported for use in MessageBubble
export function MemberPopover({
  member,
  emoji,
  isOnline,
  onClose,
  anchorRect,
  isDark,
  chatId,
  currentUserMember,
  onMemberUpdated,
}: {
  member: ChatMember
  emoji: string
  isOnline: boolean
  onClose: () => void
  anchorRect: DOMRect
  isDark: boolean
  chatId?: string
  currentUserMember?: ChatMember
  onMemberUpdated?: (member: ChatMember) => void
}) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [isUpdating, setIsUpdating] = useState<string | null>(null)
  const [localMember, setLocalMember] = useState(member)
  const [identity, setIdentity] = useState<JuicyIdentity | null>(null)

  // Fetch Juicy ID for this member
  useEffect(() => {
    if (!member.address) return
    const apiUrl = import.meta.env.VITE_API_URL || ''
    fetch(`${apiUrl}/identity/address/${member.address}`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.data) {
          setIdentity(data.data)
        }
      })
      .catch(err => console.error('Failed to fetch identity:', err))
  }, [member.address])

  // Can edit if current user has canManageMembers and target is not founder
  // and target is not the current user themselves
  const canEdit = chatId &&
    currentUserMember?.canManageMembers &&
    member.role !== 'founder' &&
    member.address?.toLowerCase() !== currentUserMember.address?.toLowerCase()

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  const handleTogglePermission = async (
    permission: 'canInvite' | 'canInvokeAi' | 'canManageMembers' | 'canPauseAi',
    currentValue: boolean
  ) => {
    if (!chatId || !canEdit || isUpdating) return

    setIsUpdating(permission)
    try {
      const updated = await updateMemberPermissions(chatId, member.address, {
        [permission]: !currentValue,
      })
      setLocalMember(updated)
      onMemberUpdated?.(updated)
    } catch (err) {
      console.error('Failed to update permission:', err)
    } finally {
      setIsUpdating(null)
    }
  }

  // Position below the avatar
  const style = {
    position: 'fixed' as const,
    top: anchorRect.bottom + 8,
    left: anchorRect.left,
    zIndex: 100,
  }

  const PermissionRow = ({
    label,
    value,
    permissionKey,
    editable = true,
  }: {
    label: string
    value: boolean
    permissionKey?: 'canInvite' | 'canInvokeAi' | 'canManageMembers' | 'canPauseAi'
    editable?: boolean
  }) => {
    const isThisUpdating = permissionKey && isUpdating === permissionKey
    const canToggle = canEdit && editable && permissionKey && !isUpdating

    return (
      <button
        onClick={() => permissionKey && canToggle && handleTogglePermission(permissionKey, value)}
        disabled={!canToggle}
        className={`flex items-center gap-2 w-full text-left ${canToggle ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
      >
        <span className={`${isThisUpdating ? 'opacity-50' : ''} ${value ? 'text-green-500' : 'text-red-400'}`}>
          {isThisUpdating ? '...' : value ? '✓' : '✗'}
        </span>
        <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>{label}</span>
      </button>
    )
  }

  return createPortal(
    <div
      ref={popoverRef}
      style={style}
      className={`p-3 border shadow-xl min-w-[200px] ${
        isDark ? 'bg-juice-dark border-white/20' : 'bg-white border-gray-200'
      }`}
    >
      {/* Header with emoji, Juicy ID, and status */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-2xl">{emoji}</span>
        <div className="flex-1 min-w-0">
          {/* Juicy Identity username (emoji shown separately) */}
          {identity && (
            <p className={`text-sm font-medium truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {identity.username}
            </p>
          )}
        </div>
        {isOnline && (
          <div className="w-2 h-2 rounded-full bg-green-500" title="Online" />
        )}
      </div>

      {/* Role badge and join date */}
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-xs px-2 py-0.5 rounded ${
          localMember.role === 'founder'
            ? 'bg-yellow-500/20 text-yellow-500'
            : localMember.role === 'admin'
            ? 'bg-purple-500/20 text-purple-500'
            : isDark
            ? 'bg-white/10 text-gray-400'
            : 'bg-gray-100 text-gray-600'
        }`}>
          {localMember.role}
        </span>
        {localMember.joinedAt && (
          <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            Joined {new Date(localMember.joinedAt).toLocaleDateString()}
          </span>
        )}
      </div>

      {/* Permissions */}
      <div className={`text-xs space-y-1 pt-2 border-t ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
        <PermissionRow
          label="Send messages"
          value={localMember.canSendMessages !== false}
          editable={false}
        />
        <PermissionRow
          label="Invite others"
          value={!!localMember.canInvite}
          permissionKey="canInvite"
        />
        <PermissionRow
          label="Use AI"
          value={localMember.canInvokeAi !== false}
          permissionKey="canInvokeAi"
        />
        <PermissionRow
          label="Manage members"
          value={!!localMember.canManageMembers}
          permissionKey="canManageMembers"
        />
        <PermissionRow
          label="Pause AI"
          value={!!localMember.canPauseAi}
          permissionKey="canPauseAi"
        />
      </div>

      {canEdit && (
        <p className={`text-[10px] mt-2 ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
          Click permissions to toggle
        </p>
      )}

      {/* Address at bottom - subtle, small, full */}
      <p className={`text-[10px] font-mono mt-3 pt-2 border-t break-all ${isDark ? 'text-gray-600 border-white/5' : 'text-gray-400 border-gray-100'}`}>
        {localMember.address}
      </p>
    </div>,
    document.body
  )
}

export default function ParticipantAvatars({
  members,
  onlineMembers = [],
  maxVisible = 5,
  size = 'sm',
  className = '',
  chatId,
  currentUserMember,
  onMemberUpdated,
}: ParticipantAvatarsProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { selectedFruit } = useSettingsStore()

  // State for popover
  const [selectedMember, setSelectedMember] = useState<{
    member: ChatMember
    emoji: string
    isOnline: boolean
    rect: DOMRect
  } | null>(null)

  // Get current user's address to check if they have a custom fruit
  const currentUserAddress = useMemo(() => {
    const walletSession = getWalletSession()
    if (walletSession?.address) return walletSession.address
    // Use cached pseudo-address from backend (HMAC-SHA256)
    const cached = getCachedPseudoAddress()
    if (cached) return cached
    // Fallback before cache is populated
    const sessionId = getSessionId()
    return `0x${sessionId.replace(/[^a-f0-9]/gi, '').slice(0, 40).padStart(40, '0')}`
  }, [])

  const onlineSet = useMemo(() => new Set((onlineMembers || []).map(a => a?.toLowerCase()).filter(Boolean)), [onlineMembers])

  // Filter out members without address, then sort: online first, then by role
  const sortedMembers = useMemo(() => {
    if (!members) return []
    return [...members]
      .filter(m => m && m.address)
      .sort((a, b) => {
        const aOnline = onlineSet.has(a.address.toLowerCase())
        const bOnline = onlineSet.has(b.address.toLowerCase())
        if (aOnline !== bOnline) return aOnline ? -1 : 1

        const roleOrder = { founder: 0, admin: 1, member: 2 }
        return (roleOrder[a.role] ?? 2) - (roleOrder[b.role] ?? 2)
      })
  }, [members, onlineSet])

  const visibleMembers = sortedMembers.slice(0, maxVisible)
  const overflowCount = sortedMembers.length - maxVisible

  const sizeClasses = size === 'sm'
    ? 'w-7 h-7'
    : 'w-8 h-8'

  const emojiSizeClasses = size === 'sm'
    ? 'text-sm'
    : 'text-base'

  const spacing = size === 'sm' ? 'ml-1' : 'ml-1.5'

  if (!members || members.length === 0 || sortedMembers.length === 0) return null

  return (
    <div className={`flex items-center ${className}`}>
      {visibleMembers.map((member, index) => {
        const addr = member.address || ''
        const isOnline = Boolean(addr && onlineSet.has(addr.toLowerCase()))
        const emoji = getEmojiForUser(addr, currentUserAddress, selectedFruit, member.customEmoji)

        // Build hover title: show display name if available, then address
        const hoverTitle = member.displayName
          ? `${member.displayName} (${addr})`
          : addr

        // Border style: subtle normally, slightly more visible if online
        const borderClass = isOnline
          ? isDark
            ? 'border border-green-500/50'
            : 'border border-green-500/40'
          : isDark
            ? 'border border-white/15'
            : 'border border-gray-200'

        return (
          <div
            key={addr || index}
            onClick={(e) => {
              e.stopPropagation()
              const rect = e.currentTarget.getBoundingClientRect()
              setSelectedMember({ member, emoji, isOnline, rect })
            }}
            className={`${sizeClasses} rounded-md flex items-center justify-center cursor-pointer hover:scale-110 transition-transform ${
              index > 0 ? spacing : ''
            } ${borderClass} ${emojiSizeClasses} ${
              isDark ? 'bg-juice-dark' : 'bg-white'
            }`}
            title={hoverTitle}
          >
            {emoji}
          </div>
        )
      })}
      {overflowCount > 0 && (
        <div
          className={`${sizeClasses} rounded-md flex items-center justify-center font-medium text-xs ${spacing} ${
            isDark
              ? 'bg-juice-dark border border-white/20 text-gray-400'
              : 'bg-white border border-gray-300 text-gray-500'
          }`}
          title={`${overflowCount} more participant${overflowCount > 1 ? 's' : ''}`}
        >
          +{overflowCount > 99 ? '99' : overflowCount}
        </div>
      )}

      {/* Member info popover */}
      {selectedMember && (
        <MemberPopover
          member={selectedMember.member}
          emoji={selectedMember.emoji}
          isOnline={selectedMember.isOnline}
          onClose={() => setSelectedMember(null)}
          anchorRect={selectedMember.rect}
          isDark={isDark}
          chatId={chatId}
          currentUserMember={currentUserMember}
          onMemberUpdated={onMemberUpdated}
        />
      )}
    </div>
  )
}
