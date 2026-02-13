import { describe, it, expect, beforeEach } from 'vitest'
import { useProjectDraftStore } from './projectDraftStore'

describe('projectDraftStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useProjectDraftStore.getState().clearDraft()
  })

  describe('parseFormSubmission', () => {
    describe('tier parsing', () => {
      it('parses simple tier fields (tier_name, tier_price)', () => {
        const { parseFormSubmission } = useProjectDraftStore.getState()

        parseFormSubmission({
          tier_name: 'Early Supporter',
          tier_price: '25',
          tier_perk: 'Exclusive updates',
        })

        const { tiers } = useProjectDraftStore.getState()
        expect(tiers).toHaveLength(1)
        expect(tiers[0].name).toBe('Early Supporter')
        expect(tiers[0].price).toBe(25)
        expect(tiers[0].description).toBe('Exclusive updates')
      })

      it('parses numbered tier fields (tier1_name, tier1_price)', () => {
        const { parseFormSubmission } = useProjectDraftStore.getState()

        parseFormSubmission({
          tier1_name: 'Gold Member',
          tier1_price: '100',
          tier1_perks: 'VIP access',
        })

        const { tiers } = useProjectDraftStore.getState()
        expect(tiers).toHaveLength(1)
        expect(tiers[0].name).toBe('Gold Member')
        expect(tiers[0].price).toBe(100)
        expect(tiers[0].description).toBe('VIP access')
      })

      it('parses tier with limited supply', () => {
        const { parseFormSubmission } = useProjectDraftStore.getState()

        parseFormSubmission({
          tier_name: 'Limited Edition',
          tier_price: '50',
          tier_quantity: 'limited',
          tier_quantity_amount: '10',
        })

        const { tiers } = useProjectDraftStore.getState()
        expect(tiers).toHaveLength(1)
        expect(tiers[0].name).toBe('Limited Edition')
        expect(tiers[0].initialSupply).toBe(10)
      })

      it('parses tier with unlimited supply (no initialSupply set)', () => {
        const { parseFormSubmission } = useProjectDraftStore.getState()

        parseFormSubmission({
          tier_name: 'Open Tier',
          tier_price: '25',
          tier_quantity: 'unlimited',
        })

        const { tiers } = useProjectDraftStore.getState()
        expect(tiers).toHaveLength(1)
        expect(tiers[0].name).toBe('Open Tier')
        expect(tiers[0].initialSupply).toBeUndefined()
      })

      it('parses tier with media URL', () => {
        const { parseFormSubmission } = useProjectDraftStore.getState()

        parseFormSubmission({
          tier_name: 'With Image',
          tier_price: '25',
          tier_media: 'data:image/png;base64,abc123',
        })

        const { tiers } = useProjectDraftStore.getState()
        expect(tiers).toHaveLength(1)
        expect(tiers[0].imageUrl).toBe('data:image/png;base64,abc123')
      })

      it('updates existing tier by name', () => {
        const { parseFormSubmission } = useProjectDraftStore.getState()

        // Add initial tier
        parseFormSubmission({
          tier_name: 'Early Supporter',
          tier_price: '25',
        })

        // Update same tier with new price
        parseFormSubmission({
          tier_name: 'Early Supporter',
          tier_price: '30',
          tier_quantity: 'limited',
          tier_quantity_amount: '50',
        })

        const { tiers } = useProjectDraftStore.getState()
        expect(tiers).toHaveLength(1)
        expect(tiers[0].name).toBe('Early Supporter')
        expect(tiers[0].price).toBe(30)
        expect(tiers[0].initialSupply).toBe(50)
      })

      it('adds multiple different tiers', () => {
        const { parseFormSubmission } = useProjectDraftStore.getState()

        parseFormSubmission({
          tier_name: 'Tier One',
          tier_price: '25',
        })

        parseFormSubmission({
          tier_name: 'Tier Two',
          tier_price: '50',
        })

        const { tiers } = useProjectDraftStore.getState()
        expect(tiers).toHaveLength(2)
        expect(tiers[0].name).toBe('Tier One')
        expect(tiers[1].name).toBe('Tier Two')
      })

      it('ignores invalid price values', () => {
        const { parseFormSubmission } = useProjectDraftStore.getState()

        parseFormSubmission({
          tier_name: 'Invalid',
          tier_price: 'not-a-number',
        })

        const { tiers } = useProjectDraftStore.getState()
        expect(tiers).toHaveLength(0)
      })

      it('ignores zero price', () => {
        const { parseFormSubmission } = useProjectDraftStore.getState()

        parseFormSubmission({
          tier_name: 'Free Tier',
          tier_price: '0',
        })

        const { tiers } = useProjectDraftStore.getState()
        expect(tiers).toHaveLength(0)
      })

      it('parses price with currency symbol', () => {
        const { parseFormSubmission } = useProjectDraftStore.getState()

        parseFormSubmission({
          tier_name: 'Priced Tier',
          tier_price: '$25.00',
        })

        const { tiers } = useProjectDraftStore.getState()
        expect(tiers).toHaveLength(1)
        expect(tiers[0].price).toBe(25)
      })
    })

    describe('project metadata parsing', () => {
      it('parses project name', () => {
        const { parseFormSubmission } = useProjectDraftStore.getState()

        parseFormSubmission({
          name: 'My Cool Project',
        })

        const { projectName } = useProjectDraftStore.getState()
        expect(projectName).toBe('My Cool Project')
      })

      it('parses project description', () => {
        const { parseFormSubmission } = useProjectDraftStore.getState()

        parseFormSubmission({
          description: 'A great project for everyone',
        })

        const { projectDescription } = useProjectDraftStore.getState()
        expect(projectDescription).toBe('A great project for everyone')
      })
    })

    describe('funding goal parsing', () => {
      it('parses funding_goal', () => {
        const { parseFormSubmission } = useProjectDraftStore.getState()

        parseFormSubmission({
          funding_goal: '5000',
        })

        const { payoutLimit } = useProjectDraftStore.getState()
        expect(payoutLimit).toBe(5000)
      })

      it('parses goal with currency symbol', () => {
        const { parseFormSubmission } = useProjectDraftStore.getState()

        parseFormSubmission({
          goal: '$10,000',
        })

        const { payoutLimit } = useProjectDraftStore.getState()
        expect(payoutLimit).toBe(10000)
      })
    })
  })

  describe('clearDraft', () => {
    it('resets all state to initial values', () => {
      const store = useProjectDraftStore.getState()

      // Set some values
      store.setProjectMeta('Test', 'Description')
      store.addTier({ name: 'Tier', price: 25, currency: 2 })
      store.setPayoutLimit(5000)

      // Clear
      store.clearDraft()

      const state = useProjectDraftStore.getState()
      expect(state.projectName).toBeNull()
      expect(state.projectDescription).toBeNull()
      expect(state.tiers).toHaveLength(0)
      expect(state.payoutLimit).toBeNull()
    })
  })
})
