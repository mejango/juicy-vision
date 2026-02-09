/**
 * Keypad Component
 *
 * Touch-friendly numeric keypad for entering amounts.
 */

interface KeypadProps {
  onKeyPress: (key: string) => void
}

export default function Keypad({ onKeyPress }: KeypadProps) {
  const keys = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['.', '0', '⌫'],
  ]

  return (
    <div className="grid grid-cols-3 gap-2">
      {keys.flat().map((key) => (
        <button
          key={key}
          onClick={() => onKeyPress(key)}
          className="keypad-button"
        >
          {key === '⌫' ? (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414 6.414a2 2 0 001.414.586H19a2 2 0 002-2V7a2 2 0 00-2-2h-8.172a2 2 0 00-1.414.586L3 12z" />
            </svg>
          ) : (
            key
          )}
        </button>
      ))}
    </div>
  )
}
