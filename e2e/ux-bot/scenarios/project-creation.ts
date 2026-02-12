/**
 * Project creation test scenarios for the UX bot.
 */

export const PROJECT_CREATION_SCENARIOS = [
  {
    name: 'Basic Project Creation',
    description: 'Create a simple project via chat',
    scenario: 'Create a project called "TestStore" using the chat interface',
    expectedOutcome: 'Project is created and user can see dashboard link',
  },
  {
    name: 'Project with Custom Details',
    description: 'Create a project with description and settings',
    scenario: 'Create a project called "NFT Gallery" with a description "A gallery for NFT art" and set it up for selling digital art',
    expectedOutcome: 'Project is created with custom metadata',
  },
  {
    name: 'Multi-chain Project',
    description: 'Create a project deployed on multiple chains',
    scenario: 'Create an omnichain project called "Global Store" that works on Ethereum, Optimism, and Base',
    expectedOutcome: 'Project is deployed on all specified chains',
  },
]

export const PROJECT_CREATION_EDGE_CASES = [
  {
    name: 'Empty Project Name',
    scenario: 'Try to create a project without providing a name',
    expectedBehavior: 'Should show validation error',
  },
  {
    name: 'Special Characters in Name',
    scenario: 'Create a project called "Test @#$% Store!!!"',
    expectedBehavior: 'Should handle or reject special characters appropriately',
  },
  {
    name: 'Very Long Project Name',
    scenario: 'Create a project with a name that is 200 characters long',
    expectedBehavior: 'Should truncate or show character limit',
  },
  {
    name: 'Duplicate Project Name',
    scenario: 'Create two projects with the same name "Duplicate Test"',
    expectedBehavior: 'Should allow or show appropriate handling',
  },
]
