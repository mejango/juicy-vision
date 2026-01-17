import { forwardRef, ButtonHTMLAttributes, ReactNode } from 'react'
import { useThemeStore } from '../../stores'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: ReactNode
  children?: ReactNode
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, icon, children, className = '', disabled, ...props }, ref) => {
    const { theme } = useThemeStore()
    const baseStyles = 'inline-flex items-center justify-center font-medium transition-colors duration-200 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed'

    const darkVariants = {
      primary: 'bg-juice-cyan hover:bg-juice-cyan/90 text-juice-dark',
      secondary: 'bg-juice-dark-lighter hover:bg-white/10 text-white border border-white/20',
      outline: 'bg-transparent hover:bg-white/10 text-white border border-white',
      ghost: 'bg-transparent hover:bg-white/10 text-gray-300 hover:text-white',
      danger: 'bg-red-600 hover:bg-red-700 text-white',
    }

    const lightVariants = {
      primary: 'bg-juice-cyan hover:bg-juice-cyan/90 text-juice-dark',
      secondary: 'bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-300',
      outline: 'bg-transparent hover:bg-gray-100 text-gray-900 border border-gray-400',
      ghost: 'bg-transparent hover:bg-gray-100 text-gray-600 hover:text-gray-900',
      danger: 'bg-red-600 hover:bg-red-700 text-white',
    }

    const variants = theme === 'dark' ? darkVariants : lightVariants

    const sizes = {
      sm: 'px-3 py-1.5 text-sm gap-1.5',
      md: 'px-4 py-2 text-sm gap-2',
      lg: 'px-6 py-3 text-base gap-2',
    }

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
        {...props}
      >
        {loading ? (
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        ) : icon}
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'

export default Button
