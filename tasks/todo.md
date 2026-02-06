# Shop Tab for 721 NFT Projects

## Status: Complete

## Changes Made

### 1. Updated `src/pages/ProjectDashboard.tsx`
- Added import for `hasNFTHook` from `services/nft`
- Added import for `ShopTab` component
- Added `hasNftHook` state variable
- Updated `DashboardTab` type to include `'shop'`
- Modified project load effect to check for NFT hook presence
- Made tabs array dynamic using `useMemo` - Shop tab only appears when `hasNftHook` is true
- Added ShopTab rendering in both desktop and mobile tab content sections

### 2. Created `src/components/dynamic/ShopTab.tsx`
New component for browsing and purchasing NFT tiers:
- Fetches tiers using `fetchProjectNFTTiers(projectId, chainId)`
- Fetches ETH price for USD display
- Category filter bar (horizontal chips: "All", then unique categories)
- Groups and displays tiers by category when "All" selected
- Filters to single category when category chip clicked
- Responsive grid of `NFTTierCard` components (2-3 columns)
- Loading skeleton during fetch
- Empty state if no tiers

## UI Layout

```
┌─────────────────────────────────────────────────┐
│ [All] [Category 1] [Category 2] [Category 3]    │  ← Filter chips
├─────────────────────────────────────────────────┤
│ Category 1 (if showing all)                     │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐            │
│ │ Tier    │ │ Tier    │ │ Tier    │            │
│ │ Card    │ │ Card    │ │ Card    │            │
│ └─────────┘ └─────────┘ └─────────┘            │
│                                                 │
│ Category 2                                      │
│ ┌─────────┐ ┌─────────┐                        │
│ │ Tier    │ │ Tier    │                        │
│ │ Card    │ │ Card    │                        │
│ └─────────┘ └─────────┘                        │
└─────────────────────────────────────────────────┘
```

## Mint Integration
Uses existing `NFTTierCard` mint button which:
- Checks wallet connection (opens wallet panel if not connected)
- Dispatches `juice:mint-nft` event
- Tracks transaction in store
- Shows quantity selector for multi-mint

## Verification Steps

1. Visit `/base:3` (no 721 hooks) → Shop tab should NOT appear
2. Visit `/eth:4` (Banny Network, has 721 hooks) → Shop tab SHOULD appear
3. Shop tab shows tiers in grid with category filters
4. Category filter chips work correctly (shows grouped when All, filtered when category selected)
5. Mint button opens wallet panel if not connected
6. Mint initiates transaction when wallet connected
7. Tests pass (1244 passed), build succeeds

## Files Modified
- `src/pages/ProjectDashboard.tsx` - Added Shop tab logic and rendering

## Files Created
- `src/components/dynamic/ShopTab.tsx` - NFT tier browsing and minting
