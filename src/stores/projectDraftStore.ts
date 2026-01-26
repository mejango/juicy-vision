import { create } from 'zustand'

// Tier data collected from forms
export interface DraftTier {
  name: string
  price: number
  currency: number // 1 = ETH, 2 = USD
  description?: string
  imageUrl?: string
}

// Split/payout data collected from forms
export interface DraftSplit {
  address: string
  percent: number // 0-100
  label?: string
}

interface ProjectDraftState {
  // Project metadata
  projectName: string | null
  projectDescription: string | null
  projectLogo: string | null

  // Tiers
  tiers: DraftTier[]

  // Payouts
  payoutLimit: number | null // funding goal
  payoutCurrency: number // 1 = ETH, 2 = USD
  splits: DraftSplit[]

  // Actions
  setProjectMeta: (name: string, description?: string, logo?: string) => void
  addTier: (tier: DraftTier) => void
  setTiers: (tiers: DraftTier[]) => void
  setPayoutLimit: (limit: number, currency?: number) => void
  setSplits: (splits: DraftSplit[]) => void
  clearDraft: () => void

  // Parse form submission and extract relevant data
  parseFormSubmission: (selections: Record<string, string>) => void
}

const initialState = {
  projectName: null,
  projectDescription: null,
  projectLogo: null,
  tiers: [],
  payoutLimit: null,
  payoutCurrency: 2, // USD by default
  splits: [],
}

export const useProjectDraftStore = create<ProjectDraftState>((set, get) => ({
  ...initialState,

  setProjectMeta: (name, description, logo) => set({
    projectName: name,
    projectDescription: description ?? get().projectDescription,
    projectLogo: logo ?? get().projectLogo,
  }),

  addTier: (tier) => set((state) => ({
    tiers: [...state.tiers, tier],
  })),

  setTiers: (tiers) => set({ tiers }),

  setPayoutLimit: (limit, currency) => set({
    payoutLimit: limit,
    payoutCurrency: currency ?? get().payoutCurrency,
  }),

  setSplits: (splits) => set({ splits }),

  clearDraft: () => set(initialState),

  // Parse form submissions and extract tier/payout/metadata info
  parseFormSubmission: (selections) => {
    const updates: Partial<ProjectDraftState> = {}

    // Check for project name
    if (selections.name && typeof selections.name === 'string') {
      updates.projectName = selections.name
    }
    if (selections.description && typeof selections.description === 'string') {
      updates.projectDescription = selections.description
    }

    // Check for tier data (tier1_name, tier1_price, etc.)
    const tierMatch = Object.keys(selections).find(k => k.match(/^tier\d+_name$/))
    if (tierMatch) {
      const tierNum = tierMatch.match(/^tier(\d+)_name$/)?.[1]
      if (tierNum) {
        const tierName = selections[`tier${tierNum}_name`]
        const tierPrice = selections[`tier${tierNum}_price`]
        const tierDescription = selections[`tier${tierNum}_custom_perks`] || selections[`tier${tierNum}_perks`]

        if (tierName && typeof tierName === 'string' && tierPrice && typeof tierPrice === 'string') {
          const priceNum = parseFloat(tierPrice.replace(/[^0-9.]/g, ''))
          if (!isNaN(priceNum) && priceNum > 0) {
            // Check for tier image/video (data URL or regular URL)
            const tierImage = selections[`tier${tierNum}_media`] || selections[`tier${tierNum}_image`]
            let imageUrl: string | undefined
            if (tierImage && typeof tierImage === 'string') {
              // Accept data URLs (image or video) or http URLs
              if (tierImage.startsWith('data:image/') || tierImage.startsWith('data:video/') || tierImage.startsWith('http')) {
                imageUrl = tierImage
              }
            }

            const newTier: DraftTier = {
              name: tierName,
              price: priceNum,
              currency: 2, // Assume USD for now
              description: typeof tierDescription === 'string' ? tierDescription : undefined,
              imageUrl,
            }

            // Replace or add tier
            set((state) => {
              const existingIndex = state.tiers.findIndex(t => t.name === tierName)
              if (existingIndex >= 0) {
                const newTiers = [...state.tiers]
                newTiers[existingIndex] = newTier
                return { tiers: newTiers }
              }
              return { tiers: [...state.tiers, newTier] }
            })
          }
        }
      }
    }

    // Check for funding goal
    const goalValue = selections.funding_goal || selections.goal
    if (goalValue && typeof goalValue === 'string') {
      const goalNum = parseFloat(goalValue.replace(/[^0-9.]/g, ''))
      if (!isNaN(goalNum) && goalNum > 0) {
        updates.payoutLimit = goalNum
      }
    }

    // Apply updates
    if (Object.keys(updates).length > 0) {
      set(updates)
    }
  },
}))
