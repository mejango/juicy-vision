# Juicy Vision Style Guide

A design system for Juicebox's conversational treasury interface.

## Design Philosophy

**Juicy** = Bold, vibrant, full of life. Not sterile or corporate.

**Vision** = Clear, focused, purposeful. Not cluttered or distracting.

The interface should feel like a conversation with a knowledgeable friend who happens to know everything about programmable money. Direct, confident, slightly playful.

---

## Color System

### Brand Colors

```
juice-orange   #F5A623   Primary accent. CTAs, highlights, active states.
juice-cyan     #5CEBDF   Secondary accent. Links, interactive elements.
```

Orange for action. Cyan for interaction.

### Surfaces (Dark Mode - Default)

```
juice-dark          #1a1a1a   Base background
juice-dark-lighter  #2a2a2a   Elevated surfaces (inputs, cards)
white/5             rgba      Glass effect background
white/10            rgba      Glass effect hover
```

### Surfaces (Light Mode)

```
juice-light         #f5f5f5   Base background
juice-light-darker  #e5e5e5   Elevated surfaces
black/5             rgba      Subtle backgrounds
```

### Text Hierarchy

| Role | Dark Mode | Light Mode |
|------|-----------|------------|
| Primary | `white` | `gray-900` |
| Secondary | `gray-400` | `gray-500` |
| Tertiary | `gray-500` | `gray-400` |
| Muted | `gray-600` | `gray-300` |

**Rule**: Use only these four levels. If you need more, the hierarchy is wrong.

### Semantic Colors

```
Success    green-500 / green-400 (dark hover)
Error      red-500 / red-400
Warning    amber-400
Info       juice-cyan
```

### Chain Colors (Reserved)

```
Ethereum   #627EEA
Optimism   #FF0420
Base       #0052FF
Arbitrum   #28A0F0
```

Use only for chain identification. Never for decoration.

### Chart Colors

All charts use colors from `src/components/dynamic/charts/utils.ts`.

```
primary      #F5A623   Data series 1 (juice-orange)
secondary    #5CEBDF   Data series 2 (juice-cyan)
tertiary     #10b981   Data series 3 (emerald)
quaternary   #f59e0b   Data series 4 (amber)

axis         #666666   Axis labels (dark mode)
axisLight    #999999   Axis labels (light mode)
grid         white/10  Grid lines (dark mode)
gridLight    black/10  Grid lines (light mode)
```

**Rule**: Never hardcode chart colors. Import from `CHART_COLORS` or `getChainColor()`.

---

## Typography

### Font Stack

```css
font-family: 'JetBrains Mono', 'Menlo', monospace;
```

Monospace everywhere. No exceptions. It's a terminal for your treasury.

### Scale

| Name | Size | Use |
|------|------|-----|
| `text-xs` | 12px | Labels, metadata, timestamps |
| `text-sm` | 14px | Body text, buttons, inputs |
| `text-base` | 16px | Emphasized body, large buttons |
| `text-lg` | 18px | Section headers |
| `text-xl` | 20px | Page titles |

**Rule**: Most UI is `text-xs` or `text-sm`. Large text is rare and intentional.

### Weights

```
font-normal     Body text
font-medium     Labels, buttons
font-semibold   Headers, emphasis
font-bold       Hero text only
```

---

## Shapes

### Border Radius

**Sharp edges are the default.** No `rounded` classes on most elements.

| Element | Radius |
|---------|--------|
| Buttons | None (square) |
| Inputs | None (square) |
| Cards | None (square) |
| Modals | `rounded-lg` (exception for floating panels) |
| Pills/Tags | `rounded-full` (circular indicators only) |
| Spinners | `rounded-full` |

The sharp aesthetic reinforces the technical, precise nature of treasury management.

### Borders

```
border-white/10    Default dark mode borders
border-white/20    Hover/active dark mode borders
border-gray-200    Default light mode borders
border-gray-300    Hover/active light mode borders
```

**The orange frame**: The app has a 4px `border-juice-orange` frame around the viewport. This is sacred. Internal elements do NOT use orange borders except as dividers between major sections.

---

## Spacing

### Base Unit

`4px` (Tailwind's default). Use multiples: 1, 1.5, 2, 3, 4, 6, 8.

### Component Padding

| Element | Padding |
|---------|---------|
| Buttons (sm) | `px-3 py-1.5` |
| Buttons (md) | `px-4 py-2` |
| Buttons (lg) | `px-6 py-3` |
| Inputs | `px-4 py-2.5` |
| Cards | `p-4` |
| Modals | `p-4` |

### Layout Gaps

```
gap-1.5   Tight (icon + text)
gap-2     Standard (button contents)
gap-3     Comfortable (form fields)
gap-4     Spacious (card sections)
```

---

## Components

### Buttons

**Primary (Cyan)**: Cyan background, dark text. **Reserved for prompt-creating actions only** — buttons that submit to the chat or trigger AI responses.
```
bg-juice-cyan text-juice-dark hover:bg-juice-cyan/90
```

**Success/Confirm**: Green outline for confirmations, form submissions, and non-chat actions.
```
Dark:  border border-green-500 text-green-500 hover:bg-green-500/10
Light: border border-green-600 text-green-600 hover:bg-green-600/10
```

**Secondary**: Subtle background, bordered.
```
Dark:  bg-juice-dark-lighter border-white/20 text-white
Light: bg-gray-100 border-gray-300 text-gray-900
```

**Ghost**: Transparent, text only.
```
Dark:  text-gray-300 hover:text-white hover:bg-white/10
Light: text-gray-600 hover:text-gray-900 hover:bg-gray-100
```

**Danger**: Red, for destructive actions.
```
bg-red-600 hover:bg-red-700 text-white
```

### Inputs

Square. Subtle background. Obvious focus state.

```
Dark:  bg-juice-dark-lighter border-white/10 focus:border-white/30
Light: bg-white border-gray-300 focus:border-gray-400
```

The chat input is special: `border-2 border-juice-cyan` with thicker focus.

### Cards & Panels

No visible borders by default. Use background differentiation.

```
Glass effect: bg-white/5 backdrop-blur-md border-white/10
```

### Modals

Floating panels anchored to trigger position. `shadow-xl rounded-lg`.

```
Dark:  bg-juice-dark border-white/20
Light: bg-white border-gray-200
```

### Popovers

All popovers must behave identically. No exceptions.

**Positioning**:
- Appears directly adjacent to trigger button (8px gap)
- Shows above button if button is in lower half of viewport
- Shows below button if button is in upper half of viewport
- Right-aligned to button's right edge (for right-side buttons)

**Scrolling**:
- Popover position updates on scroll to stay anchored to trigger button
- Use scroll listener with capture phase: `addEventListener('scroll', handler, true)`
- Store ref to trigger button, recalculate position on scroll

**Backdrop & Dismissal**:
- Full-screen transparent backdrop (`fixed inset-0`) behind popover
- Backdrop z-index one level below popover (e.g., `z-[99]` backdrop, `z-[100]` popover)
- Click on backdrop closes popover
- Nothing on page is clickable until popover is dismissed
- Close button (X) in top-right corner of popover

**Implementation Pattern**:
```tsx
// Trigger button stores ref and calculates position
const buttonRef = useRef<HTMLButtonElement>(null)
const [anchorPosition, setAnchorPosition] = useState<AnchorPosition | null>(null)

// Scroll listener updates position
useEffect(() => {
  if (!isOpen || !buttonRef.current) return
  const updatePosition = () => {
    const rect = buttonRef.current!.getBoundingClientRect()
    const isInBottomHalf = rect.top > window.innerHeight / 2
    setAnchorPosition({
      top: rect.bottom + 8,
      bottom: window.innerHeight - rect.top + 8,
      right: window.innerWidth - rect.right,
      position: isInBottomHalf ? 'above' : 'below'
    })
  }
  window.addEventListener('scroll', updatePosition, true)
  return () => window.removeEventListener('scroll', updatePosition, true)
}, [isOpen])

// CRITICAL: Always use createPortal to escape containing blocks
// (backdrop-filter, transform, etc. create new containing blocks that break position: fixed)
return createPortal(
  <>
    <div className="fixed inset-0 z-[49]" onClick={onClose} />
    <div className="fixed z-50" style={popoverStyle}>
      {/* content */}
    </div>
  </>,
  document.body
)
```

**Styling**:
```
Dark:  bg-juice-dark border-white/20 shadow-xl
Light: bg-white border-gray-200 shadow-xl
```

**No rounded corners.** Popovers follow the same sharp aesthetic as the rest of the app. Never add `rounded-lg` or any other border radius to popovers.

---

## Effects

### Transitions

```
transition-colors duration-200   Color changes
transition-all duration-150      Size/position changes
```

Everything animates. Nothing snaps.

### Glass Effect

```css
.glass {
  @apply bg-white/5 backdrop-blur-md border border-white/10;
}
```

Use sparingly. For overlays on content, not as default card style.

### Glows

```css
.glow-orange { box-shadow: 0 0 20px rgba(245, 166, 35, 0.3); }
.glow-cyan   { box-shadow: 0 0 20px rgba(92, 235, 223, 0.3); }
```

For emphasis on hover/active states. Never static decoration.

### Shimmer (Loading)

Animated gradient sweep in brand colors for loading states.

---

## Layout Principles

### Golden Ratio Grid

The app uses golden ratio (62/38) for major layout divisions:
- Welcome mode: 62% recommendations / 38% prompt dock
- Mascot panel: 27.53% of width (≈ 38% × 72.47%)
- Activity sidebar: ≈14.44% of width (38% × 38%)

### Content Width

Chat messages: `max-w-5xl mx-auto` (1024px max)

### Z-Index Layers

```
z-0    Base content
z-10   Overlays on content
z-40   Header
z-50   Modals, popovers
```

---

## Responsive Design

**Core Principle**: Always favor the chat experience. The conversation is the product.

### Screen Size Tiers

| Tier | Width | Priority |
|------|-------|----------|
| XS | < 480px | Chat only. Nothing else matters. |
| SM | 480-768px | Chat + minimal context |
| MD | 768-1024px | Chat + activity sidebar |
| LG | 1024-1440px | Full experience |
| XL | > 1440px | Full experience with breathing room |

### Golden Ratio Content Distribution

All layouts derive from the golden ratio (φ ≈ 1.618). Major divisions follow 62/38 splits.

#### XS/SM Viewport — Landing (Pre-Chat)

```
┌─────────────────────────────────┐
│                                 │
│   Recommendation Chips          │  62%
│   (vertically scrollable)       │
│                                 │
├─────────────────────────────────┤
│   Prompt Input Section          │  38%
│   + Account Connection Status   │
└─────────────────────────────────┘
```

- Recommendation chips: 62% of viewport height, scrollable vertically
- Prompt dock: 38% of viewport height, fixed at bottom
- Account status indicators live within the prompt section (compact icons)

#### XS/SM Viewport — Active Chat

```
┌─────────────────────────────────┐
│                                 │
│   Message Thread                │  ~90%
│   (scrollable)                  │
│                                 │
├─────────────────────────────────┤
│     ○ ○ ○                       │  ~12-14px status bar
│ [📎] [Input_________________]   │  48px
└─────────────────────────────────┘
```

- Messages take maximum vertical space
- Compact status bar ABOVE input: status dots only on XS (tap to open wallet panel)
- Input bar: 48px base height, auto-expands for multiline up to 120px
- Total input area: ~60-62px (status bar + input)
- No wasted vertical space — every pixel serves the conversation

#### MD Viewport — Landing

```
┌───────────────────────────┬─────────────┐
│                           │             │
│   Recommendation Chips    │  Activity   │
│   (scrollable)            │  Feed       │  62% height
│                           │             │
├───────────────────────────┴─────────────┤
│   Prompt Input + Account Status         │  38% height
└─────────────────────────────────────────┘
        62% width             38% of 38%
                              ≈ 14.4%
```

- Activity sidebar appears at 38% × 38% ≈ 14.4% of total width
- Main content area: 62% + (38% × 62%) ≈ 85.6% of width
- Vertical split remains 62/38

#### MD Viewport — Active Chat

```
┌───────────────────────────┬─────────────┐
│                           │             │
│   Message Thread          │  Activity   │
│                           │  (optional) │
│                           │             │
├───────────────────────────┴─────────────┤
│     ○ ○ ○ · 0x12...78 · $42.50         │  ~16px
│ [📎] [Input_________________________]   │  48px
└─────────────────────────────────────────┘
```

- Chat thread dominates
- Activity sidebar can collapse to maximize chat on demand
- Compact status bar above input: dots + truncated address + balance
- Clicking status bar opens wallet panel

#### LG/XL Viewport — Full Layout

```
┌────────────┬─────────────────────────────┬─────────────┐
│            │                             │             │
│   Mascot   │   Chat / Recommendations    │  Activity   │
│   Panel    │                             │  Sidebar    │
│   27.5%    │          58.1%              │   14.4%     │
│            │                             │             │
└────────────┴─────────────────────────────┴─────────────┘
```

Width breakdown (golden ratio derived):
- Mascot panel: 38% × 72.47% ≈ 27.53%
- Activity sidebar: 38% × 38% ≈ 14.44%
- Main content: 100% - 27.53% - 14.44% ≈ 58.03%

### Input Bar Behavior

The prompt input should be **as slim as reasonable** during active chat:

| State | Input Height | Notes |
|-------|--------------|-------|
| Landing | 38% of viewport | Full prompt dock with WalletInfo below |
| Active Chat | ~60-64px | Status bar (~14-16px) + input (48px) |
| Expanded | max 120px input | When user is typing multiline content |

Account connection status (compact status bar above input):
- XS: Status dots only (○ ○ ○), tap to open wallet panel
- SM: Dots + truncated address
- MD+: Dots + address + balance (e.g., "○ ○ ○ · 0x12...78 · $42.50")

### Collapsible Panels

On smaller viewports, panels collapse in this priority order (first to go → last):

1. Mascot panel (first to collapse)
2. Activity sidebar
3. Everything else stays — chat is non-negotiable

### Breakpoint Classes

```css
/* Tailwind breakpoints aligned to tiers */
xs:    @media (min-width: 480px)
sm:    @media (min-width: 640px)
md:    @media (min-width: 768px)
lg:    @media (min-width: 1024px)
xl:    @media (min-width: 1280px)
2xl:   @media (min-width: 1536px)
```

### Responsive Anti-Patterns

**Don't**:
- Hide the chat input at any viewport
- Show sidebars before the chat has room to breathe
- Make input bars tall during active conversation
- Stack account info vertically when horizontal fits
- Force users to scroll to reach the input

**Do**:
- Collapse decoration first, content last
- Keep input accessible with one thumb on mobile
- Use inline/horizontal layouts for status indicators
- Let chat messages use full available width on small screens
- Progressive disclosure: less chrome on smaller screens

---

## Anti-Patterns

### Don't

- Use `rounded` on buttons or inputs (stay sharp)
- Mix gray scales (pick 400/500 or commit)
- Add orange borders inside the app (reserved for frame)
- Use cyan for text (it's for interactive elements)
- Over-use glass effect (it should feel special)
- Add shadows to inline elements (shadows are for floating UI)

### Do

- Keep text small and dense
- Use whitespace for grouping, not borders
- Let the orange frame do the heavy lifting
- Default to square, round only when semantic (status dots)
- Trust the monospace font to create visual rhythm

---

## Dark/Light Mode

Both modes are first-class. Design for dark first (it's the default), then verify light.

The theme toggle exists but shouldn't be prominent. Most users will stay in dark mode.

Color choices must work in both modes. Test both before shipping.

---

## Extending This System

When adding new components:

1. Check if an existing pattern applies
2. Use the defined color tokens, never raw hex
3. Match the established spacing rhythm
4. Keep it sharp (no rounding) unless semantically required
5. Test in both themes
6. Ask: "Does this feel juicy but focused?"
