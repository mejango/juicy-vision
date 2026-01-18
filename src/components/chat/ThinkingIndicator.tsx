import { useState } from 'react'

// Juice and fruit-themed verbs for thinking states
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
  const [verb] = useState(() =>
    THINKING_VERBS[Math.floor(Math.random() * THINKING_VERBS.length)]
  )

  return (
    <span className="inline-flex items-center gap-1.5 text-juice-orange/80 italic">
      {/* Flickering lightning bolt */}
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="currentColor"
        style={{
          animation: 'zap 2s ease-in-out infinite',
          filter: 'drop-shadow(0 0 3px currentColor)',
        }}
      >
        <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
      </svg>
      <span>{verb}...</span>
      <style>{`
        @keyframes zap {
          0%, 100% { opacity: 0.5; filter: drop-shadow(0 0 2px currentColor); }
          10% { opacity: 1; filter: drop-shadow(0 0 6px currentColor); }
          12% { opacity: 0.3; }
          14% { opacity: 1; filter: drop-shadow(0 0 8px currentColor); }
          20% { opacity: 0.7; filter: drop-shadow(0 0 3px currentColor); }
          50% { opacity: 0.5; filter: drop-shadow(0 0 2px currentColor); }
          70% { opacity: 0.6; }
          72% { opacity: 1; filter: drop-shadow(0 0 6px currentColor); }
          75% { opacity: 0.4; }
          77% { opacity: 0.9; filter: drop-shadow(0 0 5px currentColor); }
          85% { opacity: 0.5; filter: drop-shadow(0 0 2px currentColor); }
        }
      `}</style>
    </span>
  )
}
