import { useRef, useEffect, useState, useMemo, useCallback, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useThemeStore } from '../../stores'

interface WelcomeScreenProps {
  onSuggestionClick: (text: string) => void
}

// Identity traits for filtering - empathetic, human-centered
type TraitId = 'maker' | 'artist' | 'community' | 'supporter' | 'entrepreneur' | 'researcher' | 'local' | 'curious' | 'climate' | 'health' | 'creative' | 'food' | 'science'

// i18n key for a suggestion or trait label: camelCase of its words.
const suggestionKeyExceptions: Record<string, string> = {
  'learning & teaching': 'learningAndTeaching',
}

function suggestionKey(text: string): string {
  const exception = suggestionKeyExceptions[text]
  if (exception) return exception
  return text
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word, index) => (index === 0 ? word[0].toLowerCase() : word[0].toUpperCase()) + word.slice(1))
    .join('')
}

interface Trait {
  id: TraitId
  label: string
  keywords: string[] // suggestions containing these words match this trait
}

const welcomeTraits: Trait[] = [
  {
    id: 'maker',
    label: 'making things',
    keywords: ['build', 'create', 'launch', 'start', 'bootstrap', 'make', 'develop', 'design', 'infrastructure', 'platform', 'app', 'startup', 'business', 'saas', 'product'],
  },
  {
    id: 'artist',
    label: 'expressing myself',
    keywords: ['film', 'music', 'album', 'art', 'comic', 'animation', 'game', 'podcast', 'book', 'newsletter', 'magazine', 'photography', 'documentary', 'creative', 'zine', 'theater', 'gallery', 'weird'],
  },
  {
    id: 'community',
    label: 'bringing people together',
    keywords: ['community', 'collective', 'club', 'local', 'neighborhood', 'mutual', 'garden', 'space', 'workshop', 'membership', 'charity', 'fundraiser', 'campaign', 'drive', 'relief'],
  },
  {
    id: 'supporter',
    label: 'looking to support',
    keywords: ['find', 'discover', 'support', 'back', 'pay into', 'show me', 'what projects'],
  },
  {
    id: 'entrepreneur',
    label: 'starting a business',
    keywords: ['startup', 'business', 'bootstrap', 'saas', 'marketplace', 'franchise', 'agency', 'consulting', 'revenue', 'profit', 'company', 'enterprise', 'venture', 'commercial'],
  },
  {
    id: 'researcher',
    label: 'learning & teaching',
    keywords: ['research', 'education', 'course', 'tutorial', 'bootcamp', 'thesis', 'lab', 'scholarship', 'mentor', 'teaching', 'learning', 'training', 'workshop', 'school', 'academy', 'tutoring', 'lesson'],
  },
  {
    id: 'local',
    label: 'helping my neighborhood',
    keywords: ['local', 'neighborhood', 'city', 'community garden', 'food truck', 'cafe', 'coworking', 'park', 'cleanup'],
  },
  {
    id: 'curious',
    label: 'just exploring',
    keywords: ['what is', 'how do', 'show me', 'walk me', 'explain', 'discover', 'trending', 'successful', 'inspiring'],
  },
  {
    id: 'climate',
    label: 'saving the planet',
    keywords: ['climate', 'solar', 'renewable', 'carbon', 'reforestation', 'sustainable', 'green', 'clean tech', 'ocean', 'biodiversity', 'regenerative'],
  },
  {
    id: 'health',
    label: 'improving health',
    keywords: ['health', 'mental health', 'wellness', 'fitness', 'medical', 'biotech', 'longevity', 'therapy', 'patient', 'clinical'],
  },
  {
    id: 'creative',
    label: 'creating things',
    keywords: ['art', 'music', 'film', 'game', 'animation', 'design', 'photography', 'podcast', 'streaming', 'content', 'creator', 'studio'],
  },
  {
    id: 'food',
    label: 'making food',
    keywords: ['restaurant', 'food', 'coffee', 'brewery', 'bakery', 'kitchen', 'farm', 'meal', 'beverage', 'cafe'],
  },
  {
    id: 'science',
    label: 'doing science',
    keywords: ['research', 'scientific', 'lab', 'thesis', 'physics', 'chemistry', 'biology', 'space', 'astronomy', 'clinical', 'experiment'],
  },
]

// Check if a suggestion matches a trait
function suggestionMatchesTrait(suggestion: string, trait: Trait): boolean {
  const lower = suggestion.toLowerCase()
  return trait.keywords.some(keyword => lower.includes(keyword.toLowerCase()))
}

const welcomeSuggestions = [
  'What is Juicy?',
  'How do I start a fundraiser?',
  'Help me plan my fundraise',
  'Is it free to create a project?',
  'Show me how it works',
  'Walk me through the basics',
  'How does the money flow?',
  'Show me successful projects',
  'Show me trending projects',
  'Show me creative projects',
  'What are people building?',
  'Find something inspiring',
  'Find a project to support',
  'What projects need funding?',
  'Find projects by category',
  'Discover new projects',
  'Fund my open source library',
  'Sustain my GitHub project',
  'Bootstrap my startup',
  'Launch my small business',
  'Fund my side project',
  'Run a community fundraiser',
  'Organize a charity drive',
  'Fund disaster relief',
  'Fund mutual aid',
  'Fund my album',
  'Fund my podcast',
  'Fund my indie game',
  'Crowdfund my film',
  'Fund my art collective',
  'Fund my documentary',
  'Fund my newsletter',
  'Support my journalism',
  'Fund my book',
  'Fund my research',
  'Support my course',
  'Fund my esports team',
  'Launch my gaming community',
  'Can I run a membership program?',
  'Start a fan club',
  'Build a paid community',
  'Fund my community garden',
  'Fund my coworking space',
  'Start my hackerspace',
  'Fund my community center',
  'Start a neighborhood project',
  'Launch my food truck',
  'How do supporters get rewarded?',
  'How can I reward supporters?',
  'Can supporters cash out?',
  'Fund public goods',
  'Fund protocol development',
  'Launch a revnet',
  'Show me a live fundraise',
  'Pay into a project',
  'Create a simple project',
  'Walk me through a payment',
  'Show me cash out in action',
]

// POPULAR (cyan) - Entry points, universal appeal, high-value starting questions
const popularSuggestions = new Set([
  'What is Juicy?',
  'How do I start a fundraiser?',
  'Help me plan my fundraise',
  'Is it free to create a project?',
  'Show me how it works',
  'Show me successful projects',
  'What are people building?',
  'Find something inspiring',
  'Find a project to support',
  'Discover new projects',
  'Fund my open source library',
  'Bootstrap my startup',
  'Run a community fundraiser',
  'Fund my album',
  'Fund my podcast',
  'Fund my indie game',
  'Fund my art collective',
  'Fund my documentary',
  'Fund my newsletter',
  'Fund my research',
  'Support my course',
  'Fund my esports team',
  'Start a fan club',
  'Build a paid community',
  'Fund my coworking space',
  'Start my hackerspace',
  'Fund my community center',
  'Launch my food truck',
  'How do supporters get rewarded?',
  'How can I reward supporters?',
  'Can supporters cash out?',
  'Fund public goods',
])

// PRO (orange) - Advanced, institutional, complex configurations
const proSuggestions = new Set([
  'Launch a revnet',
])

// DEMO (pink) - Interactive, hands-on, "show me"
const demoSuggestions = new Set([
  'Walk me through the basics',
  'How does the money flow?',
  'Show me trending projects',
  'Show me creative projects',
  'Show me a live fundraise',
  'Pay into a project',
  'Create a simple project',
  'Walk me through a payment',
  'Show me cash out in action',
])

// Layout constants
const CHIP_HEIGHT = 40
const ROW_COUNT = 80
const CHIPS_PER_ROW = 40

interface RowData {
  suggestions: string[]
  rowIndex: number
}

// Build rows of suggestions for flex-based layout
function buildRows(suggestions: string[]): RowData[] {
  if (suggestions.length === 0) return []

  const rows: RowData[] = []

  for (let rowIndex = 0; rowIndex < ROW_COUNT; rowIndex++) {
    // Stagger start index per row using golden ratio to avoid vertical alignment
    const startIdx = Math.floor(rowIndex * 0.618033988749 * suggestions.length) % suggestions.length
    const rowSuggestions: string[] = []

    for (let i = 0; i < CHIPS_PER_ROW; i++) {
      const idx = (startIdx + i) % suggestions.length
      rowSuggestions.push(suggestions[idx])
    }

    rows.push({ suggestions: rowSuggestions, rowIndex })
  }

  return rows
}

// Random shuffle - stochastic each page load
function shuffle<T>(array: T[]): T[] {
  const result = [...array]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

// Pre-computed chip data for performance
interface ChipData {
  text: string
  displayText: string
  isCategory: boolean
  badgeType: 'id' | 'popular' | 'pro' | 'demo' | null
}

// Chip styling by badge type ('id' = category chip), per theme
const CHIP_CLASSES: Record<'dark' | 'light', Record<'id' | 'popular' | 'pro' | 'demo' | 'default', string>> = {
  dark: {
    id: 'bg-yellow-500/20 border-yellow-400/50 text-yellow-300 font-medium hover:bg-yellow-500/35 hover:border-yellow-400',
    popular: 'bg-juice-cyan/20 border-juice-cyan/40 text-juice-cyan hover:bg-juice-cyan/35 hover:border-juice-cyan',
    pro: 'bg-juice-orange/20 border-juice-orange/40 text-juice-orange hover:bg-juice-orange/35 hover:border-juice-orange',
    demo: 'bg-pink-500/20 border-pink-400/40 text-pink-300 hover:bg-pink-500/35 hover:border-pink-400',
    default: 'bg-gray-700/40 border-white/10 text-gray-300 hover:bg-gray-600/50 hover:border-white/25 hover:text-white',
  },
  light: {
    id: 'bg-yellow-50 border-yellow-500/50 text-yellow-700 font-medium hover:bg-yellow-100 hover:border-yellow-500',
    popular: 'bg-juice-cyan/10 border-juice-cyan/50 text-teal-700 hover:bg-juice-cyan/20 hover:border-teal-500',
    pro: 'bg-orange-50 border-juice-orange/50 text-orange-700 hover:bg-orange-100 hover:border-orange-500',
    demo: 'bg-pink-50 border-pink-400/50 text-pink-700 hover:bg-pink-100 hover:border-pink-500',
    default: 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-400 hover:text-gray-900',
  },
}

// Badge label styling by badge type
const BADGE_SPAN_CLASSES: Record<'id' | 'popular' | 'pro' | 'demo', string> = {
  id: 'text-[10px] uppercase tracking-wide font-semibold text-yellow-400',
  popular: 'text-[10px] uppercase tracking-wide text-juice-cyan/70',
  pro: 'text-[10px] uppercase tracking-wide font-semibold text-yellow-400',
  demo: 'text-[10px] uppercase tracking-wide font-semibold text-pink-400',
}

// Memoized chip component to avoid re-renders during scroll
const ChipButton = memo(function ChipButton({
  chip,
  theme,
  onClick,
  t,
}: {
  chip: ChipData
  theme: 'dark' | 'light'
  onClick: () => void
  t: (key: string, fallback: string) => string
}) {
  const { displayText, isCategory, badgeType } = chip
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null)

  const className = CHIP_CLASSES[theme][isCategory ? 'id' : badgeType ?? 'default']

  // Handle touch start - record position for drag detection
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0]
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() }
  }, [])

  // Handle touch end - only trigger click if it wasn't a drag
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return

    const touch = e.changedTouches[0]
    const dx = touch.clientX - touchStartRef.current.x
    const dy = touch.clientY - touchStartRef.current.y
    const distance = Math.sqrt(dx * dx + dy * dy)
    const duration = Date.now() - touchStartRef.current.time

    // Only trigger click if:
    // - Movement was less than 10px (finger wobble tolerance)
    // - Touch duration was less than 500ms (not a long press/drag)
    if (distance < 10 && duration < 500) {
      e.preventDefault()
      e.stopPropagation()
      onClick()
    }

    touchStartRef.current = null
  }, [onClick])

  return (
    <button
      onClick={onClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className={`px-3 py-2 border text-sm whitespace-nowrap select-none flex items-center gap-2 transition-[background-color,border-color,color] duration-100 ${className}`}
      style={{ height: CHIP_HEIGHT }}
    >
      {displayText}
      {badgeType && (
        <span className={BADGE_SPAN_CLASSES[badgeType]}>
          {t(`badges.${badgeType}`, badgeType)}
        </span>
      )}
    </button>
  )
})

export default function WelcomeScreen({ onSuggestionClick }: WelcomeScreenProps) {
  const { theme } = useThemeStore()
  const { t } = useTranslation()
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [scale, setScale] = useState(1)
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const mouseStartRef = useRef({ x: 0, y: 0 }) // Track initial mouse position for threshold
  const offsetRef = useRef({ x: 0, y: 0 })
  const scaleRef = useRef(1)
  const containerRef = useRef<HTMLDivElement>(null)
  const transformRef = useRef<HTMLDivElement>(null) // Direct DOM manipulation for smooth scrolling
  const rafIdRef = useRef<number | null>(null) // For requestAnimationFrame cleanup
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const hasDraggedRef = useRef(false)
  const DRAG_THRESHOLD = 5 // Minimum pixels of movement before considering it a drag
  const lastPinchDistRef = useRef<number | null>(null)
  const [selectedTraits, setSelectedTraits] = useState<Set<TraitId>>(new Set())

  // Direct DOM update for transform (bypasses React re-render)
  const updateTransform = useCallback(() => {
    if (transformRef.current) {
      transformRef.current.style.transform = `translate(${offsetRef.current.x}px, ${offsetRef.current.y}px) scale(${scaleRef.current})`
    }
  }, [])

  // Get trait labels for mixing into suggestions
  const traitLabels = welcomeTraits.map(t => t.label)

  // Shuffled base list - random on each page load
  const shuffledBase = useMemo(() => {
    return shuffle([...welcomeSuggestions, ...traitLabels])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Empty deps = shuffle once on mount

  // Filter suggestions based on selected traits
  const filteredSuggestions = useMemo(() => {
    if (selectedTraits.size === 0) return shuffledBase

    // When filtering, get keyword-matched suggestions but HIDE ID chips
    const filtered = shuffledBase.filter(suggestion => {
      const matchingTrait = welcomeTraits.find(t => t.label === suggestion)
      if (matchingTrait) {
        return false // Hide all ID chips when filtering
      }

      // Regular suggestion must match ALL selected traits (intersection)
      return Array.from(selectedTraits).every(traitId => {
        const trait = welcomeTraits.find(t => t.id === traitId)
        return trait && suggestionMatchesTrait(suggestion, trait)
      })
    })

    return filtered
  }, [selectedTraits, shuffledBase])

  const toggleTrait = useCallback((traitId: TraitId) => {
    setSelectedTraits(prev => {
      const next = new Set(prev)
      if (next.has(traitId)) {
        next.delete(traitId)
      } else {
        next.add(traitId)
      }
      return next
    })
  }, [])

  // Build rows from filtered suggestions
  const rows = useMemo(() => buildRows(filteredSuggestions), [filteredSuggestions])

  // Pre-compute chip data for all suggestions (avoids recalculation during scroll)
  const chipDataMap = useMemo(() => {
    const map = new Map<string, ChipData>()
    const traitLabels = welcomeTraits.map(tr => tr.label)

    filteredSuggestions.forEach(suggestion => {
      const isCategory = traitLabels.includes(suggestion)
      const displayText = t(`suggestions.${suggestionKey(suggestion)}`, suggestion)

      let badgeType: ChipData['badgeType'] = null
      if (isCategory) {
        badgeType = 'id'
      } else if (popularSuggestions.has(suggestion)) {
        badgeType = 'popular'
      } else if (proSuggestions.has(suggestion)) {
        badgeType = 'pro'
      } else if (demoSuggestions.has(suggestion)) {
        badgeType = 'demo'
      }

      map.set(suggestion, {
        text: suggestion,
        displayText,
        isCategory,
        badgeType,
      })
    })
    return map
  }, [filteredSuggestions, t])

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

  // Sync state periodically during continuous scrolling (for visibility calculations)
  const syncStateRef = useRef<number | null>(null)
  const scheduleSyncState = useCallback(() => {
    if (syncStateRef.current) return // Already scheduled
    syncStateRef.current = requestAnimationFrame(() => {
      syncStateRef.current = null
      setOffset({ ...offsetRef.current })
    })
  }, [])

  // Use refs + document-level listeners for reliable dragging
  useEffect(() => {
    // Shared by mouse and touch dragging: track threshold, update offset, repaint
    const applyDrag = (clientX: number, clientY: number) => {
      // Calculate distance from initial pointer position
      const dx = clientX - mouseStartRef.current.x
      const dy = clientY - mouseStartRef.current.y
      const distance = Math.sqrt(dx * dx + dy * dy)

      // Only consider it a drag if movement exceeds threshold
      if (distance > DRAG_THRESHOLD) {
        hasDraggedRef.current = true
      }

      offsetRef.current = {
        x: clientX - dragStartRef.current.x,
        y: clientY - dragStartRef.current.y,
      }
      // Direct DOM update for smooth scrolling (no React re-render)
      updateTransform()
      // Schedule state sync for visibility calculations
      scheduleSyncState()
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return
      applyDrag(e.clientX, e.clientY)
    }

    const handleMouseUp = () => {
      isDraggingRef.current = false
      // Final state sync when drag ends
      setOffset({ ...offsetRef.current })
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
          const zoomSpeed = 0.012
          const newScale = Math.max(0.3, Math.min(3, scaleRef.current + delta * zoomSpeed))
          scaleRef.current = newScale
          updateTransform()
          setScale(newScale)
        }
        lastPinchDistRef.current = dist
        return
      }

      // Single finger drag
      if (!isDraggingRef.current) return

      const touch = e.touches[0]
      applyDrag(touch.clientX, touch.clientY)
    }

    const handleTouchEnd = () => {
      isDraggingRef.current = false
      lastPinchDistRef.current = null
      // Final state sync when touch ends
      setOffset({ ...offsetRef.current })
    }

    // Wheel handler needs to be native to prevent browser zoom (passive: false)
    const handleWheel = (e: WheelEvent) => {
      // Ctrl/Cmd + scroll = zoom (prevent browser zoom)
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        e.stopPropagation()
        const zoomSpeed = 0.008
        const newScale = Math.max(0.3, Math.min(3, scaleRef.current - e.deltaY * zoomSpeed))
        scaleRef.current = newScale
        updateTransform()
        setScale(newScale)
        return
      }

      // Pan the canvas in all directions
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current)
      }

      offsetRef.current = {
        x: offsetRef.current.x - e.deltaX,
        y: offsetRef.current.y - e.deltaY,
      }
      // Direct DOM update for smooth scrolling (no React re-render)
      updateTransform()

      // Debounce state sync to reduce re-renders during fast scrolling
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null
        setOffset({ ...offsetRef.current })
      })
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
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
      if (syncStateRef.current) cancelAnimationFrame(syncStateRef.current)
    }
  }, [updateTransform, scheduleSyncState])

  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true
    hasDraggedRef.current = false
    mouseStartRef.current = { x: e.clientX, y: e.clientY }
    dragStartRef.current = {
      x: e.clientX - offsetRef.current.x,
      y: e.clientY - offsetRef.current.y,
    }
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0]
    isDraggingRef.current = true
    hasDraggedRef.current = false
    mouseStartRef.current = { x: touch.clientX, y: touch.clientY }
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
    updateTransform()
    setOffset(newOffset)
  }

  const handleResetZoom = () => {
    scaleRef.current = 1
    updateTransform()
    setScale(1)
  }

  const handleChipClick = (suggestion: string) => {
    // Only trigger click if we didn't drag
    if (hasDraggedRef.current) return

    // Check if this is a category chip
    const matchingTrait = welcomeTraits.find(t => t.label === suggestion)
    if (matchingTrait) {
      toggleTrait(matchingTrait.id)
      return
    }

    onSuggestionClick(suggestion)
  }

  return (
    <div className="flex-1 relative h-full overflow-hidden">
      {/* Shuffle & Zoom controls - top right of visible chip area (left of mascot on large screens) */}
      <div className="absolute top-2 right-4 lg:right-[calc(27.53%+1rem)] z-10 flex items-center gap-2">
        {scale !== 1 && (
          <button
            onClick={handleResetZoom}
            className={`px-3 py-1.5 text-sm border transition-colors ${
              theme === 'dark'
                ? 'border-white/40 text-white/80 hover:border-white/60 hover:text-white bg-juice-dark/70 backdrop-blur-sm'
                : 'border-gray-400 text-gray-600 hover:border-gray-600 hover:text-gray-900 bg-white/70 backdrop-blur-sm'
            }`}
          >
            {Math.round(scale * 100)}%
          </button>
        )}
        <button
          onClick={handleShuffle}
          className={`px-3 py-1.5 text-sm border transition-colors ${
            theme === 'dark'
              ? 'border-white/40 text-white/80 hover:border-white/60 hover:text-white bg-juice-dark/70 backdrop-blur-sm'
              : 'border-gray-400 text-gray-600 hover:border-gray-600 hover:text-gray-900 bg-white/70 backdrop-blur-sm'
          }`}
        >
          {t('ui.shuffle', 'Shuffle')}
        </button>
      </div>

      {/* Selected categories - top left */}
      {selectedTraits.size > 0 && (
        <div className="absolute top-4 left-4 z-50 flex items-center gap-2">
            {Array.from(selectedTraits).map(traitId => {
              const trait = welcomeTraits.find(t => t.id === traitId)
              if (!trait) return null
              const translatedLabel = t(`suggestions.${suggestionKey(trait.label)}`, trait.label)
              return (
                <button
                  key={traitId}
                  onClick={() => toggleTrait(traitId)}
                  className={`px-3 py-2 text-sm border flex items-center gap-2 transition-colors ${
                    theme === 'dark'
                      ? 'bg-juice-dark/70 backdrop-blur-sm border-juice-orange text-juice-orange hover:bg-juice-dark'
                      : 'bg-white/70 backdrop-blur-sm border-juice-orange text-orange-700 hover:bg-white'
                  }`}
                >
                  {translatedLabel}
                  <span className="text-xs opacity-60">×</span>
                </button>
              )
            })}
            <span className={`text-xs ${
            theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
          }`}>
            {filteredSuggestions.length} {t('ui.matches', 'matches')}
          </span>
        </div>
      )}

      {/* Full-width chips canvas (background layer) */}
      <div
        ref={containerRef}
        className="absolute inset-0 cursor-grab active:cursor-grabbing select-none overflow-hidden"
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        style={{ touchAction: 'none' }}
      >
        <div
          ref={transformRef}
          className="absolute inset-0"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: 'center center',
            willChange: 'transform', // GPU acceleration for smooth scrolling
          }}
        >
          {(() => {
            // Total grid height
            const tileHeight = ROW_COUNT * CHIP_HEIGHT

            // Viewport bounds in scaled coordinates
            const viewTop = -offset.y / scale - containerSize.height / 2 / scale
            const viewBottom = -offset.y / scale + containerSize.height / 2 / scale

            // Determine which row tiles are visible (vertical tiling)
            const minTileY = Math.floor((viewTop + tileHeight / 2) / tileHeight)
            const maxTileY = Math.ceil((viewBottom + tileHeight / 2) / tileHeight)

            // Limit tiles when zoomed out
            const maxTiles = scale < 0.3 ? 1 : scale < 0.5 ? 2 : scale < 0.8 ? 3 : 4
            const clampedMinTileY = Math.max(minTileY, -maxTiles)
            const clampedMaxTileY = Math.min(maxTileY, maxTiles)

            const visibleRows: JSX.Element[] = []

            for (let ty = clampedMinTileY; ty <= clampedMaxTileY; ty++) {
              for (const row of rows) {
                const rowY = row.rowIndex * CHIP_HEIGHT - tileHeight / 2 + ty * tileHeight

                // Skip rows outside visible area
                if (rowY + CHIP_HEIGHT < viewTop - 100 || rowY > viewBottom + 100) continue

                const screenY = containerSize.height / 2 + rowY
                // Stagger each row using golden ratio for pleasing visual offset
                const rowStagger = (row.rowIndex * 0.618033988749 * 200) % 400 - 200

                visibleRows.push(
                  <div
                    key={`${ty}_${row.rowIndex}`}
                    className="absolute flex"
                    style={{
                      top: screenY,
                      height: CHIP_HEIGHT,
                      // Start from far left, offset based on pan + row stagger
                      left: -5000,
                      transform: `translateX(${offset.x % 5000 + rowStagger}px)`,
                    }}
                  >
                    {/* Render chips multiple times for horizontal tiling to fill space */}
                    {[0, 1, 2, 3, 4].map(tileX => (
                      <div key={tileX} className="flex">
                        {row.suggestions.map((suggestion, chipIdx) => {
                          const chipData = chipDataMap.get(suggestion)
                          if (!chipData) return null

                          return (
                            <ChipButton
                              key={`${tileX}_${chipIdx}`}
                              chip={chipData}
                              theme={theme}
                              onClick={() => handleChipClick(chipData.displayText)}
                              t={t}
                            />
                          )
                        })}
                      </div>
                    ))}
                  </div>
                )
              }
            }

            return visibleRows
          })()}
        </div>
      </div>

    </div>
  )
}
