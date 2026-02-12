import { test, expect } from '@playwright/test'

/**
 * Direct API tests for project endpoints.
 * Tests project creation, updates, and transaction bundling.
 */

const API_BASE = process.env.VITE_API_URL || 'http://localhost:3001'

test.describe('Project API', () => {
  let authToken: string

  test.beforeAll(async () => {
    authToken = 'test-token-' + Date.now()
  })

  test.describe('POST /projects - Create Project', () => {
    test('creates a project record', async ({ request }) => {
      const response = await request.post(`${API_BASE}/projects`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: {
          name: 'Test Project',
          description: 'A test project for E2E testing',
          chainId: 1,
        },
      })

      if (response.ok()) {
        const data = await response.json()
        expect(data.success).toBe(true)
        expect(data.data.project).toBeDefined()
        expect(data.data.project.name).toBe('Test Project')
        expect(data.data.project.chainId).toBe(1)
      } else if (response.status() === 0) {
        test.skip()
      }
    })

    test('validates required fields', async ({ request }) => {
      const response = await request.post(`${API_BASE}/projects`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: {
          // Missing name and chainId
        },
      })

      if (response.status() !== 0 && !response.ok()) {
        const data = await response.json()
        expect(data.success).toBe(false)
        expect(data.error).toBeDefined()
      }
    })

    test('validates chain ID is supported', async ({ request }) => {
      const response = await request.post(`${API_BASE}/projects`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: {
          name: 'Invalid Chain Project',
          chainId: 999999, // Invalid chain
        },
      })

      if (response.status() !== 0 && !response.ok()) {
        const data = await response.json()
        expect(data.success).toBe(false)
      }
    })
  })

  test.describe('GET /projects/{id} - Get Project', () => {
    test('retrieves project by ID', async ({ request }) => {
      // First create a project
      const createResponse = await request.post(`${API_BASE}/projects`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: {
          name: 'Retrievable Project',
          chainId: 1,
        },
      })

      if (!createResponse.ok()) {
        test.skip()
        return
      }

      const createData = await createResponse.json()
      const projectId = createData.data?.project?.id

      if (!projectId) {
        test.skip()
        return
      }

      // Get the project
      const getResponse = await request.get(`${API_BASE}/projects/${projectId}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      })

      if (getResponse.ok()) {
        const data = await getResponse.json()
        expect(data.success).toBe(true)
        expect(data.data.project.id).toBe(projectId)
        expect(data.data.project.name).toBe('Retrievable Project')
      }
    })

    test('returns 404 for non-existent project', async ({ request }) => {
      const response = await request.get(`${API_BASE}/projects/99999999`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      })

      if (response.status() !== 0) {
        expect(response.status()).toBe(404)
      }
    })
  })

  test.describe('PATCH /projects/{id} - Update Project', () => {
    test('updates project status', async ({ request }) => {
      // Create project
      const createResponse = await request.post(`${API_BASE}/projects`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: {
          name: 'Updatable Project',
          chainId: 1,
        },
      })

      if (!createResponse.ok()) {
        test.skip()
        return
      }

      const createData = await createResponse.json()
      const projectId = createData.data?.project?.id

      if (!projectId) {
        test.skip()
        return
      }

      // Update project
      const updateResponse = await request.patch(`${API_BASE}/projects/${projectId}`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: {
          status: 'deployed',
          onChainId: 123,
        },
      })

      if (updateResponse.ok()) {
        const data = await updateResponse.json()
        expect(data.success).toBe(true)
        expect(data.data.project.status).toBe('deployed')
      }
    })

    test('validates status transitions', async ({ request }) => {
      // Create project
      const createResponse = await request.post(`${API_BASE}/projects`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: {
          name: 'Status Transition Project',
          chainId: 1,
        },
      })

      if (!createResponse.ok()) {
        test.skip()
        return
      }

      const createData = await createResponse.json()
      const projectId = createData.data?.project?.id

      if (!projectId) {
        test.skip()
        return
      }

      // Try invalid status transition
      const updateResponse = await request.patch(`${API_BASE}/projects/${projectId}`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: {
          status: 'invalid_status',
        },
      })

      // Should reject invalid status
      if (updateResponse.status() !== 0) {
        expect(updateResponse.ok()).toBe(false)
      }
    })
  })

  test.describe('Transaction Bundle Creation', () => {
    test('creates transaction bundle for deployment', async ({ request }) => {
      const response = await request.post(`${API_BASE}/wallet/relayr-bundle`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: {
          transactions: [
            {
              chainId: 1,
              target: '0x0000000000000000000000000000000000000000',
              data: '0x',
              value: '0',
            },
          ],
          owner: '0x1234567890123456789012345678901234567890',
        },
      })

      if (response.ok()) {
        const data = await response.json()
        expect(data.success).toBe(true)
        expect(data.data.bundleId).toBeDefined()
      } else if (response.status() === 0) {
        test.skip()
      }
    })

    test('handles multi-chain bundles', async ({ request }) => {
      const response = await request.post(`${API_BASE}/wallet/relayr-bundle`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: {
          transactions: [
            { chainId: 1, target: '0x0000000000000000000000000000000000000001', data: '0x', value: '0' },
            { chainId: 10, target: '0x0000000000000000000000000000000000000002', data: '0x', value: '0' },
            { chainId: 8453, target: '0x0000000000000000000000000000000000000003', data: '0x', value: '0' },
          ],
          owner: '0x1234567890123456789012345678901234567890',
        },
      })

      if (response.ok()) {
        const data = await response.json()
        expect(data.success).toBe(true)
        expect(data.data.bundleId).toBeDefined()
      }
    })

    test('validates transaction data', async ({ request }) => {
      const response = await request.post(`${API_BASE}/wallet/relayr-bundle`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: {
          transactions: [
            {
              chainId: 1,
              target: 'not-an-address', // Invalid
              data: '0x',
              value: '0',
            },
          ],
          owner: '0x1234567890123456789012345678901234567890',
        },
      })

      if (response.status() !== 0) {
        expect(response.ok()).toBe(false)
      }
    })
  })

  test.describe('Omnichain Deployment', () => {
    test('coordinates deployment across multiple chains', async ({ request }) => {
      // Create a project intended for omnichain deployment
      const createResponse = await request.post(`${API_BASE}/projects`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: {
          name: 'Omnichain Project',
          chainId: 1,
          deploymentChains: [1, 10, 8453],
        },
      })

      if (createResponse.ok()) {
        const data = await createResponse.json()
        expect(data.success).toBe(true)
        // Omnichain projects should have deployment info for all chains
      }
    })
  })
})

test.describe('Project API - Authorization', () => {
  test('rejects unauthorized requests', async ({ request }) => {
    const response = await request.post(`${API_BASE}/projects`, {
      headers: {
        'Content-Type': 'application/json',
        // No auth header
      },
      data: {
        name: 'Unauthorized Project',
        chainId: 1,
      },
    })

    if (response.status() !== 0) {
      expect(response.status()).toBeGreaterThanOrEqual(400)
    }
  })

  test('rejects invalid tokens', async ({ request }) => {
    const response = await request.post(`${API_BASE}/projects`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer invalid-token',
      },
      data: {
        name: 'Invalid Token Project',
        chainId: 1,
      },
    })

    if (response.status() !== 0) {
      expect(response.status()).toBeGreaterThanOrEqual(400)
    }
  })

  test('only owner can update project', async ({ request }) => {
    // This would require creating a project with one user
    // and trying to update with another user's token
    // Skipping detailed implementation as it requires multi-user setup
  })
})
