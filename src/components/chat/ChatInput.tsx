import { useState, useRef, useEffect, KeyboardEvent, ChangeEvent, ClipboardEvent, DragEvent } from 'react'
import { useAccount, useDisconnect, useSignMessage, useChainId } from 'wagmi'
import { useThemeStore, useAuthStore } from '../../stores'
import { useWalletBalances, formatEthBalance, formatUsdcBalance, useEnsNameResolved } from '../../hooks'
import { hasValidWalletSession, clearWalletSession, signInWithWallet, getWalletSession } from '../../services/siwe'
import { getPasskeyWallet, clearPasskeyWallet } from '../../services/passkeyWallet'
import { getSessionId } from '../../services/session'
import { getEmojiFromAddress } from './ParticipantAvatars'
import { JuicyIdPopover, type JuicyIdentity, type AnchorPosition } from './WalletInfo'
import type { Attachment } from '../../stores'

const INITIAL_PLACEHOLDER = "What's your juicy vision?"

const PLACEHOLDER_PHRASES = [
  // Questions & prompts
  'What project are you curious about?',
  'Any treasury moves on your mind?',
  'Which revnet catches your eye?',
  'Got a project ID to explore?',
  'Wanna check some token economics?',
  // Playful juice theme
  'Fresh squeeze incoming...',
  'Pour another thought...',
  'Extra pulp welcome...',
  'Got more juice?',
  'Keep it flowing...',
  'What else is brewing?',
  // Action-oriented
  'Ready to pay a project?',
  'Need to cash out some tokens?',
  'Looking for payout splits?',
  'Checking on a treasury?',
  // Casual vibes
  "What's next?",
  "I'm listening...",
  'Hit me with it...',
  'Go on...',
  'Tell me more...',
]

// Interval for cycling placeholder (in ms)
const PLACEHOLDER_CYCLE_INTERVAL = 4000

interface ChatInputProps {
  onSend: (message: string, attachments?: Attachment[]) => void
  disabled?: boolean
  placeholder?: string
  hideBorder?: boolean
  hideWalletInfo?: boolean
  compact?: boolean
  showDockButtons?: boolean
  onThemeClick?: () => void
  onSettingsClick?: () => void
  walletInfoRightContent?: React.ReactNode
  onConnectedAsClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
}

const generateId = () => Math.random().toString(36).substring(2, 15)

export default function ChatInput({ onSend, disabled, placeholder, hideBorder, hideWalletInfo, compact, showDockButtons, onThemeClick, onSettingsClick, walletInfoRightContent, onConnectedAsClick }: ChatInputProps) {
  const [input, setInput] = useState('')
  const [isFirstLoad, setIsFirstLoad] = useState(true)
  const [placeholderIndex, setPlaceholderIndex] = useState(() =>
    Math.floor(Math.random() * PLACEHOLDER_PHRASES.length)
  )
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [passkeyWallet, setPasskeyWallet] = useState(() => getPasskeyWallet())
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { theme, toggleTheme } = useThemeStore()
  const { token: authToken, _hasHydrated } = useAuthStore()
  const { address, isConnected } = useAccount()
  const { ensName } = useEnsNameResolved(address)
  const { disconnect } = useDisconnect()
  const { signMessageAsync } = useSignMessage()
  const chainId = useChainId()
  const [signing, setSigning] = useState(false)
  const [signedIn, setSignedIn] = useState(() => hasValidWalletSession())
  const { totalEth, totalUsdc, loading: balancesLoading } = useWalletBalances()
  // Fetch balances for passkey wallet address
  const { totalEth: passkeyEth, totalUsdc: passkeyUsdc, loading: passkeyBalancesLoading } = useWalletBalances(passkeyWallet?.address)

  // Juicy ID state
  const [identity, setIdentity] = useState<JuicyIdentity | null>(null)
  const [juicyIdPopoverOpen, setJuicyIdPopoverOpen] = useState(false)
  const [juicyIdAnchorPosition, setJuicyIdAnchorPosition] = useState<AnchorPosition | null>(null)

  // Fetch Juicy ID
  useEffect(() => {
    const fetchIdentity = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || ''
        const sessionId = getSessionId()
        const walletSession = getWalletSession()
        const headers: Record<string, string> = {
          'X-Session-ID': sessionId,
        }
        if (authToken) {
          headers['Authorization'] = `Bearer ${authToken}`
        }
        if (walletSession?.token) {
          headers['X-Wallet-Session'] = walletSession.token
        }
        const res = await fetch(`${apiUrl}/identity/me`, { headers })
        if (res.ok) {
          const data = await res.json()
          if (data.success && data.data) {
            setIdentity(data.data)
            // Notify other components of the loaded identity
            window.dispatchEvent(new CustomEvent('juice:identity-changed', { detail: data.data }))
          }
        }
      } catch {
        // Ignore errors
      }
    }
    fetchIdentity()
  }, [address, passkeyWallet?.address, authToken, _hasHydrated])

  // Listen for identity changes from other components
  useEffect(() => {
    const handleIdentityChange = (e: CustomEvent<JuicyIdentity>) => {
      setIdentity(e.detail)
    }
    window.addEventListener('juice:identity-changed', handleIdentityChange as EventListener)
    return () => window.removeEventListener('juice:identity-changed', handleIdentityChange as EventListener)
  }, [])

  // Get display identity: Juicy ID > ENS > null (no emoji fallback)
  const getDisplayIdentity = (addr: string | undefined) => {
    if (identity) return identity.formatted
    if (ensName) return ensName
    return null // Don't show emoji - will show "Set your Juicy ID" prompt instead
  }

  const currentPlaceholder = placeholder || (isFirstLoad ? INITIAL_PLACEHOLDER : PLACEHOLDER_PHRASES[placeholderIndex])

  // Pick a new random placeholder (different from current)
  const rotatePlaceholder = () => {
    setPlaceholderIndex(prev => {
      let next = Math.floor(Math.random() * PLACEHOLDER_PHRASES.length)
      while (next === prev && PLACEHOLDER_PHRASES.length > 1) {
        next = Math.floor(Math.random() * PLACEHOLDER_PHRASES.length)
      }
      return next
    })
  }

  // Auto-cycle placeholder when input is empty and not first load
  useEffect(() => {
    if (isFirstLoad || input.trim() || disabled) return

    const interval = setInterval(() => {
      rotatePlaceholder()
    }, PLACEHOLDER_CYCLE_INTERVAL)

    return () => clearInterval(interval)
  }, [isFirstLoad, input, disabled])

  // Handle file selection
  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    // Supported file types
    const imageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    const documentTypes = ['application/pdf', 'text/plain', 'text/markdown', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']

    Array.from(files).forEach(file => {
      const isImage = file.type.startsWith('image/') || imageTypes.includes(file.type)
      const isDocument = documentTypes.includes(file.type)

      if (!isImage && !isDocument) return

      const reader = new FileReader()
      reader.onload = (event) => {
        const base64 = event.target?.result as string
        // Remove the data:xxx;base64, prefix
        const data = base64.split(',')[1]

        const attachment: Attachment = {
          id: generateId(),
          type: isImage ? 'image' : 'document',
          name: file.name,
          mimeType: file.type,
          data,
        }
        setAttachments(prev => [...prev, attachment])
      }
      reader.readAsDataURL(file)
    })

    // Reset input so same file can be selected again
    e.target.value = ''
  }

  // Remove attachment
  const handleRemoveAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id))
  }

  // Drag state for visual feedback
  const [isDragging, setIsDragging] = useState(false)

  // Process files from paste or drag-drop
  const processFiles = (files: FileList | File[]) => {
    const imageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    const documentTypes = ['application/pdf', 'text/plain', 'text/markdown', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']

    Array.from(files).forEach(file => {
      const isImage = file.type.startsWith('image/') || imageTypes.includes(file.type)
      const isDocument = documentTypes.includes(file.type)

      if (!isImage && !isDocument) return

      const reader = new FileReader()
      reader.onload = (event) => {
        const base64 = event.target?.result as string
        const data = base64.split(',')[1]

        const attachment: Attachment = {
          id: generateId(),
          type: isImage ? 'image' : 'document',
          name: file.name,
          mimeType: file.type,
          data,
        }
        setAttachments(prev => [...prev, attachment])
      }
      reader.readAsDataURL(file)
    })
  }

  // Handle paste - check for images in clipboard
  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (!items) return

    const imageItems: File[] = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          // Generate a name for pasted images
          const ext = item.type.split('/')[1] || 'png'
          const namedFile = new File([file], `pasted-image-${Date.now()}.${ext}`, { type: item.type })
          imageItems.push(namedFile)
        }
      }
    }

    if (imageItems.length > 0) {
      e.preventDefault() // Prevent pasting image data as text
      processFiles(imageItems)
    }
  }

  // Drag and drop handlers
  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only set to false if leaving the actual drop zone (not entering a child)
    if (e.currentTarget === e.target) {
      setIsDragging(false)
    }
  }

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const files = e.dataTransfer?.files
    if (files && files.length > 0) {
      processFiles(files)
    }
  }

  // Max 5 lines then scroll (line-height ~24px, so ~120px max)
  const maxHeight = 120
  const minHeight = 48

  useEffect(() => {
    if (textareaRef.current) {
      // Only auto-resize when there's content, otherwise use min height
      if (input.trim()) {
        textareaRef.current.style.height = 'auto'
        const scrollHeight = textareaRef.current.scrollHeight
        const newHeight = Math.min(scrollHeight, maxHeight)
        textareaRef.current.style.height = `${newHeight}px`
        // Only enable scrolling when content exceeds max height
        textareaRef.current.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden'
      } else {
        textareaRef.current.style.height = `${minHeight}px`
        textareaRef.current.style.overflowY = 'hidden'
      }
    }
  }, [input])

  // Listen for prefill events from components (e.g., "Something else" option)
  useEffect(() => {
    const handlePrefill = (event: CustomEvent<{ text: string; focus?: boolean }>) => {
      if (event.detail?.text) {
        setInput(event.detail.text)
        setIsFirstLoad(false)
        if (event.detail.focus && textareaRef.current) {
          textareaRef.current.focus()
          // Move cursor to end of text
          setTimeout(() => {
            if (textareaRef.current) {
              textareaRef.current.selectionStart = textareaRef.current.value.length
              textareaRef.current.selectionEnd = textareaRef.current.value.length
            }
          }, 0)
        }
      }
    }

    window.addEventListener('juice:prefill-prompt', handlePrefill as EventListener)
    return () => {
      window.removeEventListener('juice:prefill-prompt', handlePrefill as EventListener)
    }
  }, [])

  // Listen for passkey wallet changes
  useEffect(() => {
    const handlePasskeyChange = () => {
      setPasskeyWallet(getPasskeyWallet())
    }
    // Listen for connect/disconnect events
    window.addEventListener('juice:passkey-connected', handlePasskeyChange)
    window.addEventListener('juice:passkey-disconnected', handlePasskeyChange)
    // Also check on storage changes (for multi-tab sync)
    window.addEventListener('storage', handlePasskeyChange)
    return () => {
      window.removeEventListener('juice:passkey-connected', handlePasskeyChange)
      window.removeEventListener('juice:passkey-disconnected', handlePasskeyChange)
      window.removeEventListener('storage', handlePasskeyChange)
    }
  }, [])

  // Listen for file upload trigger from drop zone buttons
  useEffect(() => {
    const handleTriggerUpload = () => {
      fileInputRef.current?.click()
    }
    window.addEventListener('juice:trigger-file-upload', handleTriggerUpload)
    return () => {
      window.removeEventListener('juice:trigger-file-upload', handleTriggerUpload)
    }
  }, [])

  const handleSend = () => {
    const trimmed = input.trim()
    const hasContent = trimmed || attachments.length > 0
    if (hasContent && !disabled) {
      onSend(trimmed, attachments.length > 0 ? attachments : undefined)
      setInput('')
      setAttachments([])
      setIsFirstLoad(false)
      rotatePlaceholder()
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Handle SIWE sign-in to enable chat saving
  const handleSignIn = async () => {
    if (!address || signing) return
    setSigning(true)
    try {
      await signInWithWallet(address, chainId, async (message) => {
        return await signMessageAsync({ message })
      })
      setSignedIn(true)
    } catch (err) {
      console.error('Sign-in failed:', err)
    } finally {
      setSigning(false)
    }
  }

  return (
    <div className={`${compact ? 'py-4 px-6' : 'pt-8 px-6 pb-12'} ${
      theme === 'dark'
        ? `${hideBorder ? 'bg-transparent' : 'bg-juice-dark/95'}`
        : `${hideBorder ? 'bg-transparent' : 'bg-white/95'}`
    }`}>
      {/* Attachment previews - subtle inline tags */}
      {attachments.length > 0 && (
        <div className="flex gap-3 mb-2 flex-wrap">
          {attachments.map(attachment => (
              <div
                key={attachment.id}
                className={`inline-flex items-center gap-1.5 text-xs ${
                  theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                }`}
              >
                <span className="truncate max-w-[200px]">{attachment.name}</span>
                <button
                  onClick={() => handleRemoveAttachment(attachment.id)}
                  className={`shrink-0 transition-colors ${
                    theme === 'dark'
                      ? 'text-gray-500 hover:text-gray-300'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              </div>
            ))}
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf,.txt,.md,.doc,.docx"
        onChange={handleFileSelect}
        className="hidden"
        multiple
      />

      {/* Theme and Settings buttons - above input */}
      {showDockButtons && (
        <div className="flex justify-end gap-2 mb-2">
          <button
            onClick={onThemeClick || toggleTheme}
            className={`p-1.5 transition-colors ${
              theme === 'dark'
                ? 'text-gray-500 hover:text-gray-300'
                : 'text-gray-400 hover:text-gray-600'
            }`}
            title="Toggle theme"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          </button>
          <button
            onClick={onSettingsClick}
            className={`p-1.5 transition-colors ${
              theme === 'dark'
                ? 'text-gray-500 hover:text-gray-300'
                : 'text-gray-400 hover:text-gray-600'
            }`}
            title="Settings"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      )}

      <div
        className={`relative flex gap-3 items-start transition-all ${
          isDragging
            ? theme === 'dark'
              ? 'ring-2 ring-juice-cyan ring-offset-2 ring-offset-juice-dark rounded'
              : 'ring-2 ring-juice-cyan ring-offset-2 ring-offset-white rounded'
            : ''
        }`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={currentPlaceholder}
          disabled={disabled}
          rows={1}
          autoFocus
          className={`flex-1 border-2 border-juice-cyan px-4 pt-[11px] pb-[15px] focus:outline-none focus:border-[3px] focus:px-[15px] focus:pt-[10px] focus:pb-[14px] resize-none font-semibold leading-tight overflow-y-hidden hide-scrollbar ${
            theme === 'dark'
              ? 'bg-white/5 text-white placeholder-white/70'
              : 'bg-black/5 text-gray-900 placeholder-gray-900/50'
          }`}
          style={{ minHeight: '48px' }}
        />
        {/* Drag overlay */}
        {isDragging && (
          <div className={`absolute inset-0 flex items-center justify-center pointer-events-none ${
            theme === 'dark' ? 'bg-juice-dark/80' : 'bg-white/80'
          }`}>
            <span className={`text-sm font-medium ${
              theme === 'dark' ? 'text-juice-cyan' : 'text-juice-cyan'
            }`}>
              Drop files here
            </span>
          </div>
        )}
      </div>

      {/* Wallet status display */}
      {!hideWalletInfo && (
        <div className="mt-3">
          <div className={`text-xs ${
            theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
          }`}>
            <div className="flex items-center justify-between">
              <div>
            {isConnected && address ? (
              <>
                <button
                  onClick={onConnectedAsClick}
                  className={`inline-flex items-center gap-1.5 transition-colors ${
                    onConnectedAsClick
                      ? theme === 'dark'
                        ? 'hover:text-white'
                        : 'hover:text-gray-600'
                      : ''
                  }`}
                >
                  {signedIn ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" title="Signed in" />
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full border border-current opacity-50" title="Not signed in" />
                  )}
                  {getDisplayIdentity(address) ? (
                    <>Connected as {getDisplayIdentity(address)}</>
                  ) : (
                    <>Connected</>
                  )}
                </button>
                {!identity && (
                  <button
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect()
                      setJuicyIdAnchorPosition({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
                      setJuicyIdPopoverOpen(true)
                    }}
                    className={`ml-1 transition-colors ${
                      theme === 'dark'
                        ? 'text-juice-orange/70 hover:text-juice-orange'
                        : 'text-juice-orange/80 hover:text-juice-orange'
                    }`}
                  >
                    · Set your Juicy ID
                  </button>
                )}
                {/* Sign to save button - only show if not signed in */}
                {!signedIn && (
                  <button
                    onClick={handleSignIn}
                    disabled={signing}
                    className={`ml-2 transition-colors ${
                      theme === 'dark'
                        ? 'text-green-400 hover:text-green-300'
                        : 'text-green-600 hover:text-green-500'
                    } ${signing ? 'opacity-50' : ''}`}
                  >
                    · {signing ? 'Signing...' : 'Sign to save'}
                  </button>
                )}
                {!balancesLoading && (totalEth > 0n || totalUsdc > 0n) && (
                  <span className="ml-2">
                    · {formatUsdcBalance(totalUsdc)} USDC · {formatEthBalance(totalEth)} ETH
                  </span>
                )}
                <button
                  onClick={() => {
                    clearWalletSession()
                    setSignedIn(false)
                    disconnect()
                  }}
                  className={`ml-2 transition-colors ${
                    theme === 'dark'
                      ? 'text-gray-600 hover:text-gray-400'
                      : 'text-gray-300 hover:text-gray-500'
                  }`}
                >
                  · Disconnect
                </button>
              </>
            ) : passkeyWallet ? (
              <>
                <button
                  onClick={onConnectedAsClick}
                  className={`inline-flex items-center gap-1.5 transition-colors ${
                    onConnectedAsClick
                      ? theme === 'dark'
                        ? 'hover:text-white'
                        : 'hover:text-gray-600'
                      : ''
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" title="Passkey wallet" />
                  {getDisplayIdentity(passkeyWallet.address) ? (
                    <>Connected as {getDisplayIdentity(passkeyWallet.address)}</>
                  ) : (
                    <>Connected</>
                  )}
                </button>
                {!identity && (
                  <button
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect()
                      setJuicyIdAnchorPosition({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
                      setJuicyIdPopoverOpen(true)
                    }}
                    className={`ml-1 transition-colors ${
                      theme === 'dark'
                        ? 'text-juice-orange/70 hover:text-juice-orange'
                        : 'text-juice-orange/80 hover:text-juice-orange'
                    }`}
                  >
                    · Set your Juicy ID
                  </button>
                )}
                {!passkeyBalancesLoading && (passkeyEth > 0n || passkeyUsdc > 0n) && (
                  <span className="ml-2">
                    · {formatUsdcBalance(passkeyUsdc)} USDC · {formatEthBalance(passkeyEth)} ETH
                  </span>
                )}
                <button
                  onClick={() => {
                    clearPasskeyWallet()
                    setPasskeyWallet(null)
                  }}
                  className={`ml-2 transition-colors ${
                    theme === 'dark'
                      ? 'text-gray-600 hover:text-gray-400'
                      : 'text-gray-300 hover:text-gray-500'
                  }`}
                >
                  · Disconnect
                </button>
              </>
            ) : (
              <button
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  window.dispatchEvent(new CustomEvent('juice:open-auth-modal', {
                    detail: {
                      anchorPosition: {
                        top: rect.top,
                        left: rect.left,
                        width: rect.width,
                        height: rect.height,
                      }
                    }
                  }))
                }}
                className="inline-flex items-center gap-1.5 transition-colors hover:text-gray-300"
              >
                <span className="w-1.5 h-1.5 rounded-full border border-current opacity-50" />
                Account not yet connected
              </button>
            )}
              </div>
              {walletInfoRightContent}
            </div>
          </div>
        </div>
      )}

      {/* Juicy ID Popover */}
      <JuicyIdPopover
        isOpen={juicyIdPopoverOpen}
        onClose={() => setJuicyIdPopoverOpen(false)}
        anchorPosition={juicyIdAnchorPosition}
        onWalletClick={() => {
          window.dispatchEvent(new CustomEvent('juice:open-wallet-panel', {
            detail: { anchorPosition: juicyIdAnchorPosition }
          }))
        }}
        onIdentitySet={(newIdentity) => setIdentity(newIdentity)}
      />
    </div>
  )
}
