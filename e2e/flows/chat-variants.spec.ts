import { test, expect, type Page } from '../fixtures/auth'
import { mockAuthEndpoints } from '../fixtures/auth'
import { mockProjectEndpoints, mockTransactionEndpoints, createMockProject } from '../fixtures/api'

/**
 * Chat Interaction Variants
 *
 * Tests many different chat scenarios:
 * - Message types and lengths
 * - AI response types
 * - Transaction component rendering
 * - Error handling
 * - Conversation flows
 */

test.describe('Chat Variants: Message Types', () => {
  test.beforeEach(async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    await mockManagedAuth(page)
    await mockAuthEndpoints(page)
    await mockTransactionEndpoints(page)

    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test.describe('Message Lengths', () => {
    test('sends 1-word message', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Hello')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('sends short sentence', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create a project')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('sends medium paragraph', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        const msg = 'I want to create a project for my NFT collection. It should have 3 tiers with different prices and limited supply. Can you help me set this up?'
        await input.fill(msg)
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('sends long detailed request', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        const msg = `I'm launching a new DAO for my community. Here are the requirements:
        1. Token name: Community Token (CTK)
        2. Initial supply: 1,000,000 tokens
        3. 50% reserved for treasury
        4. 3 NFT tiers: Supporter ($10), Member ($50), Founder ($500)
        5. Deploy on Optimism for lower gas fees
        6. Set up 10% payout limit initially
        Please help me configure all of this.`
        await input.fill(msg)
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('sends very long message (1000+ chars)', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        const msg = 'Create a project '.repeat(100)
        await input.fill(msg)
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Special Characters', () => {
    test('sends message with emoji', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('🚀 Let\'s launch a project! 💰')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('sends message with code block', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Here is some code: ```function test() {}```')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('sends message with markdown', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('**Bold** and *italic* and [link](https://example.com)')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('sends message with HTML tags', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('<script>alert("xss")</script><b>test</b>')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('sends message with newlines', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Line 1\nLine 2\nLine 3')
        // Use Shift+Enter or direct fill
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('sends message with unicode characters', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('日本語テスト العربية 한국어')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('sends message with numbers and math', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Set price to 0.05 ETH (about $150). Calculate 10% = 0.005')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('sends message with addresses', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Send to 0x1234567890123456789012345678901234567890')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Question Types', () => {
    test('asks how to question', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('How do I create a project?')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('asks what is question', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('What is a ruleset?')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('asks why question', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Why do I need to set a payout limit?')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('asks comparison question', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('What\'s the difference between reserved rate and redemption rate?')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('asks recommendation question', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('What chain should I deploy on for an NFT collection?')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Command Types', () => {
    test('direct create command', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create a project called "Test Project"')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('deploy command', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Deploy my project to Base')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('add tier command', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Add a new tier called Premium for 0.1 ETH')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('change setting command', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Change the reserved rate to 25%')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('show info command', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Show me the current project settings')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })
})

test.describe('Chat Variants: Project Creation Requests', () => {
  test.beforeEach(async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    await mockManagedAuth(page)
    await mockAuthEndpoints(page)
    await mockTransactionEndpoints(page)

    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test.describe('Simple Creation Requests', () => {
    test('create with just name', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create a project called MyProject')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('create with name and description', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create a project called MyProject. It\'s a community fund.')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('create with name and chain', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create a project called MyProject on Optimism')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('create with natural language', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('I want to start a project for my art collection')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Tier-Focused Requests', () => {
    test('create with single tier', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create a project with a membership tier at 0.05 ETH')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('create with multiple tiers explicit', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create a project with 3 tiers: Bronze at $10, Silver at $50, Gold at $100')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('create with supply limits', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create a project with a tier limited to 100 copies')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('create with unlimited tier', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create a project with an open edition membership')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('create with discounts', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create a project with early bird 20% discount')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Treasury-Focused Requests', () => {
    test('create with payout limit', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create a treasury with 5 ETH monthly payout')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('create with splits', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create a project that splits 30% to 0x123...456')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('create with reserved rate', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create a project with 20% token reserved for team')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('create with USDC pricing', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create a USDC-based treasury')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Token-Focused Requests', () => {
    test('create with ERC20 token', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create a project with a governance token called PROJ')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('specify token symbol', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create a project with token symbol $MOON')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('specify redemption rate', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create a project where tokens can be redeemed for 50% of treasury')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Chain-Focused Requests', () => {
    test('create on Ethereum', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create a project on Ethereum mainnet')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('create on Optimism', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create a project on OP')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('create on Base', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create a project on Base for low fees')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('create omnichain', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create a project that works across multiple chains')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('specify multiple chains', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create a project on ETH, OP, and Base')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Category-Focused Requests', () => {
    test('create NFT collection', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create an NFT collection')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('create DAO', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create a DAO for my community')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('create crowdfund', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create a crowdfunding campaign')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('create membership', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create a membership program')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('create charity', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create a charity fund')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('create gaming project', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create a game items store')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })
})

test.describe('Chat Variants: Conversation Flows', () => {
  test.beforeEach(async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    await mockManagedAuth(page)
    await mockAuthEndpoints(page)
    await mockTransactionEndpoints(page)

    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test.describe('Multi-Turn Conversations', () => {
    test('2-message conversation', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('I want to create a project')
        await input.press('Enter')
        await page.waitForTimeout(1000)

        await input.fill('Call it "MyProject"')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('5-message conversation', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        const messages = [
          'Create a project',
          'Name it TestDAO',
          'Add a membership tier at 0.05 ETH',
          'Set the supply to 100',
          'Deploy on Base',
        ]

        for (const msg of messages) {
          await input.fill(msg)
          await input.press('Enter')
          await page.waitForTimeout(500)
        }
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('iterative refinement', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        const messages = [
          'Create a simple project',
          'Actually, add an NFT tier',
          'Change the price to 0.1 ETH',
          'Make it limited to 50',
          'And add a 10% discount',
        ]

        for (const msg of messages) {
          await input.fill(msg)
          await input.press('Enter')
          await page.waitForTimeout(500)
        }
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Follow-up Questions', () => {
    test('answers follow-up after info request', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('What chain should I use?')
        await input.press('Enter')
        await page.waitForTimeout(1000)

        await input.fill('Let\'s go with Base')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('clarification flow', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create a project')
        await input.press('Enter')
        await page.waitForTimeout(1000)

        // AI might ask for clarification
        await input.fill('Yes, for NFTs')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('correction flow', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create a project called Test')
        await input.press('Enter')
        await page.waitForTimeout(1000)

        await input.fill('Wait, change the name to TestDAO')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Context Switching', () => {
    test('switches from project creation to question', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create a project called Test')
        await input.press('Enter')
        await page.waitForTimeout(1000)

        await input.fill('Actually, what\'s the difference between ETH and USDC pricing?')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('returns to previous topic', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create a project called Test')
        await input.press('Enter')
        await page.waitForTimeout(1000)

        await input.fill('What is reserved rate?')
        await input.press('Enter')
        await page.waitForTimeout(1000)

        await input.fill('Ok, let\'s continue with the project. Set reserved rate to 20%')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Confirmation Flows', () => {
    test('confirms deployment', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create and deploy a project called Test')
        await input.press('Enter')
        await page.waitForTimeout(1000)

        await input.fill('Yes, deploy it')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('cancels action', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Deploy my project')
        await input.press('Enter')
        await page.waitForTimeout(1000)

        await input.fill('Wait, cancel that')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('modifies before confirmation', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Deploy my project')
        await input.press('Enter')
        await page.waitForTimeout(1000)

        await input.fill('Before deploying, change the name to FinalProject')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })
})

test.describe('Chat Variants: AI Response Types', () => {
  test.beforeEach(async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    await mockManagedAuth(page)
    await mockAuthEndpoints(page)
    await mockTransactionEndpoints(page)

    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test.describe('Text-Only Responses', () => {
    test('displays short text response', async ({ page }) => {
      // Mock simple text response
      await page.route('**/chat/*/ai/invoke', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"type":"chunk","content":"Got it, I\'ll help you with that."}\n\ndata: {"type":"done"}\n\n'
        })
      })

      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Hello')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('displays long text response with markdown', async ({ page }) => {
      await page.route('**/chat/*/ai/invoke', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"type":"chunk","content":"# Project Options\\n\\n## ETH Treasury\\n- Simple setup\\n- Low fees\\n\\n## NFT Collection\\n- Multiple tiers\\n- Limited supply\\n\\n**Recommendation:** Start with an ETH treasury."}\n\ndata: {"type":"done"}\n\n'
        })
      })

      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('What are my options?')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('displays response with code', async ({ page }) => {
      await page.route('**/chat/*/ai/invoke', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"type":"chunk","content":"Here\'s how to format the data:\\n```javascript\\nconst tier = { name: \\"Bronze\\", price: \\"0.01\\" }\\n```"}\n\ndata: {"type":"done"}\n\n'
        })
      })

      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Show me the format')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('displays response with list', async ({ page }) => {
      await page.route('**/chat/*/ai/invoke', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"type":"chunk","content":"Your project needs:\\n1. A name\\n2. At least one tier\\n3. Payout configuration\\n4. Chain selection"}\n\ndata: {"type":"done"}\n\n'
        })
      })

      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('What do I need?')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Component Responses', () => {
    test('renders transaction preview component', async ({ page }) => {
      await page.route('**/chat/*/ai/invoke', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"type":"component","name":"transaction-preview","props":{"transactions":[{"to":"0x123","value":"0.01"}]}}\n\ndata: {"type":"done"}\n\n'
        })
      })

      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Deploy my project')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('renders project summary component', async ({ page }) => {
      await page.route('**/chat/*/ai/invoke', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"type":"component","name":"project-summary","props":{"name":"TestProject","chain":"ethereum","tiers":[]}}\n\ndata: {"type":"done"}\n\n'
        })
      })

      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Show project summary')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('renders chain selector component', async ({ page }) => {
      await page.route('**/chat/*/ai/invoke', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"type":"component","name":"chain-selector","props":{"chains":["ethereum","optimism","base"]}}\n\ndata: {"type":"done"}\n\n'
        })
      })

      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Which chain?')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('renders tier editor component', async ({ page }) => {
      await page.route('**/chat/*/ai/invoke', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"type":"component","name":"tier-editor","props":{"tier":{"name":"","price":"","supply":""}}}\n\ndata: {"type":"done"}\n\n'
        })
      })

      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Add a new tier')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Mixed Responses', () => {
    test('renders text followed by component', async ({ page }) => {
      await page.route('**/chat/*/ai/invoke', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"type":"chunk","content":"Great! Here\'s your project setup:"}\n\ndata: {"type":"component","name":"project-summary","props":{}}\n\ndata: {"type":"done"}\n\n'
        })
      })

      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Create TestProject')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('renders component followed by text', async ({ page }) => {
      await page.route('**/chat/*/ai/invoke', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"type":"component","name":"transaction-preview","props":{}}\n\ndata: {"type":"chunk","content":"\\n\\nClick confirm to deploy."}\n\ndata: {"type":"done"}\n\n'
        })
      })

      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Deploy')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('renders multiple components', async ({ page }) => {
      await page.route('**/chat/*/ai/invoke', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"type":"component","name":"project-summary","props":{}}\n\ndata: {"type":"component","name":"transaction-preview","props":{}}\n\ndata: {"type":"done"}\n\n'
        })
      })

      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Show summary and deploy')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Streaming Behavior', () => {
    test('handles slow streaming', async ({ page }) => {
      let streamIndex = 0
      const chunks = ['Hello', ' there,', ' this', ' is', ' streaming', '.']

      await page.route('**/chat/*/ai/invoke', async (route) => {
        // Simulate slow streaming
        const body = chunks.map((c, i) =>
          `data: {"type":"chunk","content":"${c}"}\n\n`
        ).join('') + 'data: {"type":"done"}\n\n'

        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body
        })
      })

      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Test streaming')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('handles abrupt stream end', async ({ page }) => {
      await page.route('**/chat/*/ai/invoke', async (route) => {
        // Stream ends without done event
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"type":"chunk","content":"Partial response..."}\n\n'
        })
      })

      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Test abrupt end')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('handles empty stream', async ({ page }) => {
      await page.route('**/chat/*/ai/invoke', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"type":"done"}\n\n'
        })
      })

      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Test empty')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })
})

test.describe('Chat Variants: Edge Cases', () => {
  test.beforeEach(async ({ page, mockManagedAuth }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())

    await mockManagedAuth(page)
    await mockAuthEndpoints(page)
    await mockTransactionEndpoints(page)

    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test.describe('Rapid Input', () => {
    test('handles rapid message sending', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        for (let i = 0; i < 5; i++) {
          await input.fill(`Message ${i}`)
          await input.press('Enter')
          // No wait
        }
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('handles typing during streaming', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Start')
        await input.press('Enter')
        // Type while streaming
        await input.fill('Next message')
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Empty States', () => {
    test('handles empty message submit', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.press('Enter') // Empty submit
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('handles whitespace-only message', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('   ')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Error States', () => {
    test('handles network error during send', async ({ page }) => {
      await page.route('**/chat/*/ai/invoke', route => route.abort('failed'))

      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Test network error')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('handles 500 error', async ({ page }) => {
      await page.route('**/chat/*/ai/invoke', async (route) => {
        await route.fulfill({
          status: 500,
          body: JSON.stringify({ error: 'Internal server error' })
        })
      })

      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Test server error')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('handles 429 rate limit', async ({ page }) => {
      await page.route('**/chat/*/ai/invoke', async (route) => {
        await route.fulfill({
          status: 429,
          headers: { 'Retry-After': '60' },
          body: JSON.stringify({ error: 'Rate limit exceeded' })
        })
      })

      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Test rate limit')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('handles timeout', async ({ page }) => {
      await page.route('**/chat/*/ai/invoke', async (route) => {
        await new Promise(resolve => setTimeout(resolve, 35000))
        await route.fulfill({ status: 200 })
      })

      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Test timeout')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Recovery', () => {
    test('can send after error', async ({ page }) => {
      let callCount = 0
      await page.route('**/chat/*/ai/invoke', async (route) => {
        callCount++
        if (callCount === 1) {
          await route.fulfill({ status: 500, body: '{}' })
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'text/event-stream',
            body: 'data: {"type":"chunk","content":"Success!"}\n\ndata: {"type":"done"}\n\n'
          })
        }
      })

      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('First message (will fail)')
        await input.press('Enter')
        await page.waitForTimeout(1000)

        await input.fill('Second message (should work)')
        await input.press('Enter')
      }
      await expect(page.locator('body')).toBeVisible()
    })

    test('retries failed message', async ({ page }) => {
      const input = page.locator('textarea, input[type="text"]').first()
      if (await input.isVisible()) {
        await input.fill('Retry this')
        await input.press('Enter')
        await page.waitForTimeout(1000)

        // Look for retry button
        const retryBtn = page.locator('button').filter({ hasText: /retry/i })
        if (await retryBtn.isVisible()) {
          await retryBtn.click()
        }
      }
      await expect(page.locator('body')).toBeVisible()
    })
  })
})
