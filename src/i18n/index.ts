import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import en from './locales/en.json'
import pt from './locales/pt.json'

export const supportedLanguages = {
  en: { name: 'English', nativeName: 'English' },
  pt: { name: 'Portuguese', nativeName: 'Português' },
  // Future languages:
  // es: { name: 'Spanish', nativeName: 'Español' },
  // zh: { name: 'Chinese', nativeName: '中文' },
  // ja: { name: 'Japanese', nativeName: '日本語' },
  // de: { name: 'German', nativeName: 'Deutsch' },
  // fr: { name: 'French', nativeName: 'Français' },
  // it: { name: 'Italian', nativeName: 'Italiano' },
  // fa: { name: 'Persian', nativeName: 'فارسی', rtl: true },
} as const

export type SupportedLanguage = keyof typeof supportedLanguages

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      pt: { translation: pt },
    },
    fallbackLng: 'en',
    supportedLngs: Object.keys(supportedLanguages),
    interpolation: {
      escapeValue: false, // React already escapes
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  })

export default i18n
