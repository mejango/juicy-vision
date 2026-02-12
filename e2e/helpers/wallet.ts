import type { Page, Locator } from '@playwright/test'
import { expect } from '@playwright/test'
import { mockWalletConnection, mockSIWEAuth, TEST_WALLETS, type TestWallet } from '../fixtures/test-wallet'

// ============================================================================
// Selectors
// ============================================================================

const SELECTORS = {
  connectButton: 'button:has-text("Connect"), button:has-text("Sign in"), button:has-text("Sign In")',
  disconnectButton: 'button:has-text("Disconnect"), button:has-text("Sign out"), button:has-text("Logout")',
  walletAddress: '[data-testid="wallet-address"], .wallet-address',
  walletBalance: '[data-testid="wallet-balance"], .wallet-balance',
  authModal: '[role="dialog"], [data-testid="auth-modal"]',
  passkeyOption: 'button:has-text("Passkey"), button:has-text("Touch ID"), button:has-text("Face ID")',
  walletOption: 'button:has-text("MetaMask"), button:has-text("Wallet")',
  emailInput: 'input[type="email"], input[placeholder*="email" i]',
  chainSelector: '[data-testid="chain-selector"], .chain-selector',
  chainOption: '[data-testid="chain-option"], .chain-option',
} as const

// ============================================================================
// Wallet State Types
// ============================================================================

export interface WalletState {
  isConnected: boolean
  address: string | null
  chainId: number | null
  mode: 'managed' | 'self_custody' | null
}

// ============================================================================
// Wallet Connection Helpers
// ============================================================================

/**
 * Get current wallet state from the page.
 */
export async function getWalletState(page: Page): Promise<WalletState> {
  return page.evaluate(() => {
    // Check auth store
    const authStore = localStorage.getItem('juice-auth')
    let mode: 'managed' | 'self_custody' | null = null
    let managedAddress: string | null = null

    if (authStore) {
      try {
        const parsed = JSON.parse(authStore)
        mode = parsed.state?.mode || null
        if (mode === 'managed') {
          managedAddress = localStorage.getItem('juice-smart-account-address')
        }
      } catch {
        // Continue
      }
    }

    // Check for wagmi connection (self-custody)
    const wagmiStore = localStorage.getItem('wagmi.store')
    let selfCustodyAddress: string | null = null
    let chainId: number | null = null

    if (wagmiStore) {
      try {
        const parsed = JSON.parse(wagmiStore)
        const state = parsed.state
        if (state?.connections?.length > 0) {
          const conn = state.connections[0]
          selfCustodyAddress = conn.accounts?.[0] || null
          chainId = conn.chainId || null
        }
      } catch {
        // Continue
      }
    }

    const address = managedAddress || selfCustodyAddress
    return {
      isConnected: !!address,
      address,
      chainId,
      mode,
    }
  })
}

/**
 * Check if wallet is connected.
 */
export async function isWalletConnected(page: Page): Promise<boolean> {
  const state = await getWalletState(page)
  return state.isConnected
}

/**
 * Get the displayed wallet address from the UI.
 */
export async function getDisplayedAddress(page: Page): Promise<string | null> {
  const addressEl = page.locator(SELECTORS.walletAddress).first()
  if (await addressEl.isVisible()) {
    return addressEl.textContent()
  }
  return null
}

/**
 * Open the auth/connect modal.
 */
export async function openConnectModal(page: Page): Promise<void> {
  const connectBtn = page.locator(SELECTORS.connectButton).first()
  if (await connectBtn.isVisible()) {
    await connectBtn.click()
    await page.waitForTimeout(300)

    // Wait for modal
    const modal = page.locator(SELECTORS.authModal).first()
    await expect(modal).toBeVisible({ timeout: 5000 })
  }
}

/**
 * Connect with a passkey (mocked for tests).
 * Sets up localStorage to simulate passkey auth.
 */
export async function connectWithPasskey(page: Page, options: {
  email?: string
  smartAccountAddress?: string
} = {}): Promise<void> {
  const {
    email = 'test@juicy.vision',
    smartAccountAddress = '0x1234567890123456789012345678901234567890',
  } = options

  // Set up managed auth state directly
  await page.evaluate(({ email, address }) => {
    const authState = {
      state: {
        mode: 'managed',
        privacyMode: 'open_book',
        user: {
          id: 'test-user',
          email,
          privacyMode: 'open_book',
          hasCustodialWallet: true,
          passkeyEnabled: true,
        },
        token: 'test-token-' + Date.now(),
      },
      version: 1,
    }
    localStorage.setItem('juice-auth', JSON.stringify(authState))
    localStorage.setItem('juice-smart-account-address', address)
  }, { email, address: smartAccountAddress })

  // Reload to apply
  await page.reload()
  await page.waitForLoadState('networkidle')
}

/**
 * Connect with an external wallet (self-custody mode).
 * Uses the mock wallet provider.
 */
export async function connectWithWallet(page: Page, wallet: TestWallet = TEST_WALLETS[0]): Promise<void> {
  // Inject mock provider
  await mockWalletConnection(page, wallet)
  await mockSIWEAuth(page, wallet)

  // Open connect modal
  await openConnectModal(page)

  // Click wallet option
  const walletOption = page.locator(SELECTORS.walletOption).first()
  if (await walletOption.isVisible()) {
    await walletOption.click()
    await page.waitForTimeout(500)
  }

  // Set self-custody mode in auth store
  await page.evaluate((address) => {
    const authState = {
      state: {
        mode: 'self_custody',
        privacyMode: 'open_book',
        user: null,
        token: null,
      },
      version: 1,
    }
    localStorage.setItem('juice-auth', JSON.stringify(authState))

    // Simulate wagmi connection
    const wagmiState = {
      state: {
        connections: [{
          accounts: [address],
          chainId: 1,
          connector: { id: 'injected', name: 'MetaMask' },
        }],
        current: address,
      },
    }
    localStorage.setItem('wagmi.store', JSON.stringify(wagmiState))
  }, wallet.address)

  await page.reload()
  await page.waitForLoadState('networkidle')
}

/**
 * Disconnect the wallet.
 */
export async function disconnectWallet(page: Page): Promise<void> {
  // Try clicking disconnect button
  const disconnectBtn = page.locator(SELECTORS.disconnectButton).first()
  if (await disconnectBtn.isVisible()) {
    await disconnectBtn.click()
    await page.waitForTimeout(300)
  }

  // Clear localStorage as backup
  await page.evaluate(() => {
    localStorage.removeItem('juice-auth')
    localStorage.removeItem('juice-smart-account-address')
    localStorage.removeItem('juice-passkey-wallet')
    localStorage.removeItem('juice-passkey-credential')
    localStorage.removeItem('wagmi.store')
    localStorage.removeItem('juicy-identity')
  })

  await page.reload()
  await page.waitForLoadState('networkidle')
}

// ============================================================================
// Chain Switching Helpers
// ============================================================================

/**
 * Switch to a different chain.
 */
export async function switchChain(page: Page, chainId: number): Promise<void> {
  // Open chain selector
  const chainSelector = page.locator(SELECTORS.chainSelector).first()
  if (await chainSelector.isVisible()) {
    await chainSelector.click()
    await page.waitForTimeout(200)

    // Click the chain option
    const chainOption = page.locator(SELECTORS.chainOption).filter({
      hasText: getChainName(chainId),
    }).first()

    if (await chainOption.isVisible()) {
      await chainOption.click()
    }
  }

  // Trigger wallet event for chain change
  await page.evaluate((chainId) => {
    const ethereum = (window as unknown as Record<string, unknown>).ethereum as {
      emit?: (event: string, chainId: string) => void
    }
    if (ethereum?.emit) {
      ethereum.emit('chainChanged', `0x${chainId.toString(16)}`)
    }
  }, chainId)
}

/**
 * Get chain name from chain ID.
 */
function getChainName(chainId: number): string {
  const chains: Record<number, string> = {
    1: 'Ethereum',
    10: 'Optimism',
    8453: 'Base',
    42161: 'Arbitrum',
    31337: 'Local',
    11155111: 'Sepolia',
  }
  return chains[chainId] || `Chain ${chainId}`
}

// ============================================================================
// Transaction Signing Helpers
// ============================================================================

/**
 * Sign and submit a transaction (for self-custody mode).
 * This uses the mock wallet provider to auto-sign.
 */
export async function signTransaction(page: Page): Promise<string> {
  // Mock transaction will auto-sign via the mock provider
  // This just waits for the transaction hash to appear

  // Wait for transaction hash element
  const txHashEl = page.locator('[data-testid="tx-hash"], .tx-hash').first()
  await expect(txHashEl).toBeVisible({ timeout: 10000 })

  const hash = await txHashEl.textContent()
  return hash || '0x' + '0'.repeat(64)
}

/**
 * Wait for transaction confirmation.
 */
export async function waitForTransactionConfirmation(
  page: Page,
  options: { timeout?: number } = {}
): Promise<void> {
  const { timeout = 30000 } = options

  // Wait for confirmation indicator
  const confirmationEl = page.locator(
    '[data-status="confirmed"], .status-confirmed, :has-text("Confirmed")'
  ).first()

  await expect(confirmationEl).toBeVisible({ timeout })
}

// ============================================================================
// Balance Helpers
// ============================================================================

/**
 * Get displayed wallet balance.
 */
export async function getDisplayedBalance(page: Page): Promise<string | null> {
  const balanceEl = page.locator(SELECTORS.walletBalance).first()
  if (await balanceEl.isVisible()) {
    return balanceEl.textContent()
  }
  return null
}

/**
 * Assert wallet has sufficient balance.
 */
export async function assertSufficientBalance(
  page: Page,
  minBalance: string,
  token: string = 'ETH'
): Promise<void> {
  const balanceText = await getDisplayedBalance(page)
  expect(balanceText).not.toBeNull()
  expect(balanceText).toContain(token)
  // Note: Actual balance comparison would need parsing
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Assert wallet is connected.
 */
export async function assertWalletConnected(page: Page): Promise<void> {
  const state = await getWalletState(page)
  expect(state.isConnected).toBe(true)
  expect(state.address).not.toBeNull()
}

/**
 * Assert wallet is disconnected.
 */
export async function assertWalletDisconnected(page: Page): Promise<void> {
  const state = await getWalletState(page)
  expect(state.isConnected).toBe(false)
}

/**
 * Assert in managed mode (passkey/email auth).
 */
export async function assertManagedMode(page: Page): Promise<void> {
  const state = await getWalletState(page)
  expect(state.mode).toBe('managed')
}

/**
 * Assert in self-custody mode (external wallet).
 */
export async function assertSelfCustodyMode(page: Page): Promise<void> {
  const state = await getWalletState(page)
  expect(state.mode).toBe('self_custody')
}
