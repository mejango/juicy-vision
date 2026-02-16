import { useState, useRef, useEffect, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Message, Attachment } from '../../stores'
import type { ChatMember } from '../../stores/chatStore'
import { useThemeStore, useSettingsStore } from '../../stores'
import { parseMessageContent } from '../../utils/messageParser'
import { IPFS_GATEWAY } from '../../constants'
import ComponentRegistry from '../dynamic/ComponentRegistry'
import ThinkingIndicator from './ThinkingIndicator'
import { getEmojiForUser, MemberPopover } from './ParticipantAvatars'
import { getWalletSession } from '../../services/siwe'
import { getSessionId, getCachedPseudoAddress } from '../../services/session'
import { JuicyIdPopover, type AnchorPosition } from './WalletInfo'

interface MessageBubbleProps {
  message: Message
  members?: ChatMember[]
  isLastAssistant?: boolean
  chatId?: string
  currentUserMember?: ChatMember
  onlineMembers?: string[]
  onMemberUpdated?: (member: ChatMember) => void
  userResponse?: string // The user's response to this message (if any), used to show submitted state for interactive components
}

// Download popover component
function DownloadPopover({
  attachment,
  onClose,
  isDark,
  anchorRef
}: {
  attachment: Attachment
  onClose: () => void
  isDark: boolean
  anchorRef: React.RefObject<HTMLDivElement>
}) {
  const popoverRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
          anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose, anchorRef])

  const handleDownload = () => {
    if (attachment.cid) {
      // Download from IPFS gateway
      window.open(`${IPFS_GATEWAY}${attachment.cid}`, '_blank')
    } else {
      const link = document.createElement('a')
      link.href = `data:${attachment.mimeType};base64,${attachment.data}`
      link.download = attachment.name
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
    onClose()
  }

  return (
    <div
      ref={popoverRef}
      className={`absolute bottom-full right-0 mb-2 p-3 border shadow-lg z-50 min-w-[200px] ${
        isDark ? 'bg-juice-dark border-white/20' : 'bg-white border-gray-200'
      }`}
    >
      <p className={`text-xs mb-3 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
        Download "{attachment.name}"?
      </p>
      <div className="flex justify-end">
        <button
          onClick={handleDownload}
          className="px-3 py-1 text-xs bg-green-500 text-white hover:bg-green-600 transition-colors"
        >
          Download
        </button>
      </div>
    </div>
  )
}

// Check if response contains an error message
function hasErrorMessage(content: string): boolean {
  if (!content) return false
  const trimmed = content.trim()
  // Check for known error patterns
  return (
    trimmed.includes('Something went wrong') ||
    trimmed.includes('Please try again') ||
    trimmed.includes('Connection lost') ||
    // Only match if it's a short message that's mostly an error
    (trimmed.length < 200 && (
      trimmed.includes('temporarily unavailable') ||
      trimmed.includes('service limit')
    ))
  )
}

// Check if response appears to be cut off or incomplete
function looksIncomplete(content: string): boolean {
  if (!content || content.length < 30) return false

  const trimmed = content.trim()
  if (!trimmed) return false

  // Ends with incomplete code block
  const codeBlockCount = (trimmed.match(/```/g) || []).length
  if (codeBlockCount % 2 !== 0) return true

  // Ends mid-word or with hanging punctuation
  if (/[a-zA-Z]{2,}$/.test(trimmed) && !/[.!?:;)\]}"']$/.test(trimmed)) {
    // Ends with letters but no punctuation - likely cut off
    const lastLine = trimmed.split('\n').pop() || ''
    // Unless it's a heading, list item, or component
    if (!lastLine.startsWith('#') && !lastLine.startsWith('-') && !lastLine.startsWith('*') && !lastLine.includes('juice-component') && !lastLine.includes('<component')) {
      return true
    }
  }

  // Ends with ellipsis that isn't intentional
  if (trimmed.endsWith('...') || trimmed.endsWith('…')) {
    return true
  }

  // Ends with colon suggesting more content should follow
  if (trimmed.endsWith(':')) {
    return true
  }

  // Check if response promises action but doesn't deliver
  // Only trigger if NO component exists in the entire response
  const hasComponent = trimmed.includes('juice-component') || trimmed.includes('<component')

  // If there's already a component, the response is likely complete
  if (hasComponent) {
    return false
  }

  // Check for conversational responses that should have follow-ups
  const lower = trimmed.toLowerCase()
  const lastSentence = lower.slice(-200)

  // Phrases that indicate the assistant should continue with more content
  const promisePhrases = [
    'let me understand',
    'let me show',
    'let me design',
    'let me suggest',
    'let me ask',
    'let me help',
    'let me explain',
    'let me break',
    'let me walk',
    'here\'s what',
    'here are the',
    'i\'ll need to',
    'first, i need',
    'to help you',
  ]

  for (const phrase of promisePhrases) {
    if (lastSentence.includes(phrase)) {
      return true
    }
  }

  // Short response without a question or action item is likely incomplete
  // (unless it's a simple acknowledgment)
  if (trimmed.length < 200 && !trimmed.includes('?') && !hasComponent) {
    // Check if it ends with a promise-like statement
    if (lastSentence.includes('approach') ||
        lastSentence.includes('understand') ||
        lastSentence.includes('help you') ||
        lastSentence.includes('work with')) {
      return true
    }
  }

  // Response ends with period but doesn't ask a question or provide options
  // and is relatively short - likely incomplete
  if (trimmed.endsWith('.') && trimmed.length < 300 && !trimmed.includes('?')) {
    // Check for "setup" sentences that imply more to come
    const endsWithSetup = /\b(approach|understand|process|look at|examine|review|consider|design|plan|strategy)\s*\.\s*$/i.test(trimmed)
    if (endsWithSetup) {
      return true
    }
  }

  return false
}

export default function MessageBubble({
  message,
  members,
  isLastAssistant,
  chatId,
  currentUserMember,
  onlineMembers,
  onMemberUpdated,
  userResponse,
}: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const parsed = parseMessageContent(message.content)
  const { theme } = useThemeStore()
  const { selectedFruit } = useSettingsStore()
  const isDark = theme === 'dark'
  const [downloadPopoverAttachment, setDownloadPopoverAttachment] = useState<Attachment | null>(null)
  const attachmentRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [memberPopover, setMemberPopover] = useState<{ rect: DOMRect } | null>(null)
  const [juicyIdPopoverOpen, setJuicyIdPopoverOpen] = useState(false)
  const [juicyIdAnchorPosition, setJuicyIdAnchorPosition] = useState<AnchorPosition | null>(null)

  // Get current user address to check if sender is the current user
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

  // Find sender's custom emoji from members list
  const senderMember = useMemo(() => {
    if (!members || !message.senderAddress) return undefined
    return members.find(m => m.address?.toLowerCase() === message.senderAddress?.toLowerCase())
  }, [members, message.senderAddress])

  // Get cached identity emoji for current user (prevents flicker when members not loaded)
  const cachedIdentityEmoji = useMemo(() => {
    try {
      const cached = localStorage.getItem('juicy-identity')
      return cached ? JSON.parse(cached).emoji : null
    } catch { return null }
  }, [])

  // Nudge button is now unified in MessageList - controlled by ChatContainer
  const showContinue = false

  // Show retry button for error messages (only on last assistant message)
  const showRetry = isLastAssistant && !isUser && hasErrorMessage(message.content)

  const handleContinue = () => {
    window.dispatchEvent(new CustomEvent('juice:send-message', {
      detail: { message: 'Please continue where you left off.' }
    }))
  }

  const handleRetry = () => {
    window.dispatchEvent(new CustomEvent('juice:send-message', {
      detail: { message: 'go on' }
    }))
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      {isUser ? (
        /* User message: text right-aligned with arrow in right margin */
        <div className={`max-w-[85%] md:max-w-[75%] text-right ${isDark ? 'text-white' : 'text-gray-900'}`}>
          {/* Sender name for shared chat - above the message row */}
          {/* Prefer live member displayName over baked-in senderName for real-time updates */}
          {(senderMember?.displayName || message.senderName) && (
            <p className={`text-xs mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              {senderMember?.displayName || message.senderName}
            </p>
          )}
          {/* Add Juicy ID prompt when user doesn't have one */}
          {message.needsJuicyId && !message.senderName && (
            <>
              <button
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  setJuicyIdAnchorPosition({
                    top: rect.top,
                    left: rect.left,
                    width: rect.width,
                    height: rect.height,
                  })
                  setJuicyIdPopoverOpen(true)
                }}
                className={`text-xs mb-1 transition-colors ${
                  isDark
                    ? 'text-green-400 hover:text-green-300'
                    : 'text-green-600 hover:text-green-500'
                }`}
              >
                Set your Juicy ID
              </button>
              <JuicyIdPopover
                isOpen={juicyIdPopoverOpen}
                onClose={() => setJuicyIdPopoverOpen(false)}
                anchorPosition={juicyIdAnchorPosition}
                onWalletClick={() => {
                  setJuicyIdPopoverOpen(false)
                  window.dispatchEvent(new CustomEvent('juice:open-wallet-panel', {
                    detail: { anchorPosition: juicyIdAnchorPosition }
                  }))
                }}
                onIdentitySet={() => setJuicyIdPopoverOpen(false)}
              />
            </>
          )}
          {/* Message content + lightning bolt row */}
          <div className="flex items-start gap-3">
            {/* Text content */}
            <div>
              {/* Display attachments */}
              {message.attachments && message.attachments.length > 0 && (
                <div className="flex gap-2 mb-2 justify-end flex-wrap">
                  {message.attachments.map(attachment => {
                    const isImage = attachment.type === 'image' || attachment.mimeType?.startsWith('image/')
                    const imageSrc = attachment.cid
                      ? `${IPFS_GATEWAY}${attachment.cid}`
                      : `data:${attachment.mimeType};base64,${attachment.data}`
                    return isImage ? (
                      <img
                        key={attachment.id}
                        src={imageSrc}
                        alt={attachment.name}
                        className="max-w-[200px] max-h-[200px] object-contain rounded border-2 border-juice-cyan cursor-pointer hover:opacity-90 transition-opacity"
                        onClick={() => {
                          if (attachment.cid) {
                            // Open IPFS URL directly in new tab
                            window.open(`${IPFS_GATEWAY}${attachment.cid}`, '_blank')
                          } else {
                            // Open data URI image in new tab (using DOM methods to avoid XSS)
                            const win = window.open()
                            if (win) {
                              const img = win.document.createElement('img')
                              img.src = `data:${attachment.mimeType};base64,${attachment.data}`
                              img.alt = attachment.name
                              img.style.maxWidth = '100%'
                              img.style.height = 'auto'
                              win.document.body.appendChild(img)
                            }
                          }
                        }}
                      />
                    ) : (
                      <div key={attachment.id} className="relative">
                        <div
                          ref={(el) => { if (el) attachmentRefs.current.set(attachment.id, el) }}
                          onClick={() => setDownloadPopoverAttachment(attachment)}
                          className={`inline-flex items-center gap-1.5 text-xs cursor-pointer transition-colors ${
                            isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'
                          }`}
                        >
                          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                          <span className="truncate max-w-[200px]">{attachment.name}</span>
                        </div>
                        {downloadPopoverAttachment?.id === attachment.id && (
                          <DownloadPopover
                            attachment={attachment}
                            onClose={() => setDownloadPopoverAttachment(null)}
                            isDark={isDark}
                            anchorRef={{ current: attachmentRefs.current.get(attachment.id) || null }}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              {parsed.segments.map((segment, index) => {
                if (segment.type === 'text') {
                  return (
                    <p key={index} className="whitespace-pre-wrap">{segment.content}</p>
                  )
                } else {
                  return (
                    <div key={index} className="my-3">
                      <ComponentRegistry component={segment.component} chatId={chatId} messageId={message.id} userResponse={userResponse} messageIsStreaming={message.isStreaming} />
                    </div>
                  )
                }
              })}
            </div>
            {/* Sender fruit emoji - clickable to show member info */}
            {senderMember ? (
              <div
                className="shrink-0 pt-0.5 text-lg leading-none cursor-pointer hover:scale-110 transition-transform"
                onClick={(e) => {
                  e.stopPropagation()
                  const rect = e.currentTarget.getBoundingClientRect()
                  setMemberPopover({ rect })
                }}
              >
                {getEmojiForUser(message.senderAddress, currentUserAddress, selectedFruit, senderMember.customEmoji)}
              </div>
            ) : (
              <div className="shrink-0 pt-0.5 text-lg leading-none">
                {/* Use cached identity emoji for current user when member data not loaded */}
                {getEmojiForUser(
                  message.senderAddress,
                  currentUserAddress,
                  selectedFruit,
                  message.senderAddress?.toLowerCase() === currentUserAddress?.toLowerCase() ? cachedIdentityEmoji : undefined
                )}
              </div>
            )}

            {/* Member info popover */}
            {memberPopover && senderMember && (
              <MemberPopover
                member={senderMember}
                emoji={getEmojiForUser(message.senderAddress, currentUserAddress, selectedFruit, senderMember.customEmoji)}
                isOnline={!!onlineMembers?.some(a => a?.toLowerCase() === senderMember.address?.toLowerCase())}
                onClose={() => setMemberPopover(null)}
                anchorRect={memberPopover.rect}
                isDark={isDark}
                chatId={chatId}
                currentUserMember={currentUserMember}
                onMemberUpdated={onMemberUpdated}
              />
            )}
          </div>
        </div>
      ) : (
        /* Assistant message */
        <div className={`w-full bg-transparent px-1 py-2 sm:px-4 sm:py-3 ${isDark ? 'text-white' : 'text-gray-900'}`}>
          <div className="flex items-start gap-2 sm:gap-3">
            {/* Lightning bolt for AI - flickers when streaming */}
            <div
              className="shrink-0 pt-0.5 text-lg leading-none"
              style={message.isStreaming ? {
                animation: 'lightning 2.5s ease-in-out infinite',
              } : undefined}
            >
              ⚡️
            </div>
            {message.isStreaming && (
              <style>{`
                @keyframes lightning {
                  0%, 100% { opacity: 0.3; }
                  8% { opacity: 0.3; }
                  9% { opacity: 1; }
                  10% { opacity: 0.15; }
                  11% { opacity: 0.6; }
                  12% { opacity: 0.3; }
                  25% { opacity: 0.3; }
                  26% { opacity: 1; }
                  27% { opacity: 0.2; }
                  28% { opacity: 0.9; }
                  29% { opacity: 0.15; }
                  31% { opacity: 0.3; }
                  45% { opacity: 0.3; }
                  46% { opacity: 1; }
                  48% { opacity: 0.2; }
                  50% { opacity: 0.3; }
                  65% { opacity: 0.3; }
                  66% { opacity: 1; }
                  67% { opacity: 0.15; }
                  68% { opacity: 0.85; }
                  69% { opacity: 0.1; }
                  70% { opacity: 0.95; }
                  71% { opacity: 0.2; }
                  73% { opacity: 0.3; }
                  88% { opacity: 0.3; }
                  89% { opacity: 0.8; }
                  91% { opacity: 0.3; }
                }
              `}</style>
            )}
            {/* Message content */}
            <div className="flex-1 min-w-0">
          {parsed.segments.map((segment, index) => {
            if (segment.type === 'text') {
              return (
                <div key={index} className="prose-juice">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeRaw]}
                    components={{
                      code({ className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || '')
                        const inline = !match
                        return !inline && match ? (
                          <SyntaxHighlighter
                            style={oneDark}
                            language={match[1]}
                            PreTag="div"
                            customStyle={{
                              margin: 0,
                              borderRadius: 0,
                              fontSize: '0.875rem',
                            }}
                          >
                            {String(children).replace(/\n$/, '')}
                          </SyntaxHighlighter>
                        ) : (
                          <code className={className} {...props}>
                            {children}
                          </code>
                        )
                      },
                    }}
                  >
                    {segment.content}
                  </ReactMarkdown>
                </div>
              )
            } else {
              return (
                <div key={index} className="my-3">
                  <ComponentRegistry component={segment.component} chatId={chatId} messageId={message.id} userResponse={userResponse} messageIsStreaming={message.isStreaming} />
                </div>
              )
            }
          })}

          {/* Streaming indicator with juice-themed verbs */}
          {message.isStreaming && (
            <ThinkingIndicator />
          )}

          {/* Nudge button when AI response appears to have stalled */}
          {showContinue && (
            <button
              onClick={handleContinue}
              className={`mt-4 px-4 py-2 text-sm transition-colors ${
                isDark
                  ? 'text-juice-orange/80 border border-juice-orange/30 hover:text-juice-orange hover:border-juice-orange/50 hover:bg-juice-orange/5'
                  : 'text-juice-orange border border-juice-orange/40 hover:border-juice-orange/60 hover:bg-juice-orange/5'
              }`}
            >
              Nudge AI
            </button>
          )}

          {/* Retry button for error messages */}
          {showRetry && (
            <button
              onClick={handleRetry}
              className={`mt-4 px-4 py-2 text-sm transition-colors ${
                isDark
                  ? 'text-green-400/80 border border-green-400/30 hover:text-green-400 hover:border-green-400/50 hover:bg-green-400/5'
                  : 'text-green-600 border border-green-500/40 hover:border-green-500/60 hover:bg-green-500/5'
              }`}
            >
              Try again
            </button>
          )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
