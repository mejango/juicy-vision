import type { Page, Locator } from '@playwright/test'
import { expect } from '@playwright/test'

// ============================================================================
// Component Selectors
// ============================================================================

const SELECTORS = {
  // Transaction components
  transactionPreview: '[data-testid="transaction-preview"], transaction-preview, .transaction-preview',
  transactionStatus: '[data-testid="transaction-status"], .transaction-status',
  deployButton: 'button:has-text("Deploy"), button:has-text("Execute"), button:has-text("Confirm")',
  cancelButton: 'button:has-text("Cancel"), button:has-text("Reject")',

  // Modal components
  modal: '[role="dialog"], .modal, [data-testid="modal"]',
  modalClose: '[aria-label="Close"], button:has-text("Close"), .modal-close',
  modalOverlay: '.modal-overlay, [data-testid="modal-overlay"]',

  // Project/Dashboard components
  projectCard: '[data-testid="project-card"], .project-card',
  tierCard: '[data-testid="tier-card"], .tier-card',
  dashboardLink: 'a[href*="/project/"], [data-testid="dashboard-link"]',

  // Store management
  addTierButton: 'button:has-text("Add Tier"), button:has-text("New Tier")',
  tierForm: '[data-testid="tier-form"], .tier-form',
  tierNameInput: 'input[name="tierName"], input[placeholder*="name" i]',
  tierPriceInput: 'input[name="tierPrice"], input[placeholder*="price" i]',
  tierSupplyInput: 'input[name="tierSupply"], input[placeholder*="supply" i]',
  discountInput: 'input[name="discount"], input[placeholder*="discount" i]',
  saveTierButton: 'button:has-text("Save"), button[type="submit"]',
  deleteTierButton: 'button:has-text("Delete"), button[aria-label*="delete" i]',

  // Loading states
  spinner: '[data-testid="spinner"], .spinner, .loading',
  skeleton: '[data-testid="skeleton"], .skeleton',

  // Error states
  errorMessage: '[data-testid="error"], .error-message, [role="alert"]',
  errorBanner: '[data-testid="error-banner"], .error-banner',

  // Success states
  successMessage: '[data-testid="success"], .success-message',
  successBanner: '[data-testid="success-banner"], .success-banner',
} as const

// ============================================================================
// Transaction Preview Component
// ============================================================================

export interface TransactionPreviewComponent {
  element: Locator
  getType: () => Promise<string | null>
  getData: () => Promise<Record<string, unknown> | null>
  deploy: () => Promise<void>
  cancel: () => Promise<void>
  isVisible: () => Promise<boolean>
}

/**
 * Get a transaction preview component helper.
 */
export function getTransactionPreview(page: Page): TransactionPreviewComponent {
  const element = page.locator(SELECTORS.transactionPreview).first()

  return {
    element,

    async getType(): Promise<string | null> {
      const data = await this.getData()
      return (data?.type as string) || null
    },

    async getData(): Promise<Record<string, unknown> | null> {
      if (!(await element.isVisible())) return null

      // Try data attribute
      const dataAttr = await element.getAttribute('data-transaction')
      if (dataAttr) {
        try {
          return JSON.parse(dataAttr)
        } catch {
          // Continue
        }
      }

      // Try inner JSON
      const text = await element.textContent()
      if (text) {
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          try {
            return JSON.parse(jsonMatch[0])
          } catch {
            // Continue
          }
        }
      }

      return null
    },

    async deploy(): Promise<void> {
      const deployBtn = element.locator(SELECTORS.deployButton).first()
      await expect(deployBtn).toBeVisible()
      await deployBtn.click()
    },

    async cancel(): Promise<void> {
      const cancelBtn = element.locator(SELECTORS.cancelButton).first()
      if (await cancelBtn.isVisible()) {
        await cancelBtn.click()
      }
    },

    async isVisible(): Promise<boolean> {
      return element.isVisible()
    },
  }
}

// ============================================================================
// Modal Component
// ============================================================================

export interface ModalComponent {
  element: Locator
  close: () => Promise<void>
  clickOutside: () => Promise<void>
  isVisible: () => Promise<boolean>
  waitForClose: (timeout?: number) => Promise<void>
  getTitle: () => Promise<string | null>
}

/**
 * Get a modal component helper.
 */
export function getModal(page: Page): ModalComponent {
  const element = page.locator(SELECTORS.modal).first()

  return {
    element,

    async close(): Promise<void> {
      const closeBtn = element.locator(SELECTORS.modalClose).first()
      if (await closeBtn.isVisible()) {
        await closeBtn.click()
      }
    },

    async clickOutside(): Promise<void> {
      const overlay = page.locator(SELECTORS.modalOverlay).first()
      if (await overlay.isVisible()) {
        await overlay.click({ position: { x: 10, y: 10 } })
      }
    },

    async isVisible(): Promise<boolean> {
      return element.isVisible()
    },

    async waitForClose(timeout = 5000): Promise<void> {
      await expect(element).not.toBeVisible({ timeout })
    },

    async getTitle(): Promise<string | null> {
      const title = element.locator('h1, h2, h3, [role="heading"]').first()
      if (await title.isVisible()) {
        return title.textContent()
      }
      return null
    },
  }
}

// ============================================================================
// Tier Management Component
// ============================================================================

export interface TierData {
  name: string
  price: string
  supply?: string
  discount?: string
}

export interface TierComponent {
  element: Locator
  getName: () => Promise<string | null>
  getPrice: () => Promise<string | null>
  edit: () => Promise<void>
  delete: () => Promise<void>
  isVisible: () => Promise<boolean>
}

/**
 * Get helpers for managing store tiers.
 */
export const tierHelpers = {
  /**
   * Click the add tier button.
   */
  async clickAddTier(page: Page): Promise<void> {
    const addBtn = page.locator(SELECTORS.addTierButton).first()
    await expect(addBtn).toBeVisible()
    await addBtn.click()
  },

  /**
   * Fill out the tier form.
   */
  async fillTierForm(page: Page, tier: TierData): Promise<void> {
    const form = page.locator(SELECTORS.tierForm).first()
    await expect(form).toBeVisible()

    // Fill name
    const nameInput = form.locator(SELECTORS.tierNameInput).first()
    if (await nameInput.isVisible()) {
      await nameInput.fill(tier.name)
    }

    // Fill price
    const priceInput = form.locator(SELECTORS.tierPriceInput).first()
    if (await priceInput.isVisible()) {
      await priceInput.fill(tier.price)
    }

    // Fill supply if provided
    if (tier.supply) {
      const supplyInput = form.locator(SELECTORS.tierSupplyInput).first()
      if (await supplyInput.isVisible()) {
        await supplyInput.fill(tier.supply)
      }
    }

    // Fill discount if provided
    if (tier.discount) {
      const discountInput = form.locator(SELECTORS.discountInput).first()
      if (await discountInput.isVisible()) {
        await discountInput.fill(tier.discount)
      }
    }
  },

  /**
   * Submit the tier form.
   */
  async submitTierForm(page: Page): Promise<void> {
    const saveBtn = page.locator(SELECTORS.saveTierButton).first()
    await expect(saveBtn).toBeVisible()
    await saveBtn.click()
  },

  /**
   * Add a new tier (full flow).
   */
  async addTier(page: Page, tier: TierData): Promise<void> {
    await this.clickAddTier(page)
    await this.fillTierForm(page, tier)
    await this.submitTierForm(page)
  },

  /**
   * Get all tier cards on the page.
   */
  async getTiers(page: Page): Promise<TierComponent[]> {
    const tierCards = page.locator(SELECTORS.tierCard)
    const count = await tierCards.count()
    const tiers: TierComponent[] = []

    for (let i = 0; i < count; i++) {
      const element = tierCards.nth(i)
      tiers.push({
        element,

        async getName(): Promise<string | null> {
          const nameEl = element.locator('[data-testid="tier-name"], .tier-name, h3, h4').first()
          return nameEl.textContent()
        },

        async getPrice(): Promise<string | null> {
          const priceEl = element.locator('[data-testid="tier-price"], .tier-price').first()
          return priceEl.textContent()
        },

        async edit(): Promise<void> {
          const editBtn = element.locator('button:has-text("Edit")').first()
          await editBtn.click()
        },

        async delete(): Promise<void> {
          const deleteBtn = element.locator(SELECTORS.deleteTierButton).first()
          await deleteBtn.click()
        },

        async isVisible(): Promise<boolean> {
          return element.isVisible()
        },
      })
    }

    return tiers
  },

  /**
   * Find a tier by name.
   */
  async findTierByName(page: Page, name: string): Promise<TierComponent | null> {
    const tiers = await this.getTiers(page)
    for (const tier of tiers) {
      const tierName = await tier.getName()
      if (tierName?.includes(name)) {
        return tier
      }
    }
    return null
  },

  /**
   * Delete a tier by name.
   */
  async deleteTierByName(page: Page, name: string): Promise<boolean> {
    const tier = await this.findTierByName(page, name)
    if (tier) {
      await tier.delete()
      return true
    }
    return false
  },
}

// ============================================================================
// Loading State Helpers
// ============================================================================

/**
 * Wait for all loading indicators to disappear.
 */
export async function waitForLoading(page: Page, timeout = 10000): Promise<void> {
  // Wait for spinners to disappear
  const spinner = page.locator(SELECTORS.spinner)
  await expect(spinner).not.toBeVisible({ timeout })

  // Wait for skeletons to disappear
  const skeleton = page.locator(SELECTORS.skeleton)
  const skeletonCount = await skeleton.count()
  if (skeletonCount > 0) {
    await expect(skeleton.first()).not.toBeVisible({ timeout })
  }
}

/**
 * Assert no loading indicators are visible.
 */
export async function assertNotLoading(page: Page): Promise<void> {
  await expect(page.locator(SELECTORS.spinner)).not.toBeVisible()
  await expect(page.locator(SELECTORS.skeleton).first()).not.toBeVisible()
}

// ============================================================================
// Error/Success State Helpers
// ============================================================================

/**
 * Check if an error message is displayed.
 */
export async function hasError(page: Page): Promise<boolean> {
  const error = page.locator(SELECTORS.errorMessage)
  return (await error.count()) > 0 && (await error.first().isVisible())
}

/**
 * Get error message text.
 */
export async function getErrorMessage(page: Page): Promise<string | null> {
  const error = page.locator(SELECTORS.errorMessage).first()
  if (await error.isVisible()) {
    return error.textContent()
  }
  return null
}

/**
 * Assert no error is displayed.
 */
export async function assertNoError(page: Page): Promise<void> {
  const error = page.locator(SELECTORS.errorMessage)
  const count = await error.count()
  if (count > 0) {
    await expect(error.first()).not.toBeVisible()
  }
}

/**
 * Check if a success message is displayed.
 */
export async function hasSuccess(page: Page): Promise<boolean> {
  const success = page.locator(SELECTORS.successMessage)
  return (await success.count()) > 0 && (await success.first().isVisible())
}

/**
 * Wait for a success message to appear.
 */
export async function waitForSuccess(page: Page, timeout = 10000): Promise<void> {
  await expect(page.locator(SELECTORS.successMessage).first()).toBeVisible({ timeout })
}

// ============================================================================
// Dashboard/Project Helpers
// ============================================================================

/**
 * Get the dashboard link from a success message or page.
 */
export async function getDashboardLink(page: Page): Promise<string | null> {
  const link = page.locator(SELECTORS.dashboardLink).first()
  if (await link.isVisible()) {
    return link.getAttribute('href')
  }
  return null
}

/**
 * Navigate to project dashboard.
 */
export async function navigateToDashboard(page: Page, projectId: number, chainId: number = 1): Promise<void> {
  await page.goto(`/project/${projectId}/${chainId}`)
  await page.waitForLoadState('networkidle')
}

/**
 * Assert we're on a project dashboard page.
 */
export async function assertOnDashboard(page: Page, projectId?: number): Promise<void> {
  const url = page.url()
  expect(url).toMatch(/\/project\/\d+/)
  if (projectId) {
    expect(url).toContain(`/project/${projectId}`)
  }
}
