import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './locales/en.json'
import pt from './locales/pt.json'
import zh from './locales/zh.json'
import es from './locales/es.json'

export const supportedLanguages = {
  en: { name: 'English', nativeName: 'English' },
  zh: { name: 'Chinese', nativeName: '中文' },
  pt: { name: 'Portuguese', nativeName: 'Português' },
  es: { name: 'Spanish', nativeName: 'Español' },
} as const

export type SupportedLanguage = keyof typeof supportedLanguages

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      pt: { translation: pt },
      zh: { translation: zh },
      es: { translation: es },
    },
    fallbackLng: 'en',
    supportedLngs: Object.keys(supportedLanguages),
    interpolation: {
      escapeValue: false, // React already escapes
    },
  })

// Function to change language (called from settings store)
export function changeLanguage(lang: string) {
  i18n.changeLanguage(lang)
}

export default i18n
