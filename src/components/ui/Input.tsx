import { forwardRef, InputHTMLAttributes, ReactNode } from 'react'
import { useThemeStore } from '../../stores'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  icon?: ReactNode
  rightElement?: ReactNode
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, icon, rightElement, className = '', ...props }, ref) => {
    const { theme } = useThemeStore()

    return (
      <div className="w-full">
        {label && (
          <label className={`block text-sm font-medium mb-1.5 ${
            theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
          }`}>
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <div className={`absolute left-3 top-1/2 -translate-y-1/2 ${
              theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
            }`}>
              {icon}
            </div>
          )}
          <input
            ref={ref}
            className={`
              w-full border px-4 py-2.5
              focus:outline-none transition-colors duration-200
              disabled:opacity-50 disabled:cursor-not-allowed
              ${theme === 'dark'
                ? 'bg-juice-dark-lighter border-white/10 text-white placeholder-gray-500 focus:border-white/30'
                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-gray-400'
              }
              ${icon ? 'pl-10' : ''}
              ${rightElement ? 'pr-10' : ''}
              ${error ? 'border-red-500 focus:ring-red-500/50 focus:border-red-500' : ''}
              ${className}
            `}
            {...props}
          />
          {rightElement && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              {rightElement}
            </div>
          )}
        </div>
        {error && (
          <p className="mt-1.5 text-sm text-red-400">{error}</p>
        )}
      </div>
    )
  }
)

Input.displayName = 'Input'

export default Input
