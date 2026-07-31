import type { Page } from '@playwright/test'
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
