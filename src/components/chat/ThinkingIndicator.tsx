import { useState } from 'react'

// Juice and fruit-themed verbs for thinking states
// Get weird and fun with it - liberal creativity encouraged
const THINKING_VERBS = [
  'Squeezing',
  'Pulping',
  'Juicing',
  'Fermenting',
  'Zesting',
  'Blending',
  'Ripening',
  'Peeling',
  'Extracting',
  'Muddling',
  'Straining',
  'Macerating',
  'Pressing',
  'Infusing',
  'Distilling',
  'Concentrating',
  'Sweetening',
  'Garnishing',
  'Citrus-ing',
  'Nectaring',
  'Smoothie-fying',
  'Marinating',
  'Caramelizing',
  'Puréeing',
  'Simmering',
  'Reducing',
  'Drizzling',
  'Taste-testing',
  'Bottling',
  'Uncorking',
]

export default function ThinkingIndicator() {
  // Pick one random verb and stick with it for this thought
  const [verb] = useState(() =>
    THINKING_VERBS[Math.floor(Math.random() * THINKING_VERBS.length)]
  )

  return (
    <span className="inline-flex items-center gap-1.5 text-juice-orange/80 italic">
      <svg
        className="w-4 h-4 animate-pulse"
        viewBox="0 0 24 24"
        fill="currentColor"
        style={{ filter: 'drop-shadow(0 0 4px currentColor)' }}
      >
        <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
      </svg>
      <span>{verb}...</span>
    </span>
  )
}
