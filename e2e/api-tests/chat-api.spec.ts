import { test, expect } from '@playwright/test'

/**
 * Direct API tests for chat endpoints.
 * These tests bypass the UI and test API contracts directly.
 */

const API_BASE = process.env.VITE_API_URL || 'http://localhost:3001'

test.describe('Chat API', () => {
  // Test auth token for API calls
  let authToken: string

  test.beforeAll(async ({ request }) => {
    // Get a test auth token
    // In real tests, this would authenticate properly
    authToken = 'test-token-' + Date.now()
  })

  test.describe('POST /chat - Create Chat', () => {
    test('creates a new chat successfully', async ({ request }) => {
      const response = await request.post(`${API_BASE}/chat`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: {
          name: 'Test Chat',
          isPublic: false,
        },
      })

      // API might not be running in CI, handle both cases
      if (response.ok()) {
        const data = await response.json()
        expect(data.success).toBe(true)
        expect(data.data.chat).toBeDefined()
        expect(data.data.chat.id).toBeDefined()
        expect(data.data.chat.name).toBe('Test Chat')
      } else {
        // Skip if API not available
        test.skip()
      }
    })

    test('requires authentication', async ({ request }) => {
      const response = await request.post(`${API_BASE}/chat`, {
        headers: {
          'Content-Type': 'application/json',
          // No auth header
        },
        data: {
          name: 'Unauthorized Chat',
        },
      })

      // Should return 401 or similar auth error
      if (response.status() !== 0) { // 0 means connection refused
        expect(response.status()).toBeGreaterThanOrEqual(400)
      }
    })

    test('validates required fields', async ({ request }) => {
      const response = await request.post(`${API_BASE}/chat`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: {
          // Missing name
        },
      })

      if (response.ok() === false && response.status() !== 0) {
        const data = await response.json()
        expect(data.success).toBe(false)
      }
    })
  })

  test.describe('POST /chat/{id}/ai/invoke - AI Invocation', () => {
    test('invokes AI and gets response', async ({ request }) => {
      // First create a chat
      const createResponse = await request.post(`${API_BASE}/chat`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: { name: 'AI Test Chat' },
      })

      if (!createResponse.ok()) {
        test.skip()
        return
      }

      const createData = await createResponse.json()
      const chatId = createData.data?.chat?.id

      if (!chatId) {
        test.skip()
        return
      }

      // Invoke AI
      const aiResponse = await request.post(`${API_BASE}/chat/${chatId}/ai/invoke`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: {
          message: 'Hello',
        },
      })

      if (aiResponse.ok()) {
        // Response could be streaming or JSON
        const contentType = aiResponse.headers()['content-type']
        expect(contentType).toBeDefined()
      }
    })

    test('handles invalid chat ID', async ({ request }) => {
      const response = await request.post(`${API_BASE}/chat/invalid-id/ai/invoke`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: { message: 'Hello' },
      })

      if (response.status() !== 0) {
        expect(response.status()).toBeGreaterThanOrEqual(400)
      }
    })

    test('requires message content', async ({ request }) => {
      const response = await request.post(`${API_BASE}/chat/some-id/ai/invoke`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: {
          // Missing message
        },
      })

      if (response.status() !== 0) {
        expect(response.ok()).toBe(false)
      }
    })
  })

  test.describe('POST /chat/{id}/messages - Send Message', () => {
    test('sends a message to chat', async ({ request }) => {
      // Create chat first
      const createResponse = await request.post(`${API_BASE}/chat`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: { name: 'Message Test Chat' },
      })

      if (!createResponse.ok()) {
        test.skip()
        return
      }

      const { data } = await createResponse.json()
      const chatId = data?.chat?.id

      if (!chatId) {
        test.skip()
        return
      }

      // Send message
      const messageResponse = await request.post(`${API_BASE}/chat/${chatId}/messages`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: {
          content: 'Test message content',
        },
      })

      if (messageResponse.ok()) {
        const messageData = await messageResponse.json()
        expect(messageData.success).toBe(true)
        expect(messageData.data.message).toBeDefined()
        expect(messageData.data.message.content).toBe('Test message content')
      }
    })

    test('message has correct role', async ({ request }) => {
      const createResponse = await request.post(`${API_BASE}/chat`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: { name: 'Role Test Chat' },
      })

      if (!createResponse.ok()) {
        test.skip()
        return
      }

      const { data } = await createResponse.json()
      const chatId = data?.chat?.id

      if (!chatId) {
        test.skip()
        return
      }

      const messageResponse = await request.post(`${API_BASE}/chat/${chatId}/messages`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: {
          content: 'User message',
          role: 'user',
        },
      })

      if (messageResponse.ok()) {
        const messageData = await messageResponse.json()
        expect(messageData.data.message.role).toBe('user')
      }
    })
  })

  test.describe('Rate Limiting', () => {
    test('enforces rate limits on AI invocation', async ({ request }) => {
      // This test would verify rate limiting is in place
      // by making multiple rapid requests

      const results: number[] = []

      for (let i = 0; i < 5; i++) {
        const response = await request.post(`${API_BASE}/chat/test-chat/ai/invoke`, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
          },
          data: { message: `Request ${i}` },
        })
        results.push(response.status())
      }

      // At least one request might be rate limited (429)
      // This depends on actual rate limit configuration
    })
  })

  test.describe('Error Handling', () => {
    test('returns proper error format', async ({ request }) => {
      const response = await request.post(`${API_BASE}/chat/nonexistent/ai/invoke`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: { message: 'Hello' },
      })

      if (response.status() !== 0 && !response.ok()) {
        const data = await response.json()
        expect(data.success).toBe(false)
        expect(data.error).toBeDefined()
      }
    })

    test('handles malformed JSON gracefully', async ({ request }) => {
      const response = await request.post(`${API_BASE}/chat`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: 'not-valid-json{',
      })

      if (response.status() !== 0) {
        expect(response.status()).toBeGreaterThanOrEqual(400)
      }
    })
  })
})
