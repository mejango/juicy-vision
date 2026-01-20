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
    <span className="inline-flex items-center gap-1.5 text-juice-orange font-semibold">
      {/* Glitchy lightning bolt */}
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="currentColor"
        style={{
          animation: 'zap 1.2s steps(1) infinite',
        }}
      >
        <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
      </svg>
      <span>{verb}...</span>
      <style>{`
        @keyframes zap {
          0% { opacity: 0.4; }
          5% { opacity: 1; }
          8% { opacity: 0.2; }
          10% { opacity: 1; }
          15% { opacity: 0.6; }
          18% { opacity: 0; }
          20% { opacity: 1; }
          25% { opacity: 0.5; }
          30% { opacity: 0.8; }
          32% { opacity: 0.1; }
          35% { opacity: 1; }
          50% { opacity: 0.7; }
          55% { opacity: 0; }
          57% { opacity: 1; }
          60% { opacity: 0.3; }
          65% { opacity: 0.9; }
          70% { opacity: 0.4; }
          75% { opacity: 1; }
          78% { opacity: 0; }
          80% { opacity: 0.8; }
          85% { opacity: 0.5; }
          90% { opacity: 1; }
          95% { opacity: 0.2; }
          100% { opacity: 0.6; }
        }
      `}</style>
    </span>
  )
}
