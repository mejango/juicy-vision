import type { Page } from '@playwright/test'

// ============================================================================
// Types
// ============================================================================

export interface ChatMessage {
  id: string
  chatId: string
  senderAddress: string
  role: 'user' | 'assistant' | 'system'
  content: string
  isEncrypted: boolean
  createdAt: string
  isStreaming?: boolean
  attachments?: Array<{
    type: string
    data: string
    filename?: string
  }>
}

export interface Chat {
  id: string
  founderAddress: string
  name: string
  description?: string
  isPublic: boolean
  isPrivate: boolean
  encrypted: boolean
  aiEnabled: boolean
  aiBalanceWei: string
  members: Array<{
    address: string
    role: 'founder' | 'admin' | 'member'
    canSendMessages: boolean
    canInvite: boolean
    canInvokeAi: boolean
    canManageMembers: boolean
    canPauseAi: boolean
  }>
  messages: ChatMessage[]
  isPinned: boolean
  folderId?: string
  onlineMembers: string[]
}

export interface Project {
  id: number
  chainId: number
  name: string
  description?: string
  handle?: string
  owner: string
  createdAt: string
  metadata?: Record<string, unknown>
}

export interface TransactionBundle {
  bundleId: string
  status: 'pending' | 'submitted' | 'confirmed' | 'failed'
  transactions: Array<{
    chainId: number
    target: string
    data: string
    value: string
    hash?: string
    status?: string
  }>
}

// ============================================================================
// Mock Data Generators
// ============================================================================

let idCounter = 0
const generateId = () => `test-${++idCounter}-${Date.now()}`

export function createMockChat(overrides: Partial<Chat> = {}): Chat {
  const id = generateId()
  return {
    id,
    founderAddress: '0x1234567890123456789012345678901234567890',
    name: 'Test Chat',
    isPublic: true,
    isPrivate: false,
    encrypted: false,
    aiEnabled: true,
    aiBalanceWei: '1000000000000000000',
    members: [{
      address: '0x1234567890123456789012345678901234567890',
      role: 'founder',
      canSendMessages: true,
      canInvite: true,
      canInvokeAi: true,
      canManageMembers: true,
      canPauseAi: true,
    }],
    messages: [],
    isPinned: false,
    onlineMembers: [],
    ...overrides,
  }
}

export function createMockMessage(chatId: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: generateId(),
    chatId,
    senderAddress: '0x1234567890123456789012345678901234567890',
    role: 'user',
    content: 'Test message',
    isEncrypted: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

export function createMockProject(overrides: Partial<Project> = {}): Project {
  return {
    id: Math.floor(Math.random() * 10000),
    chainId: 1,
    name: 'Test Project',
    owner: '0x1234567890123456789012345678901234567890',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

export function createMockTransactionBundle(overrides: Partial<TransactionBundle> = {}): TransactionBundle {
  return {
    bundleId: generateId(),
    status: 'pending',
    transactions: [{
      chainId: 1,
      target: '0x0000000000000000000000000000000000000000',
      data: '0x',
      value: '0',
    }],
    ...overrides,
  }
}

// ============================================================================
// AI Response Mocks
// ============================================================================

/**
 * Canned AI responses for deterministic testing.
 * Each response includes the full message with any tool calls/components.
 */
export const AI_RESPONSES = {
  greeting: {
    content: "Hello! I'm here to help you create and manage Juicebox projects. What would you like to do today?",
  },

  projectCreation: {
    content: `I'll help you create a new project. Here's what I've prepared:

<transaction-preview>
{
  "type": "launchProject",
  "name": "TestStore",
  "description": "A test project",
  "chainIds": [1],
  "owner": "{{OWNER_ADDRESS}}"
}
</transaction-preview>

Review the transaction details above and click "Deploy" when ready.`,
  },

  projectCreationSuccess: {
    content: `Your project has been deployed successfully!

**Project Details:**
- Name: TestStore
- Project ID: 123
- Chain: Ethereum Mainnet

You can manage your project at: [Dashboard](/project/123/1)`,
  },

  addTier: {
    content: `I'll add a new tier to your project:

<transaction-preview>
{
  "type": "addTier",
  "projectId": 123,
  "chainId": 1,
  "tier": {
    "name": "Gold Tier",
    "price": "0.1",
    "supply": 100
  }
}
</transaction-preview>

Review and confirm to add this tier.`,
  },

  error: {
    content: "I encountered an error while processing your request. Please try again or contact support if the issue persists.",
  },
} as const

// ============================================================================
// API Route Mocking
// ============================================================================

/**
 * Mock all chat-related API endpoints for deterministic testing.
 */
export async function mockChatEndpoints(page: Page, options: {
  chats?: Chat[]
  aiResponse?: { content: string }
  streamingDelay?: number
} = {}) {
  const { chats = [], aiResponse = AI_RESPONSES.greeting, streamingDelay = 50 } = options

  // Mock chat list
  await page.route('**/chat', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { chats } }),
      })
    } else if (route.request().method() === 'POST') {
      const newChat = createMockChat()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { chat: newChat } }),
      })
    } else {
      await route.continue()
    }
  })

  // Mock AI invocation with streaming simulation
  await page.route('**/chat/*/ai/invoke', async (route) => {
    // Simulate streaming response
    const content = aiResponse.content
    const chunks = content.match(/.{1,50}/g) || [content]

    // Return streaming response
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: chunks.map((chunk, i) =>
        `data: ${JSON.stringify({ type: 'chunk', content: chunk, done: i === chunks.length - 1 })}\n\n`
      ).join(''),
    })
  })

  // Mock message send
  await page.route('**/chat/*/messages', async (route) => {
    if (route.request().method() === 'POST') {
      const body = JSON.parse(route.request().postData() || '{}')
      const message = createMockMessage(body.chatId || 'test', {
        content: body.content,
        role: 'user',
      })
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { message } }),
      })
    } else {
      await route.continue()
    }
  })
}

/**
 * Mock project-related API endpoints.
 */
export async function mockProjectEndpoints(page: Page, options: {
  projects?: Project[]
  createSuccess?: boolean
} = {}) {
  const { projects = [], createSuccess = true } = options

  // Mock project list
  await page.route('**/projects', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { projects } }),
      })
    } else if (route.request().method() === 'POST') {
      if (createSuccess) {
        const newProject = createMockProject()
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { project: newProject } }),
        })
      } else {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: 'Failed to create project' }),
        })
      }
    } else {
      await route.continue()
    }
  })

  // Mock individual project
  await page.route('**/projects/*', async (route) => {
    const projectId = route.request().url().split('/').pop()
    const project = projects.find(p => p.id.toString() === projectId) || createMockProject({ id: parseInt(projectId || '1') })

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { project } }),
    })
  })
}

/**
 * Mock transaction-related API endpoints.
 */
export async function mockTransactionEndpoints(page: Page, options: {
  bundleStatus?: TransactionBundle['status']
  transactionHash?: string
  confirmationTime?: number
} = {}) {
  const { bundleStatus = 'confirmed', transactionHash = '0x' + '1'.repeat(64), confirmationTime: _confirmationTime } = options

  // Mock Relayr bundle creation
  await page.route('**/wallet/relayr-bundle', async (route) => {
    const bundle = createMockTransactionBundle({ status: bundleStatus })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: bundle }),
    })
  })

  // Mock transaction execution
  await page.route('**/wallet/execute', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { txHash: transactionHash } }),
    })
  })

  // Mock transaction status polling
  await page.route('**/transactions/*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          status: bundleStatus,
          hash: transactionHash,
        },
      }),
    })
  })
}

/**
 * Mock all API endpoints for a complete E2E test scenario.
 */
export async function mockAllEndpoints(page: Page, options: {
  user?: { id: string; email: string; smartAccountAddress: string }
  chats?: Chat[]
  projects?: Project[]
  aiResponse?: typeof AI_RESPONSES[keyof typeof AI_RESPONSES]
} = {}) {
  const {
    user = { id: 'test-user', email: 'test@example.com', smartAccountAddress: '0x1234567890123456789012345678901234567890' },
    chats = [],
    projects = [],
    aiResponse = AI_RESPONSES.greeting,
  } = options

  // Import auth mocking
  const { mockAuthEndpoints } = await import('./auth')
  await mockAuthEndpoints(page, { user: { ...user, token: 'test-token', mode: 'managed' } })
  await mockChatEndpoints(page, { chats, aiResponse })
  await mockProjectEndpoints(page, { projects })
  await mockTransactionEndpoints(page)
}
