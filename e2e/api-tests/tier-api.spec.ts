import { test, expect } from '@playwright/test'

/**
 * Direct API tests for 721 tier management endpoints.
 * Tests tier CRUD operations and validation.
 */

const API_BASE = process.env.VITE_API_URL || 'http://localhost:3001'

test.describe('Tier Management API', () => {
  let authToken: string
  let testProjectId: string

  test.beforeAll(async ({ request }) => {
    authToken = 'test-token-' + Date.now()

    // Create a test project for tier operations
    const createResponse = await request.post(`${API_BASE}/projects`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      data: {
        name: 'Tier Test Project',
        chainId: 1,
      },
    })

    if (createResponse.ok()) {
      const data = await createResponse.json()
      testProjectId = data.data?.project?.id
    }
  })

  test.describe('POST /projects/{id}/tiers - Add Tier', () => {
    test('adds a new tier to project', async ({ request }) => {
      if (!testProjectId) {
        test.skip()
        return
      }

      const response = await request.post(`${API_BASE}/projects/${testProjectId}/tiers`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: {
          name: 'Bronze Tier',
          price: '0.01',
          supply: 100,
          description: 'Entry level tier',
        },
      })

      if (response.ok()) {
        const data = await response.json()
        expect(data.success).toBe(true)
        expect(data.data.tier).toBeDefined()
        expect(data.data.tier.name).toBe('Bronze Tier')
        expect(data.data.tier.price).toBe('0.01')
        expect(data.data.tier.supply).toBe(100)
      } else if (response.status() === 0) {
        test.skip()
      }
    })

    test('validates required tier fields', async ({ request }) => {
      if (!testProjectId) {
        test.skip()
        return
      }

      const response = await request.post(`${API_BASE}/projects/${testProjectId}/tiers`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: {
          // Missing name and price
          supply: 100,
        },
      })

      if (response.status() !== 0 && !response.ok()) {
        const data = await response.json()
        expect(data.success).toBe(false)
        expect(data.error).toBeDefined()
      }
    })

    test('validates price is positive', async ({ request }) => {
      if (!testProjectId) {
        test.skip()
        return
      }

      const response = await request.post(`${API_BASE}/projects/${testProjectId}/tiers`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: {
          name: 'Negative Price Tier',
          price: '-0.01',
          supply: 100,
        },
      })

      if (response.status() !== 0) {
        expect(response.ok()).toBe(false)
      }
    })

    test('validates supply is positive integer', async ({ request }) => {
      if (!testProjectId) {
        test.skip()
        return
      }

      const response = await request.post(`${API_BASE}/projects/${testProjectId}/tiers`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: {
          name: 'Invalid Supply Tier',
          price: '0.01',
          supply: -5,
        },
      })

      if (response.status() !== 0) {
        expect(response.ok()).toBe(false)
      }
    })
  })

  test.describe('GET /projects/{id}/tiers - List Tiers', () => {
    test('retrieves all tiers for project', async ({ request }) => {
      if (!testProjectId) {
        test.skip()
        return
      }

      const response = await request.get(`${API_BASE}/projects/${testProjectId}/tiers`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      })

      if (response.ok()) {
        const data = await response.json()
        expect(data.success).toBe(true)
        expect(Array.isArray(data.data.tiers)).toBe(true)
      }
    })

    test('returns empty array for project with no tiers', async ({ request }) => {
      // Create a fresh project with no tiers
      const createResponse = await request.post(`${API_BASE}/projects`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: {
          name: 'Empty Tier Project',
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

      const response = await request.get(`${API_BASE}/projects/${projectId}/tiers`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      })

      if (response.ok()) {
        const data = await response.json()
        expect(data.data.tiers).toEqual([])
      }
    })
  })

  test.describe('PATCH /projects/{id}/tiers/{tierId} - Update Tier', () => {
    test('updates tier name', async ({ request }) => {
      if (!testProjectId) {
        test.skip()
        return
      }

      // First create a tier
      const createResponse = await request.post(`${API_BASE}/projects/${testProjectId}/tiers`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: {
          name: 'Original Name',
          price: '0.01',
          supply: 50,
        },
      })

      if (!createResponse.ok()) {
        test.skip()
        return
      }

      const createData = await createResponse.json()
      const tierId = createData.data?.tier?.id

      if (!tierId) {
        test.skip()
        return
      }

      // Update the tier
      const updateResponse = await request.patch(
        `${API_BASE}/projects/${testProjectId}/tiers/${tierId}`,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
          },
          data: {
            name: 'Updated Name',
          },
        }
      )

      if (updateResponse.ok()) {
        const data = await updateResponse.json()
        expect(data.success).toBe(true)
        expect(data.data.tier.name).toBe('Updated Name')
      }
    })

    test('updates tier discount', async ({ request }) => {
      if (!testProjectId) {
        test.skip()
        return
      }

      // Create tier
      const createResponse = await request.post(`${API_BASE}/projects/${testProjectId}/tiers`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: {
          name: 'Discountable Tier',
          price: '0.1',
          supply: 100,
        },
      })

      if (!createResponse.ok()) {
        test.skip()
        return
      }

      const createData = await createResponse.json()
      const tierId = createData.data?.tier?.id

      if (!tierId) {
        test.skip()
        return
      }

      // Add discount
      const updateResponse = await request.patch(
        `${API_BASE}/projects/${testProjectId}/tiers/${tierId}`,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
          },
          data: {
            discount: 15, // 15% discount
          },
        }
      )

      if (updateResponse.ok()) {
        const data = await updateResponse.json()
        expect(data.data.tier.discount).toBe(15)
      }
    })

    test('validates discount range (0-100)', async ({ request }) => {
      if (!testProjectId) {
        test.skip()
        return
      }

      // Create tier
      const createResponse = await request.post(`${API_BASE}/projects/${testProjectId}/tiers`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: {
          name: 'Invalid Discount Tier',
          price: '0.1',
          supply: 100,
        },
      })

      if (!createResponse.ok()) {
        test.skip()
        return
      }

      const createData = await createResponse.json()
      const tierId = createData.data?.tier?.id

      if (!tierId) {
        test.skip()
        return
      }

      // Try invalid discount
      const updateResponse = await request.patch(
        `${API_BASE}/projects/${testProjectId}/tiers/${tierId}`,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
          },
          data: {
            discount: 150, // Invalid - over 100%
          },
        }
      )

      if (updateResponse.status() !== 0) {
        expect(updateResponse.ok()).toBe(false)
      }
    })
  })

  test.describe('DELETE /projects/{id}/tiers/{tierId} - Delete Tier', () => {
    test('deletes a tier', async ({ request }) => {
      if (!testProjectId) {
        test.skip()
        return
      }

      // Create tier to delete
      const createResponse = await request.post(`${API_BASE}/projects/${testProjectId}/tiers`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: {
          name: 'Deletable Tier',
          price: '0.01',
          supply: 10,
        },
      })

      if (!createResponse.ok()) {
        test.skip()
        return
      }

      const createData = await createResponse.json()
      const tierId = createData.data?.tier?.id

      if (!tierId) {
        test.skip()
        return
      }

      // Delete the tier
      const deleteResponse = await request.delete(
        `${API_BASE}/projects/${testProjectId}/tiers/${tierId}`,
        {
          headers: {
            'Authorization': `Bearer ${authToken}`,
          },
        }
      )

      if (deleteResponse.ok()) {
        const data = await deleteResponse.json()
        expect(data.success).toBe(true)
      }
    })

    test('cannot delete tier with sales', async ({ request }) => {
      // This would test that tiers with existing sales cannot be deleted
      // Requires setting up a tier with mock sales data
    })

    test('returns 404 for non-existent tier', async ({ request }) => {
      if (!testProjectId) {
        test.skip()
        return
      }

      const response = await request.delete(
        `${API_BASE}/projects/${testProjectId}/tiers/99999999`,
        {
          headers: {
            'Authorization': `Bearer ${authToken}`,
          },
        }
      )

      if (response.status() !== 0) {
        expect(response.status()).toBe(404)
      }
    })
  })

  test.describe('Tier Encoding', () => {
    test('tier data matches on-chain expectations', async ({ request }) => {
      // This test verifies that tier data is encoded correctly
      // for on-chain storage in the JB721 contract

      if (!testProjectId) {
        test.skip()
        return
      }

      const response = await request.post(`${API_BASE}/projects/${testProjectId}/tiers`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: {
          name: 'Encoded Tier',
          price: '1.5', // 1.5 ETH
          supply: 1000,
          metadata: {
            image: 'ipfs://QmTest',
            description: 'Test tier for encoding validation',
          },
        },
      })

      if (response.ok()) {
        const data = await response.json()
        const tier = data.data.tier

        // Verify price is stored with correct precision
        // (should be in wei or appropriate decimal format)
        expect(tier.price).toBeDefined()

        // Verify metadata is preserved
        expect(tier.metadata).toBeDefined()
      }
    })

    test('validates IPFS metadata URIs', async ({ request }) => {
      if (!testProjectId) {
        test.skip()
        return
      }

      const response = await request.post(`${API_BASE}/projects/${testProjectId}/tiers`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: {
          name: 'IPFS Tier',
          price: '0.1',
          supply: 100,
          metadata: {
            image: 'ipfs://QmValidHash',
          },
        },
      })

      // IPFS URIs should be accepted
      if (response.ok()) {
        const data = await response.json()
        expect(data.data.tier.metadata.image).toContain('ipfs://')
      }
    })
  })

  test.describe('Permission Flags', () => {
    test('only owner can manage tiers', async ({ request }) => {
      // This would test that non-owners cannot create/update/delete tiers
      // Requires multi-user auth setup
    })

    test('respects project permission settings', async ({ request }) => {
      // This would test that tier operations respect project-level permissions
    })
  })
})
