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
  'whatHaveYouGot',
  'letsGetToWork',
  'goOn',
  'lookWhoShowedUp',
  'showMeWhatYouGot',
  'makeItCount',
  'begin',
  'yourMove',
  'helloDarling',
  'helloChampion',
]

export default function WelcomeGreeting() {
  const { theme } = useThemeStore()
  const { t } = useTranslation()
  const [greetingKey] = useState(() => GREETING_KEYS[Math.floor(Math.random() * GREETING_KEYS.length)])

  return (
    <div className="px-6 pb-1">
      <div className={`text-sm font-medium ${
        theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
      }`}>
        {t(`greetings.${greetingKey}`)}
      </div>
    </div>
  )
}
