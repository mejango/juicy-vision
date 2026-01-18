import { useRef, useEffect, useState } from 'react'
import { useThemeStore, useSettingsStore } from '../../stores'
import { generateRefinementChips, type RefinementChip } from '../../services/claude'

interface WelcomeScreenProps {
  onSuggestionClick: (text: string) => void
}

interface RefinementState {
  selected: string
  selectedPosition: { x: number; y: number }
  chips: RefinementChip[]
  loading: boolean
}

const allSuggestions = [
  // Getting started
  'What is Juicy?',
  'How do I start a fundraiser?',
  'How can I start a business?',
  'Help me plan my fundraise',
  'Is it free to create a project?',
  'What can I build with Juicy?',
  'Show me the possibilities',

  // Discovery
  'Show me successful projects',
  'Show me trending projects',
  'Show me biggest projects right now',
  'Show me creative projects',
  'What are people building?',
  'Show me weird projects',
  'Find something inspiring',

  // Finding & supporting projects
  'Find a project to support',
  'What projects need funding?',
  'Show me projects I can pay into',
  'Support an open source project',
  'Back an indie developer',
  'Find projects by category',
  'Discover new projects',
  'Support a creator I follow',
  'Find Ethereum projects',
  'Show me Base projects',
  'Projects on Optimism',

  // Open source & devs
  'Fund my open source library',
  'Sustain my GitHub project',
  'Get paid for my npm package',
  'Fund my dev tools',
  'Support protocol development',
  'Fund infrastructure I maintain',
  'Get sponsors for my framework',
  'Fund my VS Code extension',
  'Monetize my API',
  'Fund my CLI tool',

  // Business & startups
  'Bootstrap my startup',
  'Launch my small business',
  'Fund my side project',
  'Start a worker-owned co-op',
  'How do I split ownership?',
  'How can I make agreements with investors?',
  'How do I share revenue with backers?',
  'Fund my hardware startup',
  'Launch a collective business',

  // Fundraising campaigns
  'Run a community fundraiser',
  'Organize a charity drive',
  'Make an auditable political campaign',
  'Fund a local initiative',
  'Can I set fundraising goals?',
  'How do refunds work?',
  'Fund disaster relief',
  'Support mutual aid',

  // Creative projects
  'Can I fund my podcast?',
  'Fund my indie game',
  'Fund my open source project',
  'Launch my music project',
  'Crowdfund my film',
  'Fund my art collective',
  'Fund my zine',
  'Support my webcomic',
  'Fund my album',
  'Launch my animation project',

  // Oddball creators
  'Fund my weird art project',
  'Start a meme coin with utility',
  'Fund my experimental theater',
  'Launch my puppet show',
  'Fund my street performance',
  'Crowdfund my tattoo shop',
  'Fund my urban garden',
  'Start my vintage arcade',
  'Fund my escape room',
  'Launch my food truck',
  'Fund my cat cafe',
  'Start my maker space',
  'Fund my community radio',
  'Launch my pirate ship bar',

  // Writers & journalists
  'Fund my newsletter',
  'Support my journalism',
  'Fund my book',
  'Launch my magazine',
  'Fund investigative reporting',
  'Support my blog',

  // Education & research
  'Fund my research',
  'Support my course',
  'Fund my tutorial series',
  'Launch my bootcamp',
  'Fund my educational content',
  'Support my mentorship program',

  // Gaming & esports
  'Fund my esports team',
  'Launch my gaming community',
  'Fund my speedrun project',
  'Support my mod development',
  'Fund my game server',

  // Memberships & communities
  'Can I run a membership program?',
  'Start a fan club',
  'Build a paid community',
  'Can I fundraise for a DAO?',
  'Run a discord with benefits',
  'Fund my community garden',
  'Start a buying club',
  'Launch a tool library',

  // Operations
  'How do supporters get rewarded?',
  'How can I reward supporters?',
  'How do I withdraw funds?',
  'How do I sell inventory?',
  'How do I manage sales?',
  'How transparent is the funding?',
  'Can supporters cash out?',

  // Platform & whitelabel
  'Create a fundraising platform',
  'How do I whitelabel Juicy fundraises?',
  'Build my own crowdfunding site',
  'Embed fundraising in my app',
  'Custom branding for my platform',
  'Run fundraisers for my community',
  'Host multiple projects on my site',
  'White-label fund management',
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
  'What if money wasn\'t the problem?',
  'Help me think bigger',
  'What would you fund?',

  // Crypto native
  'Launch a token for my project',
  'Fund public goods',
  'Run a retroactive funding round',
  'Create a quadratic funding pool',
  'Fund protocol development',
  'Launch a network state project',

  // Automated money machines
  'Build an automated revenue machine',
  'Create a self-sustaining treasury',
  'Launch a perpetual funding engine',
  'Money that works while I sleep',
  'Build an autonomous treasury',
  'Create a self-growing fund',
  'Automate my income streams',

  // IRL projects
  'Fund my community center',
  'Start a neighborhood project',
  'Fund my local park cleanup',
  'Launch a community fridge',
  'Fund my bike repair collective',
  'Start a free store',
  'Fund my community workshop',
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
  'Fund my indie game',
  'Sustain my GitHub project',
  'Fund public goods',
  'What are people building?',
])

// Pro/advanced features
const proSuggestions = new Set([
  'How do I whitelabel Juicy fundraises?',
  'White-label fund management',
  'How do I split ownership?',
  'How can I make agreements with investors?',
  'Make an auditable political campaign',
  'Embed fundraising in my app',
  'Custom branding for my platform',
  'How do I share revenue with backers?',
  'Run a retroactive funding round',
  'Create a quadratic funding pool',
  'Launch a network state project',
  'Create a grants program',
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
  'What if money wasn\'t the problem?',
  'Help me think bigger',
  'What would you fund?',
  'Fund my weird art project',
  'Launch my pirate ship bar',
  'Fund my cat cafe',
  'Show me weird projects',
  'Find something inspiring',
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
  const { claudeApiKey, isConfigured } = useSettingsStore()
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [scale, setScale] = useState(1)
  const [refinement, setRefinement] = useState<RefinementState | null>(null)
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

  const handleChipClick = async (suggestion: string, chipX: number, chipY: number) => {
    // Only trigger click if we didn't drag
    if (hasDraggedRef.current) return

    // If already in refinement mode and clicking the selected chip, start conversation
    if (refinement?.selected === suggestion) {
      setRefinement(null)
      onSuggestionClick(suggestion)
      return
    }

    // If API not configured, fall back to direct send
    if (!isConfigured()) {
      onSuggestionClick(suggestion)
      return
    }

    // Start refinement flow - center view on this chip
    const centerX = containerSize.width / 2
    const centerY = containerSize.height / 2
    const newOffset = {
      x: offsetRef.current.x + (centerX - chipX),
      y: offsetRef.current.y + (centerY - chipY),
    }
    offsetRef.current = newOffset
    setOffset(newOffset)

    setRefinement({
      selected: suggestion,
      selectedPosition: { x: centerX, y: centerY },
      chips: [],
      loading: true
    })

    try {
      const chips = await generateRefinementChips(claudeApiKey, [suggestion])
      setRefinement(prev => prev ? { ...prev, chips, loading: false } : null)
    } catch {
      // On error, just start the conversation directly
      setRefinement(null)
      onSuggestionClick(suggestion)
    }
  }

  const handleRefinementChipClick = (chip: RefinementChip) => {
    if (!refinement) return
    // Start conversation with combined context
    const message = `${refinement.selected} → ${chip.text}`
    setRefinement(null)
    onSuggestionClick(message)
  }

  const handleCancelRefinement = () => {
    setRefinement(null)
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
            const isSelected = refinement?.selected === chip.suggestion
            const isDimmed = refinement && !isSelected
            return (
              <button
                key={chip.key}
                onMouseUp={() => handleChipClick(chip.suggestion, chip.x, chip.y)}
                onTouchEnd={() => handleChipClick(chip.suggestion, chip.x, chip.y)}
                className={`absolute px-3 py-2 border text-sm transition-all duration-300 whitespace-nowrap select-none flex items-center gap-2 ${
                  isSelected
                    ? theme === 'dark'
                      ? 'bg-juice-cyan/30 border-juice-cyan text-white z-20 scale-110'
                      : 'bg-juice-cyan/20 border-juice-cyan text-teal-900 z-20 scale-110'
                    : isPopular
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
                  opacity: isDimmed ? 0.3 : 1,
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

          {/* Inline refinement chips - appear below selected chip */}
          {refinement && !refinement.loading && refinement.chips.length > 0 && (
            <div
              className="absolute z-30 flex flex-wrap gap-2 max-w-md"
              style={{
                left: refinement.selectedPosition.x - 200,
                top: refinement.selectedPosition.y + 50,
              }}
            >
              {refinement.chips.map((chip, idx) => (
                <button
                  key={idx}
                  onClick={() => handleRefinementChipClick(chip)}
                  className={`px-3 py-2 text-sm border transition-colors whitespace-nowrap ${
                    theme === 'dark'
                      ? 'bg-juice-dark border-juice-cyan/60 text-juice-cyan hover:bg-juice-cyan/20 hover:border-juice-cyan'
                      : 'bg-white border-juice-cyan/60 text-teal-700 hover:bg-juice-cyan/10 hover:border-juice-cyan'
                  }`}
                >
                  {chip.text}
                </button>
              ))}
              <button
                onClick={handleCancelRefinement}
                className={`px-3 py-2 text-sm transition-colors ${
                  theme === 'dark'
                    ? 'text-gray-500 hover:text-gray-300'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                ✕
              </button>
            </div>
          )}

          {/* Loading indicator near selected chip */}
          {refinement?.loading && (
            <div
              className="absolute z-30 flex items-center gap-2"
              style={{
                left: refinement.selectedPosition.x - 50,
                top: refinement.selectedPosition.y + 50,
              }}
            >
              <div className={`animate-spin w-4 h-4 border-2 border-t-transparent rounded-full ${
                theme === 'dark' ? 'border-juice-cyan' : 'border-teal-500'
              }`} />
              <span className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                Thinking...
              </span>
            </div>
          )}
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
        <div className={`w-[38%] flex-shrink-0 flex flex-col border-l-4 border-juice-orange backdrop-blur-md pointer-events-auto relative overflow-y-auto hide-scrollbar ${
          theme === 'dark'
            ? 'bg-juice-dark/60'
            : 'bg-white/60'
        }`}>
          {/* Pay us button - top right */}
          <button
            onClick={() => onSuggestionClick('I want to pay project ID 1 (NANA)')}
            className={`absolute top-4 right-4 z-10 px-3 py-1.5 text-sm border transition-colors ${
              theme === 'dark'
                ? 'border-green-500/50 text-green-400 hover:border-green-500 hover:bg-green-500/10 bg-juice-dark/60 backdrop-blur-sm'
                : 'border-green-500/60 text-green-600 hover:border-green-500 hover:bg-green-50 bg-white/60 backdrop-blur-sm'
            }`}
          >
            Pay us
          </button>

          {/* Subtle scroll hint arrow - bottom right */}
          <div className={`absolute bottom-4 right-4 z-10 animate-bounce ${
            theme === 'dark' ? 'text-gray-600' : 'text-gray-300'
          }`}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </div>

          {/* Scrollable content */}
          <div className="flex flex-col items-center py-8 px-4">
            <div className="h-[45vh] max-h-[380px] min-h-[200px] pointer-events-none">
              <img
                src={theme === 'dark' ? '/mascot-dark.png' : '/mascot-light.png'}
                alt="Juicy Mascot"
                className="drop-shadow-lg h-full object-contain"
              />
            </div>

            <div className="mt-4 pointer-events-none text-center px-2">
              <p className="text-lg sm:text-xl font-bold text-juice-orange whitespace-nowrap">
                Fund Your Thing Your Way
              </p>
            </div>

            {/* Spacer to push content below the fold */}
            <div className="h-[30vh]" />

            {/* $JUICY explainer - below the fold */}
            <div className={`p-4 max-w-[280px] ${
              theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
            }`}>
              <p className="text-xs leading-relaxed">
                $JUICY is the revenue token that powers this app. When you pay into Juicy Vision, you receive $JUICY tokens proportional to your contribution.
              </p>
              <p className="text-xs leading-relaxed mt-3">
                As the balance grows, so does the value backing each token. You can cash out anytime for your share, or hold to support the community business.
              </p>
              <p className={`text-xs leading-relaxed mt-3 ${
                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
              }`}>
                We run extremely lean. Revenue from the app mostly flows back to $JUICY holders, guaranteed. The more value created, the more everyone benefits. We're in this together.
              </p>
              <button
                onClick={() => onSuggestionClick('I want to pay project ID 1 (NANA)')}
                className={`mt-4 px-3 py-1.5 text-sm border transition-colors ${
                  theme === 'dark'
                    ? 'border-green-500/50 text-green-400 hover:border-green-500 hover:bg-green-500/10'
                    : 'border-green-500/60 text-green-600 hover:border-green-500 hover:bg-green-50'
                }`}
              >
                Pay us
              </button>
              <p className={`text-xs leading-relaxed mt-4 pt-4 border-t ${
                theme === 'dark' ? 'text-gray-500 border-white/10' : 'text-gray-400 border-gray-200'
              }`}>
                Uses{' '}
                <a
                  href="https://revnet.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`underline hover:no-underline ${
                    theme === 'dark' ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'
                  }`}
                >
                  revnets
                </a>
                , powered by{' '}
                <a
                  href="https://docs.juicebox.money"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`underline hover:no-underline ${
                    theme === 'dark' ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'
                  }`}
                >
                  Juicebox
                </a>
                , secured by Ethereum, Optimism, Base, and Arbitrum.
              </p>
            </div>

            {/* Bottom padding */}
            <div className="h-8" />
          </div>
        </div>
      </div>
    </div>
  )
}
