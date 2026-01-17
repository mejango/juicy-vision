import { useState, useRef, useEffect, KeyboardEvent } from 'react'
import { useThemeStore } from '../../stores'

interface ChatInputProps {
  onSend: (message: string) => void
  disabled?: boolean
  placeholder?: string
}

export default function ChatInput({ onSend, disabled, placeholder = 'Ask about Juicebox...' }: ChatInputProps) {
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { theme } = useThemeStore()

  // Max 5 lines then scroll (line-height ~24px, so ~120px max)
  const maxHeight = 120

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      const scrollHeight = textareaRef.current.scrollHeight
      textareaRef.current.style.height = `${Math.min(scrollHeight, maxHeight)}px`
    }
  }, [input])

  const handleSend = () => {
    const trimmed = input.trim()
    if (trimmed && !disabled) {
      onSend(trimmed)
      setInput('')
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
          placeholder={placeholder}
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
          className="p-3 bg-juice-cyan text-juice-dark
                     hover:bg-juice-cyan/90 transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed
                     shrink-0"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
        </button>
      </div>
    </div>
  )
}
