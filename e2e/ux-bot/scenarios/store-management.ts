/**
 * Store management test scenarios for the UX bot.
 */

export const STORE_MANAGEMENT_SCENARIOS = [
  {
    name: 'Add Single Tier',
    description: 'Add a new tier to an existing project',
    scenario: 'Navigate to a project dashboard and add a new tier called "Gold" with price 0.1 ETH and supply of 100',
    expectedOutcome: 'Tier is added and visible in the tier list',
  },
  {
    name: 'Add Multiple Tiers',
    description: 'Add several tiers to a project',
    scenario: 'Add three tiers to a project: Bronze (0.01 ETH, 1000 supply), Silver (0.05 ETH, 500 supply), Gold (0.1 ETH, 100 supply)',
    expectedOutcome: 'All tiers are created and displayed in order',
  },
  {
    name: 'Edit Tier Price',
    description: 'Modify the price of an existing tier',
    scenario: 'Find an existing tier and change its price from 0.1 ETH to 0.15 ETH',
    expectedOutcome: 'Tier price is updated successfully',
  },
  {
    name: 'Apply Discount',
    description: 'Add a discount to a tier',
    scenario: 'Apply a 20% discount to an existing tier',
    expectedOutcome: 'Discount is applied and reflected in the UI',
  },
  {
    name: 'Remove Tier',
    description: 'Delete an existing tier',
    scenario: 'Delete a tier that has no sales',
    expectedOutcome: 'Tier is removed from the list',
  },
]

export const STORE_MANAGEMENT_EDGE_CASES = [
  {
    name: 'Zero Price Tier',
    scenario: 'Try to create a tier with price 0',
    expectedBehavior: 'Should allow free tiers or show validation error',
  },
  {
    name: 'Negative Price',
    scenario: 'Try to create a tier with negative price',
    expectedBehavior: 'Should show validation error',
  },
  {
    name: 'Zero Supply',
    scenario: 'Try to create a tier with 0 supply',
    expectedBehavior: 'Should reject or create unlimited tier',
  },
  {
    name: 'Delete Tier with Sales',
    scenario: 'Try to delete a tier that has existing sales',
    expectedBehavior: 'Should prevent deletion or show warning',
  },
  {
    name: 'Discount Over 100%',
    scenario: 'Try to apply a 150% discount to a tier',
    expectedBehavior: 'Should show validation error',
  },
  {
    name: 'Very High Price',
    scenario: 'Create a tier with price 1000000 ETH',
    expectedBehavior: 'Should handle large numbers correctly',
  },
]
