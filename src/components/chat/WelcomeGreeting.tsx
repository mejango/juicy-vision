import { useState } from 'react'
import { useThemeStore } from '../../stores'

const GREETINGS = [
  'Welcome, darling.',
  'Welcome, champion.',
  'Welcome, dreamer.',
  'Hey there, visionary.',
  'There you are.',
  'Show me what you got.',
  'Let\'s make it happen.',
  'Ready to squeeze?',
  'Looking fresh.',
  'Your move.',
]

export default function WelcomeGreeting() {
  const { theme } = useThemeStore()
  const [greeting] = useState(() => GREETINGS[Math.floor(Math.random() * GREETINGS.length)])

  return (
    <div className="flex gap-3 px-6 mb-4">
      {/* Spacer to align with textarea */}
      <div className="w-[48px] shrink-0" />
      <div className={`text-sm font-medium ${
        theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
      }`}>
        {greeting}
      </div>
    </div>
  )
}
