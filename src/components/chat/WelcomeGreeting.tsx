import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useThemeStore } from '../../stores'

const GREETING_KEYS = [
  'alrightLetsGo',
  'goodYoureHere',
  'dontJustStandThere',
  'wellLetsSeeIt',
  'soTellMe',
  'thereYouAre',
  'finally',
  'ohGoodYouMadeIt',
  'letsGetToWork',
  'rightOnTime',
  'lookWhoShowedUp',
  'showMeWhatYouGot',
  'letsMakeItHappen',
  'readyToSqueeze',
  'yourMove',
]

export default function WelcomeGreeting() {
  const { theme } = useThemeStore()
  const { t } = useTranslation()
  const [greetingKey] = useState(() => GREETING_KEYS[Math.floor(Math.random() * GREETING_KEYS.length)])

  return (
    <div className="flex gap-3 px-6 pb-1">
      {/* Spacer to align with textarea */}
      <div className="w-[48px] shrink-0" />
      <div className={`text-sm font-medium ${
        theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
      }`}>
        {t(`greetings.${greetingKey}`)}
      </div>
    </div>
  )
}
