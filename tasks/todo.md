# Project Dashboard Layout Reorganization

## Status: Complete

## Changes Made

### 1. Updated `src/pages/ProjectDashboard.tsx`
- Changed tab type from `'overview' | 'payments'` to `'about' | 'analytics' | 'rulesets' | 'tokens'`
- Implemented two-column desktop layout:
  - Left column: Main content with tab navigation (About, Analytics, Rulesets & Funds, Tokens)
  - Right column: Sticky sidebar (380px width) with ProjectCard and ActivityFeed
- Tab navigation with juice-orange underline style
- Mobile layout: Stacked tabs with horizontal scroll, ProjectCard embedded in About tab
- Removed old "Pay" button from header (now handled by sidebar ProjectCard)
- Removed old activity sidebar column (activity now in right sidebar)

### 2. Created `src/components/dynamic/FundsSection.tsx`
New component for Rulesets & Funds tab showing:
- Total balance with currency symbol (ETH/USDC)
- Per-chain balance breakdown with chain icons
- Available to pay out (from payout limits)
- Surplus calculation (balance - used payout)
- Collapsible payout recipients list with ENS resolution
- "Send Payouts" button for project owners

### 3. Created `src/components/dynamic/TokensTab.tsx`
New component for Tokens tab showing:
- User's token balance (when connected)
- Project token info (symbol, ERC-20 badge, contract address with copy button)
- Total supply
- Reserved tokens section:
  - Chain selector for omnichain projects
  - Reserved rate percentage
  - Pending distribution amount
  - Collapsible recipients list
  - "Send Reserved Tokens" button for owners

### 4. Updated `src/components/dynamic/ProjectCard.tsx`
- Added `embedded` prop for sidebar display mode
- When `embedded=true`: removes outer container styling, hides header/tagline/stats (already shown in dashboard)
- Keeps full payment functionality

### 5. Updated `src/components/dynamic/ActivityFeed.tsx`
- Added `compact` prop for sidebar display mode
- When `compact=true`: removes outer container and header (dashboard provides its own Activity header)
- Same event list functionality

## Verification Steps

1. Navigate to a project dashboard (e.g., `/base:3`)
2. **Layout**: Two columns visible on desktop, right sidebar sticky
3. **About tab**: Shows project description (default tab)
4. **Analytics tab**: Shows Volume, Holders, Balance, Price charts in 2x2 grid
5. **Rulesets & Funds tab**: Shows RulesetSchedule + FundsSection with balance breakdown
6. **Tokens tab**: Shows token info, user balance, reserved tokens section
7. **Right sidebar**: Pay/Cash out panel works, Activity scrolls independently
8. **Mobile**: Falls back to stacked layout with tabs scrollable

## Files Modified
- `src/pages/ProjectDashboard.tsx` - Main layout restructure
- `src/components/dynamic/ProjectCard.tsx` - Added embedded mode
- `src/components/dynamic/ActivityFeed.tsx` - Added compact mode

## Files Created
- `src/components/dynamic/FundsSection.tsx` - Funds breakdown display
- `src/components/dynamic/TokensTab.tsx` - Token info and reserved tokens
