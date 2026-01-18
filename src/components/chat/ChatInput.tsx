import { useState, useRef, useEffect, KeyboardEvent, ChangeEvent } from 'react'
import { useThemeStore } from '../../stores'
import type { Attachment } from '../../stores/chatStore'

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
  onSend: (message: string, attachments?: Attachment[]) => void
  disabled?: boolean
  placeholder?: string
}

const generateId = () => Math.random().toString(36).substring(2, 15)

export default function ChatInput({ onSend, disabled, placeholder }: ChatInputProps) {
  const [input, setInput] = useState('')
  const [isFirstLoad, setIsFirstLoad] = useState(true)
  const [placeholderIndex, setPlaceholderIndex] = useState(() =>
    Math.floor(Math.random() * PLACEHOLDER_PHRASES.length)
  )
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
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

  return (
    <div className={`border-t pt-8 px-6 pb-12 backdrop-blur-md ${
      theme === 'dark'
        ? 'border-juice-cyan/20 bg-juice-dark/60'
        : 'border-juice-orange/40 bg-white/60'
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

      <div className="flex gap-3 mb-safe">
        {/* Attachment button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className={`p-3 border-2 border-juice-cyan transition-colors shrink-0
                     disabled:opacity-50 disabled:cursor-not-allowed
                     ${theme === 'dark'
                       ? 'bg-juice-dark-lighter text-white hover:bg-juice-dark'
                       : 'bg-white text-gray-900 hover:bg-gray-100'
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
              ? 'bg-juice-dark-lighter text-white placeholder-white/70'
              : 'bg-white text-gray-900 placeholder-gray-900/50'
          }`}
          style={{ minHeight: '48px' }}
        />

        <button
          onClick={handleSend}
          disabled={!input.trim() && attachments.length === 0}
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
