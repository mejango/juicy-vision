import { ReactNode } from 'react'
import { useThemeStore } from '../../stores'

interface ExplainerMessageProps {
  children: ReactNode
}

export function ExplainerMessage({ children }: ExplainerMessageProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  return (
    <p className={`text-sm leading-relaxed ${
      isDark ? 'text-gray-400' : 'text-gray-600'
    }`}>
      {children}
    </p>
  )
}
