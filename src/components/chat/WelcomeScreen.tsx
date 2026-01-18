import { useRef, useEffect, useState } from 'react'
import { useThemeStore } from '../../stores'

interface WelcomeScreenProps {
  onSuggestionClick: (text: string) => void
}

const allSuggestions = [
  // Getting started
  'What is Juicy?',
  'How do I start a fundraiser?',
  'How can I start a business?',
  'Help me plan my fundraise',
  'Is it free to create a project?',

  // Discovery
  'Show me successful projects',
  'Show me trending projects',
  'Show me biggest projects right now',
  'Show me creative projects',

  // Finding & supporting projects
  'Find a project to support',
  'What projects need funding?',
  'Show me projects I can pay into',
  'Support an open source project',
  'Back an indie developer',
  'Find projects by category',
  'Discover new projects',
  'Support a creator I follow',
  'Pay into Juicebox DAO',
  'Find Ethereum projects',
  'Show me Base projects',
  'Projects on Optimism',

  // Business & startups
  'Bootstrap my startup',
  'Launch my small business',
  'Fund my side project',
  'Start a worker-owned co-op',
  'How do I split ownership?',
  'How can I make agreements with investors?',
  'How do I share revenue with backers?',

  // Fundraising campaigns
  'Run a community fundraiser',
  'Organize a charity drive',
  'Make an auditable political campaign',
  'Fund a local initiative',
  'Can I set fundraising goals?',
  'How do refunds work?',

  // Creative projects
  'Can I fund my podcast?',
  'Fund my indie game',
  'Fund my open source project',
  'Launch my music project',
  'Crowdfund my film',
  'Fund my art collective',

  // Memberships & communities
  'Can I run a membership program?',
  'Start a fan club',
  'Build a paid community',
  'Can I fundraise for a DAO?',

  // Operations
  'How do supporters get rewarded?',
  'How can I reward supporters?',
  'How do I withdraw funds?',
  'How do I sell inventory?',
  'How do I manage sales?',
  'How transparent is the treasury?',
  'Can supporters cash out?',

  // Platform & whitelabel
  'Create a fundraising platform',
  'How do I whitelabel Juicy fundraises?',
  'Build my own crowdfunding site',
  'Embed fundraising in my app',
  'Custom branding for my platform',
  'Run fundraisers for my community',
  'Host multiple projects on my site',
  'White-label treasury management',
  'Create a grants program',
  'Build a giving platform',

  // Demos
  'Show me a live fundraise',
  'Pay into a project',
  'Create a simple project',
  'Revenue sharing setup',
  'NFT rewards for backers',

  // Fun / inspirational
  'Tell me a success story',
  'What could go right?',
  'Inspire me',
  'What makes a project take off?',
  'Dream big with me',
]

// Popular/recommended starting points
const popularSuggestions = new Set([
  'What is Juicy?',
  'How do I start a fundraiser?',
  'Bootstrap my startup',
  'Fund my open source project',
  'Run a community fundraiser',
  'Show me successful projects',
  'How do supporters get rewarded?',
  'Create a fundraising platform',
  'Find a project to support',
  'Discover new projects',
])

// Pro/advanced features
const proSuggestions = new Set([
  'How do I whitelabel Juicy fundraises?',
  'White-label treasury management',
  'How do I split ownership?',
  'How can I make agreements with investors?',
  'Make an auditable political campaign',
  'Embed fundraising in my app',
  'Custom branding for my platform',
  'How do I share revenue with backers?',
])

// Interactive demos
const demoSuggestions = new Set([
  'Show me a live fundraise',
  'Pay into a project',
  'Create a simple project',
  'Revenue sharing setup',
  'NFT rewards for backers',
])

// Fun / inspirational
const funSuggestions = new Set([
  'Tell me a success story',
  'What could go right?',
  'Inspire me',
  'What makes a project take off?',
  'Dream big with me',
])

// Layout constants
const CHIP_HEIGHT = 40
const GAP_X = 12
const GAP_Y = 8
const CHAR_WIDTH = 8.2
const CHIP_PADDING = 28 // px-3 = 12px * 2 + border

// Estimate chip width - use fixed char width for consistency
function estimateChipWidth(text: string): number {
  const isPopular = popularSuggestions.has(text)
  const isPro = proSuggestions.has(text)
  const isDemo = demoSuggestions.has(text)
  const isFun = funSuggestions.has(text)
  const badgeExtra = isPopular ? 58 : isPro ? 32 : isDemo ? 40 : isFun ? 32 : 0

  return text.length * CHAR_WIDTH + CHIP_PADDING + badgeExtra
}

// Arrange chips into rows - each row tiles independently
const NUM_ROWS = 9
interface RowData {
  chips: { suggestion: string; x: number; width: number }[]
  width: number
  stagger: number
}
const rows: RowData[] = []

// Distribute chips across rows
for (let row = 0; row < NUM_ROWS; row++) {
  const stagger = row % 2 === 1 ? 40 : 0
  let x = 0
  const chips: { suggestion: string; x: number; width: number }[] = []

  const startIdx = Math.floor((row / NUM_ROWS) * allSuggestions.length)
  const endIdx = Math.floor(((row + 1) / NUM_ROWS) * allSuggestions.length)

  for (let i = startIdx; i < endIdx; i++) {
    const suggestion = allSuggestions[i]
    const width = estimateChipWidth(suggestion)
    chips.push({ suggestion, x, width })
    x += width + GAP_X
  }

  rows.push({ chips, width: x, stagger })
}

const GRID_HEIGHT = NUM_ROWS * (CHIP_HEIGHT + GAP_Y)

function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}

export default function WelcomeScreen({ onSuggestionClick }: WelcomeScreenProps) {
  const { theme } = useThemeStore()
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [scale, setScale] = useState(1)
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const offsetRef = useRef({ x: 0, y: 0 })
  const scaleRef = useRef(1)
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const hasDraggedRef = useRef(false)
  const lastPinchDistRef = useRef<number | null>(null)

  // Track container size
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setContainerSize({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        })
      }
    }
    updateSize()
    window.addEventListener('resize', updateSize)
    return () => window.removeEventListener('resize', updateSize)
  }, [])

  // Use refs + document-level listeners for reliable dragging
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return
      hasDraggedRef.current = true
      const newOffset = {
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y,
      }
      offsetRef.current = newOffset
      setOffset(newOffset)
    }

    const handleMouseUp = () => {
      isDraggingRef.current = false
    }

    const handleTouchMove = (e: TouchEvent) => {
      // Handle pinch-to-zoom with 2 fingers
      if (e.touches.length === 2) {
        e.preventDefault()
        const touch1 = e.touches[0]
        const touch2 = e.touches[1]
        const dist = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY)

        if (lastPinchDistRef.current !== null) {
          const delta = dist - lastPinchDistRef.current
          const zoomSpeed = 0.012 // More sensitive
          const newScale = Math.max(0.3, Math.min(3, scaleRef.current + delta * zoomSpeed))
          scaleRef.current = newScale
          setScale(newScale)
        }
        lastPinchDistRef.current = dist
        return
      }

      // Single finger drag
      if (!isDraggingRef.current) return
      hasDraggedRef.current = true
      const touch = e.touches[0]
      const newOffset = {
        x: touch.clientX - dragStartRef.current.x,
        y: touch.clientY - dragStartRef.current.y,
      }
      offsetRef.current = newOffset
      setOffset(newOffset)
    }

    const handleTouchEnd = () => {
      isDraggingRef.current = false
      lastPinchDistRef.current = null
    }

    // Wheel handler needs to be native to prevent browser zoom (passive: false)
    const handleWheel = (e: WheelEvent) => {
      // Ctrl/Cmd + scroll = zoom (prevent browser zoom)
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        e.stopPropagation()
        const zoomSpeed = 0.008 // More sensitive
        const newScale = Math.max(0.3, Math.min(3, scaleRef.current - e.deltaY * zoomSpeed))
        scaleRef.current = newScale
        setScale(newScale)
        return
      }

      // Regular scroll = pan
      const newOffset = {
        x: offsetRef.current.x - e.deltaX,
        y: offsetRef.current.y - e.deltaY,
      }
      offsetRef.current = newOffset
      setOffset(newOffset)
    }

    const container = containerRef.current
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', handleTouchEnd)
    container?.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
      container?.removeEventListener('wheel', handleWheel)
    }
  }, [])

  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true
    hasDraggedRef.current = false
    dragStartRef.current = {
      x: e.clientX - offsetRef.current.x,
      y: e.clientY - offsetRef.current.y,
    }
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0]
    isDraggingRef.current = true
    hasDraggedRef.current = false
    dragStartRef.current = {
      x: touch.clientX - offsetRef.current.x,
      y: touch.clientY - offsetRef.current.y,
    }
  }

  const handleShuffle = () => {
    // Random jump to a new position
    const newOffset = {
      x: Math.random() * 2000 - 1000,
      y: Math.random() * 1000 - 500,
    }
    offsetRef.current = newOffset
    setOffset(newOffset)
  }

  const handleResetZoom = () => {
    scaleRef.current = 1
    setScale(1)
  }

  const handleChipClick = (suggestion: string) => {
    // Only trigger click if we didn't drag
    if (!hasDraggedRef.current) {
      onSuggestionClick(suggestion)
    }
  }

  // Calculate visible chips with wrapping - each row tiles at its own width
  // Account for scale: when zoomed out, the visible unscaled area is larger
  const visibleChips: { suggestion: string; x: number; y: number; key: string }[] = []

  if (containerSize.width > 0 && containerSize.height > 0) {
    // Effective visible area expands when zoomed out
    // Scale factor determines how much larger the unscaled visible area is
    const scaleFactor = 1 / scale
    const effectiveWidth = containerSize.width * scaleFactor
    const effectiveHeight = containerSize.height * scaleFactor

    // Extra tiles needed on each side when zoomed out (centered scaling)
    const extraTilesX = Math.ceil((effectiveWidth - containerSize.width) / 2 / 300) + 1
    const extraTilesY = Math.ceil((effectiveHeight - containerSize.height) / 2 / GRID_HEIGHT) + 1

    const tilesY = Math.ceil(containerSize.height / GRID_HEIGHT) + 2 + extraTilesY * 2

    rows.forEach((row, rowIdx) => {
      const rowY = rowIdx * (CHIP_HEIGHT + GAP_Y)
      const rowWidth = row.width

      // How many horizontal tiles needed for this row
      const tilesX = Math.ceil(containerSize.width / rowWidth) + 2 + extraTilesX * 2

      for (let tileY = -1 - extraTilesY; tileY < tilesY - extraTilesY; tileY++) {
        for (let tileX = -1 - extraTilesX; tileX < tilesX - extraTilesX; tileX++) {
          row.chips.forEach((chip, chipIdx) => {
            const x = chip.x + row.stagger + tileX * rowWidth + mod(offset.x, rowWidth)
            const y = rowY + tileY * GRID_HEIGHT + mod(offset.y, GRID_HEIGHT)

            // Extended visibility check for zoomed out state
            const padding = 50 + (scaleFactor - 1) * 200
            if (x > -chip.width - padding && x < containerSize.width + padding &&
                y > -CHIP_HEIGHT - padding && y < containerSize.height + padding) {
              visibleChips.push({
                suggestion: chip.suggestion,
                x,
                y,
                key: `${rowIdx}-${tileX}-${tileY}-${chipIdx}`,
              })
            }
          })
        }
      }
    })
  }

  return (
    <div className="flex-1 relative h-full overflow-hidden">
      {/* Full-width chips canvas (background layer) */}
      <div
        ref={containerRef}
        className="absolute inset-0 cursor-grab active:cursor-grabbing select-none overflow-hidden"
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        style={{ touchAction: 'none' }}
      >
        <div
          className="absolute inset-0"
          style={{
            transform: `scale(${scale})`,
            transformOrigin: 'center center',
          }}
        >
          {visibleChips.map((chip) => {
            const isPopular = popularSuggestions.has(chip.suggestion)
            const isPro = proSuggestions.has(chip.suggestion)
            const isDemo = demoSuggestions.has(chip.suggestion)
            const isFun = funSuggestions.has(chip.suggestion)
            return (
              <button
                key={chip.key}
                onMouseUp={() => handleChipClick(chip.suggestion)}
                onTouchEnd={() => handleChipClick(chip.suggestion)}
                className={`absolute px-3 py-2 border text-sm transition-colors duration-200 whitespace-nowrap select-none flex items-center gap-2 ${
                  isPopular
                    ? theme === 'dark'
                      ? 'bg-juice-cyan/10 border-juice-cyan/40 text-juice-cyan hover:bg-juice-cyan/20 hover:border-juice-cyan/60'
                      : 'bg-juice-cyan/10 border-juice-cyan/50 text-teal-700 hover:bg-juice-cyan/20 hover:border-juice-cyan/70'
                    : isPro
                      ? theme === 'dark'
                        ? 'bg-juice-orange/10 border-juice-orange/40 text-juice-orange hover:bg-juice-orange/20 hover:border-juice-orange/60'
                        : 'bg-orange-50 border-juice-orange/50 text-orange-700 hover:bg-orange-100 hover:border-juice-orange/70'
                      : isDemo
                        ? theme === 'dark'
                          ? 'bg-pink-500/10 border-pink-400/40 text-pink-300 hover:bg-pink-500/20 hover:border-pink-400/60'
                          : 'bg-pink-50 border-pink-400/50 text-pink-700 hover:bg-pink-100 hover:border-pink-400/70'
                        : isFun
                          ? theme === 'dark'
                            ? 'bg-green-500/10 border-green-400/40 text-green-300 hover:bg-green-500/20 hover:border-green-400/60'
                            : 'bg-green-50 border-green-400/50 text-green-700 hover:bg-green-100 hover:border-green-400/70'
                          : theme === 'dark'
                            ? 'bg-juice-dark-lighter border-white/10 text-gray-300 hover:text-white hover:border-white/30'
                            : 'bg-juice-light-darker border-gray-300 text-gray-600 hover:text-gray-900 hover:border-gray-400'
                }`}
                style={{
                  left: chip.x,
                  top: chip.y,
                }}
              >
                {chip.suggestion}
                {isPopular && (
                  <span className={`text-[10px] uppercase tracking-wide ${
                    theme === 'dark' ? 'text-juice-cyan/70' : 'text-teal-500'
                  }`}>
                    popular
                  </span>
                )}
                {isPro && (
                  <span className="text-[10px] uppercase tracking-wide font-semibold text-yellow-400">
                    pro
                  </span>
                )}
                {isDemo && (
                  <span className="text-[10px] uppercase tracking-wide font-semibold text-pink-400">
                    demo
                  </span>
                )}
                {isFun && (
                  <span className="text-[10px] uppercase tracking-wide font-semibold text-green-400">
                    fun
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Shuffle & Zoom controls - top right of recommendations area */}
      <div className="absolute top-4 right-[calc(38%+1rem)] flex gap-2 z-10">
        {scale !== 1 && (
          <button
            onClick={handleResetZoom}
            className={`px-3 py-1.5 text-sm border transition-colors ${
              theme === 'dark'
                ? 'border-white/30 text-white/70 hover:border-white/50 hover:text-white bg-juice-dark/60 backdrop-blur-sm'
                : 'border-gray-400 text-gray-600 hover:border-gray-600 hover:text-gray-900 bg-white/60 backdrop-blur-sm'
            }`}
          >
            {Math.round(scale * 100)}%
          </button>
        )}
        <button
          onClick={handleShuffle}
          className={`px-3 py-1.5 text-sm border transition-colors ${
            theme === 'dark'
              ? 'border-white/30 text-white/70 hover:border-white/50 hover:text-white bg-juice-dark/60 backdrop-blur-sm'
              : 'border-gray-400 text-gray-600 hover:border-gray-600 hover:text-gray-900 bg-white/60 backdrop-blur-sm'
          }`}
        >
          Shuffle
        </button>
      </div>

      {/* Mascot overlay (on top of chips, right side) */}
      <div className="absolute inset-0 flex pointer-events-none">
        {/* Left spacer - chips visible area */}
        <div className="flex-1" />

        {/* Right column - Mascot (38% of main content area) */}
        <div className={`w-[38%] flex-shrink-0 flex flex-col items-center justify-center border-l-4 border-juice-orange backdrop-blur-md pointer-events-auto relative ${
          theme === 'dark'
            ? 'bg-juice-dark/60'
            : 'bg-white/60'
        }`}>
          {/* Pay us button - top right */}
          <button
            onClick={() => onSuggestionClick('I want to pay project ID 1 (NANA)')}
            className={`absolute top-4 right-4 px-3 py-1.5 text-sm border transition-colors ${
              theme === 'dark'
                ? 'border-green-500/50 text-green-400 hover:border-green-500 hover:bg-green-500/10 bg-juice-dark/60 backdrop-blur-sm'
                : 'border-green-500/60 text-green-600 hover:border-green-500 hover:bg-green-50 bg-white/60 backdrop-blur-sm'
            }`}
          >
            Pay us
          </button>
          <div className="h-[55vh] max-h-[450px] pointer-events-none">
            <img
              src={theme === 'dark' ? '/mascot-dark.png' : '/mascot-light.png'}
              alt="Juicy Mascot"
              className="drop-shadow-lg h-full object-contain"
            />
          </div>
          <div className="mt-4 pointer-events-none text-center px-6">
            <p className="text-4xl font-bold text-juice-orange">
              Fund Your Thing
            </p>
            <p className="text-4xl font-bold text-juice-orange">
              Your Way
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
