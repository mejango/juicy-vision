export * from './project-creation'
export * from './store-management'
export * from './comprehensive'

/**
 * All available test scenarios grouped by category.
 */
export const ALL_SCENARIOS = {
  projectCreation: {
    main: [
      'Create a project called "TestStore" using the chat interface',
      'Create a project with description and custom settings',
    ],
    edgeCases: [
      'Try to create a project without providing a name',
      'Create a project with special characters in the name',
    ],
  },
  storeManagement: {
    main: [
      'Navigate to a project dashboard and add a new tier',
      'Edit an existing tier price and supply',
      'Apply a discount to a tier',
    ],
    edgeCases: [
      'Try to create a tier with zero supply',
      'Try to apply a discount over 100%',
    ],
  },
  userJourneys: {
    main: [
      'Complete user journey: sign in with passkey, create project, add tiers, view dashboard',
      'Complete buyer journey: find a project, view tiers, make a purchase',
    ],
  },
  accessibility: {
    main: [
      'Navigate the entire app using only keyboard',
      'Verify all interactive elements have accessible labels',
    ],
  },
}

/**
 * Get a random scenario from a category.
 */
export function getRandomScenario(category?: keyof typeof ALL_SCENARIOS): string {
  const categories = category ? [category] : Object.keys(ALL_SCENARIOS) as (keyof typeof ALL_SCENARIOS)[]
  const randomCategory = categories[Math.floor(Math.random() * categories.length)]
  const scenarios = [
    ...ALL_SCENARIOS[randomCategory].main,
    ...(ALL_SCENARIOS[randomCategory] as Record<string, string[]>).edgeCases || [],
  ]
  return scenarios[Math.floor(Math.random() * scenarios.length)]
}
