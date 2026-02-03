import { useState, useCallback } from 'react'
import { useThemeStore } from '../../stores'
import { generateTierImage, type ImageGenerationContext } from '../../api/images'

interface GenerateImageButtonProps {
  /** Context for generating the image */
  context: {
    name: string
    description?: string
    projectTheme?: string
    style?: ImageGenerationContext['style']
  }
  /** Called when image generation succeeds */
  onGenerated: (ipfsUri: string, httpUrl: string) => void
  /** Called when generation fails */
  onError?: (error: Error) => void
  /** Visual variant */
  variant?: 'button' | 'overlay'
  /** Size variant */
  size?: 'sm' | 'md' | 'lg'
  /** Additional CSS classes */
  className?: string
}

type GenerationState = 'idle' | 'loading' | 'success' | 'error'

/**
 * A button that triggers AI image generation.
 *
 * Supports two variants:
 * - 'button': A regular button with sparkle icon
 * - 'overlay': A centered overlay button for placeholders
 */
export default function GenerateImageButton({
  context,
  onGenerated,
  onError,
  variant = 'button',
  size = 'md',
  className = '',
}: GenerateImageButtonProps) {
  const { theme } = useThemeStore()
  const [state, setState] = useState<GenerationState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleGenerate = useCallback(async () => {
    if (state === 'loading') return

    setState('loading')
    setErrorMessage(null)

    try {
      const result = await generateTierImage(
        context.name,
        context.description,
        context.projectTheme,
        context.style
      )

      setState('success')
      onGenerated(result.ipfsUri, result.httpUrl)

      // Reset to idle after showing success briefly
      setTimeout(() => setState('idle'), 1500)
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Generation failed')
      setState('error')
      setErrorMessage(err.message)
      onError?.(err)

      // Reset to idle after showing error
      setTimeout(() => setState('idle'), 3000)
    }
  }, [context, state, onGenerated, onError])

  // Sparkle icon
  const SparkleIcon = () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={`${size === 'sm' ? 'w-3.5 h-3.5' : size === 'md' ? 'w-4 h-4' : 'w-5 h-5'}`}
    >
      <path
        fillRule="evenodd"
        d="M9 4.5a.75.75 0 01.721.544l.813 2.846a3.75 3.75 0 002.576 2.576l2.846.813a.75.75 0 010 1.442l-2.846.813a3.75 3.75 0 00-2.576 2.576l-.813 2.846a.75.75 0 01-1.442 0l-.813-2.846a3.75 3.75 0 00-2.576-2.576l-2.846-.813a.75.75 0 010-1.442l2.846-.813A3.75 3.75 0 007.466 7.89l.813-2.846A.75.75 0 019 4.5zM18 1.5a.75.75 0 01.728.568l.258 1.036c.236.94.97 1.674 1.91 1.91l1.036.258a.75.75 0 010 1.456l-1.036.258c-.94.236-1.674.97-1.91 1.91l-.258 1.036a.75.75 0 01-1.456 0l-.258-1.036a2.625 2.625 0 00-1.91-1.91l-1.036-.258a.75.75 0 010-1.456l1.036-.258a2.625 2.625 0 001.91-1.91l.258-1.036A.75.75 0 0118 1.5zM16.5 15a.75.75 0 01.712.513l.394 1.183c.15.447.5.799.948.948l1.183.395a.75.75 0 010 1.422l-1.183.395c-.447.15-.799.5-.948.948l-.395 1.183a.75.75 0 01-1.422 0l-.395-1.183a1.5 1.5 0 00-.948-.948l-1.183-.395a.75.75 0 010-1.422l1.183-.395c.447-.15.799-.5.948-.948l.395-1.183A.75.75 0 0116.5 15z"
        clipRule="evenodd"
      />
    </svg>
  )

  // Spinner icon
  const SpinnerIcon = () => (
    <svg
      className={`animate-spin ${size === 'sm' ? 'w-3.5 h-3.5' : size === 'md' ? 'w-4 h-4' : 'w-5 h-5'}`}
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
        fill="none"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )

  // Check icon for success
  const CheckIcon = () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={`${size === 'sm' ? 'w-3.5 h-3.5' : size === 'md' ? 'w-4 h-4' : 'w-5 h-5'}`}
    >
      <path
        fillRule="evenodd"
        d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z"
        clipRule="evenodd"
      />
    </svg>
  )

  // Get icon based on state
  const getIcon = () => {
    switch (state) {
      case 'loading':
        return <SpinnerIcon />
      case 'success':
        return <CheckIcon />
      default:
        return <SparkleIcon />
    }
  }

  // Get label based on state
  const getLabel = () => {
    switch (state) {
      case 'loading':
        return 'Generating...'
      case 'success':
        return 'Done!'
      case 'error':
        return 'Retry'
      default:
        return 'Generate'
    }
  }

  // Size classes
  const sizeClasses = {
    sm: 'px-2 py-1 text-xs gap-1',
    md: 'px-3 py-1.5 text-sm gap-1.5',
    lg: 'px-4 py-2 text-base gap-2',
  }

  // Theme-aware colors
  const isDark = theme === 'dark'

  // Base button style
  const baseButtonStyle = `
    inline-flex items-center justify-center font-medium
    transition-all duration-200 rounded-lg
    focus:outline-none focus:ring-2 focus:ring-juice-cyan/50
    disabled:opacity-50 disabled:cursor-not-allowed
  `

  // Variant styles
  const buttonVariantStyle = isDark
    ? `bg-juice-dark-lighter hover:bg-juice-cyan/20 text-juice-cyan border border-juice-cyan/30
       hover:border-juice-cyan/50 hover:shadow-[0_0_12px_rgba(0,255,255,0.15)]`
    : `bg-gray-100 hover:bg-juice-cyan/10 text-juice-cyan border border-juice-cyan/30
       hover:border-juice-cyan/50`

  const overlayVariantStyle = isDark
    ? `bg-juice-dark/80 hover:bg-juice-dark/90 text-juice-cyan border border-juice-cyan/30
       backdrop-blur-sm hover:shadow-[0_0_20px_rgba(0,255,255,0.2)]`
    : `bg-white/80 hover:bg-white/90 text-juice-cyan border border-juice-cyan/40
       backdrop-blur-sm shadow-lg hover:shadow-xl`

  // Error state style
  const errorStyle = state === 'error'
    ? 'border-red-500/50 text-red-400 hover:border-red-500/70'
    : ''

  // Success state style
  const successStyle = state === 'success'
    ? 'border-green-500/50 text-green-400'
    : ''

  if (variant === 'overlay') {
    return (
      <div className={`absolute inset-0 flex items-center justify-center ${className}`}>
        <button
          onClick={handleGenerate}
          disabled={state === 'loading'}
          className={`
            ${baseButtonStyle}
            ${overlayVariantStyle}
            ${errorStyle}
            ${successStyle}
            ${sizeClasses[size]}
            group
          `}
          title={state === 'error' ? errorMessage || 'Generation failed' : 'Generate with AI'}
        >
          <span className={state === 'idle' ? 'group-hover:animate-pulse' : ''}>
            {getIcon()}
          </span>
          <span>{getLabel()}</span>
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={handleGenerate}
      disabled={state === 'loading'}
      className={`
        ${baseButtonStyle}
        ${buttonVariantStyle}
        ${errorStyle}
        ${successStyle}
        ${sizeClasses[size]}
        ${className}
        group
      `}
      title={state === 'error' ? errorMessage || 'Generation failed' : 'Generate with AI'}
    >
      <span className={state === 'idle' ? 'group-hover:animate-pulse' : ''}>
        {getIcon()}
      </span>
      <span>{getLabel()}</span>
    </button>
  )
}
