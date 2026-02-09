import { ReactNode } from 'react'
import { useThemeStore } from '../../stores'

interface ExplainerMessageProps {
  children: ReactNode
}

export function ExplainerMessage({ children }: ExplainerMessageProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  return (
    <div className={`flex items-start gap-3 p-4 rounded-lg ${
      isDark ? 'bg-white/5' : 'bg-gray-50'
    }`}>
      <span className="text-juice-orange text-lg shrink-0">💬</span>
      <p className={`text-sm leading-relaxed ${
        isDark ? 'text-gray-400' : 'text-gray-600'
      }`}>
        {children}
      </p>
    </div>
  )
}
