import { useState } from 'react'
import { useThemeStore } from '../../stores'

const GREETINGS = [
  // Coach energy
  'Alright, let\'s go.',
  'Good, you\'re here.',
  'Don\'t just stand there.',
  'Well? Let\'s see it.',
  'So tell me.',
  // Coach who noticed you showed up just on time
  'There you are.',
  'Finally.',
  'Oh good, you made it.',
  'Let\'s get to work.',
  'Right on time.',
  'Look who showed up.',
  // Confident, direct
  'Show me what you got.',
  'Let\'s make it happen.',
  'Ready to squeeze?',
  'Your move.',
]

export default function WelcomeGreeting() {
  const { theme } = useThemeStore()
  const [greeting] = useState(() => GREETINGS[Math.floor(Math.random() * GREETINGS.length)])

  return (
    <div className="flex gap-3 px-6 pb-3">
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
