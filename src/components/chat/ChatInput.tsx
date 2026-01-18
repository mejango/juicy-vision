import { useState, useRef, useEffect, KeyboardEvent } from 'react'
import { useThemeStore } from '../../stores'

const INITIAL_PLACEHOLDER = "What's your juicy vision?"

const PLACEHOLDER_PHRASES = [
  'Give it a squeeze...',
  'Add something juicy...',
  'Drop some juice...',
  'Pour your thoughts...',
  'Squeeze out an idea...',
  'Spill the juice...',
  'Fresh pressed thoughts...',
  'Ripe for the picking...',
  'Got pulp?',
  'Blend something up...',
  'From concentrate...',
  'Extra pulp welcome...',
]

interface ChatInputProps {
  onSend: (message: string) => void
  disabled?: boolean
  placeholder?: string
}

export default function ChatInput({ onSend, disabled, placeholder }: ChatInputProps) {
  const [input, setInput] = useState('')
  const [isFirstLoad, setIsFirstLoad] = useState(true)
  const [placeholderIndex, setPlaceholderIndex] = useState(() =>
    Math.floor(Math.random() * PLACEHOLDER_PHRASES.length)
  )
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { theme } = useThemeStore()

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

  // Max 5 lines then scroll (line-height ~24px, so ~120px max)
  const maxHeight = 120

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      const scrollHeight = textareaRef.current.scrollHeight
      textareaRef.current.style.height = `${Math.min(scrollHeight, maxHeight)}px`
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

  const handleSend = () => {
    const trimmed = input.trim()
    if (trimmed && !disabled) {
      onSend(trimmed)
      setInput('')
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

  return (
    <div className={`border-t pt-5 px-4 pb-8 backdrop-blur-md ${
      theme === 'dark'
        ? 'border-juice-cyan/20 bg-juice-dark/60'
        : 'border-juice-orange/40 bg-white/60'
    }`}>
      <div className="flex gap-3 mb-safe">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={currentPlaceholder}
          disabled={disabled}
          rows={1}
          autoFocus
          className={`flex-1 border-2 border-juice-cyan px-4 pt-3 pb-3.5 focus:outline-none focus:border-[3px] focus:px-[15px] focus:pt-[11px] focus:pb-[13px] resize-none font-semibold leading-6 overflow-y-auto hide-scrollbar ${
            theme === 'dark'
              ? 'bg-juice-dark-lighter text-white placeholder-white/70'
              : 'bg-white text-gray-900 placeholder-gray-900/50'
          }`}
          style={{ minHeight: '48px' }}
        />

        <button
          onClick={handleSend}
          disabled={!input.trim()}
          className="p-3 bg-juice-cyan text-black
                     hover:bg-juice-cyan/90 transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed
                     shrink-0"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3}
                  d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
        </button>
      </div>
    </div>
  )
}
