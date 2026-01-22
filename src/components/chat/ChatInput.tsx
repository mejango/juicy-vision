import { useState, useRef, useEffect, KeyboardEvent, ChangeEvent } from 'react'
import { useAccount, useDisconnect, useSignMessage, useChainId } from 'wagmi'
import { useThemeStore } from '../../stores'
import { useWalletBalances, formatEthBalance, formatUsdcBalance, useEnsNameResolved } from '../../hooks'
import { hasValidWalletSession, clearWalletSession, signInWithWallet } from '../../services/siwe'
import { getPasskeyWallet, clearPasskeyWallet } from '../../services/passkeyWallet'
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
}

const generateId = () => Math.random().toString(36).substring(2, 15)

// Shorten address for display
function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`
}

export default function ChatInput({ onSend, disabled, placeholder, hideBorder, hideWalletInfo, compact, showDockButtons, onThemeClick, onSettingsClick }: ChatInputProps) {
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

    Array.from(files).forEach(file => {
      // Only accept images
      if (!file.type.startsWith('image/')) return

      const reader = new FileReader()
      reader.onload = (event) => {
        const base64 = event.target?.result as string
        // Remove the data:image/xxx;base64, prefix
        const data = base64.split(',')[1]

        const attachment: Attachment = {
          id: generateId(),
          type: 'image',
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

  // Max 5 lines then scroll (line-height ~24px, so ~120px max)
  const maxHeight = 120

  useEffect(() => {
    if (textareaRef.current) {
      // Only auto-resize when there's content, otherwise use min height
      if (input.trim()) {
        textareaRef.current.style.height = 'auto'
        const scrollHeight = textareaRef.current.scrollHeight
        textareaRef.current.style.height = `${Math.min(scrollHeight, maxHeight)}px`
      } else {
        textareaRef.current.style.height = '48px'
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
      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="flex gap-2 mb-3 flex-wrap">
          {attachments.map(attachment => (
            <div key={attachment.id} className="relative group">
              <img
                src={`data:${attachment.mimeType};base64,${attachment.data}`}
                alt={attachment.name}
                className="w-16 h-16 object-cover rounded border-2 border-juice-cyan"
              />
              <button
                onClick={() => handleRemoveAttachment(attachment.id)}
                className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full
                           flex items-center justify-center text-xs font-bold
                           opacity-0 group-hover:opacity-100 transition-opacity"
              >
                ×
              </button>
              <span className={`absolute bottom-0 left-0 right-0 text-[10px] truncate px-1
                ${theme === 'dark' ? 'bg-black/70 text-white' : 'bg-white/70 text-gray-900'}`}>
                {attachment.name}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
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

      <div className="flex gap-3 items-start">
        {/* Attachment button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className={`p-3 h-[48px] w-[48px] transition-colors shrink-0 flex items-center justify-center
                     disabled:opacity-50 disabled:cursor-not-allowed border
                     ${theme === 'dark'
                       ? 'text-gray-400 hover:text-juice-cyan border-white/20'
                       : 'text-gray-500 hover:text-teal-600 border-gray-300'
                     }`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
        </button>

        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={currentPlaceholder}
          disabled={disabled}
          rows={1}
          autoFocus
          className={`flex-1 border-2 border-juice-cyan px-4 pt-[11px] pb-[15px] focus:outline-none focus:border-[3px] focus:px-[15px] focus:pt-[10px] focus:pb-[14px] resize-none font-semibold leading-tight overflow-y-auto hide-scrollbar ${
            theme === 'dark'
              ? 'bg-white/5 text-white placeholder-white/70'
              : 'bg-black/5 text-gray-900 placeholder-gray-900/50'
          }`}
          style={{ minHeight: '48px' }}
        />

      </div>

      {/* Wallet status display */}
      {!hideWalletInfo && (
        <div className="flex gap-3 mt-2 items-center">
          {/* Spacer to align with textarea */}
          <div className="w-[48px] shrink-0" />
          <div className={`flex-1 text-xs ${
            theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
          }`}>
            {isConnected && address ? (
              <>
                <span className="inline-flex items-center gap-1.5">
                  {signedIn ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" title="Signed in" />
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full border border-current opacity-50" title="Not signed in" />
                  )}
                  Connected as {ensName || shortenAddress(address)}
                </span>
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
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" title="Passkey wallet" />
                  Connected as {shortenAddress(passkeyWallet.address)}
                </span>
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
                onClick={() => window.dispatchEvent(new CustomEvent('juice:open-auth-modal'))}
                className="inline-flex items-center gap-1.5 transition-colors hover:text-gray-300"
              >
                <span className="w-1.5 h-1.5 rounded-full border border-current opacity-50" />
                Account not yet connected
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
