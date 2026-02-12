import type { Page } from '@playwright/test'

// ============================================================================
// Types
// ============================================================================

export interface TestWallet {
  address: string
  privateKey: string
  chainId: number
}

export interface WalletBalance {
  eth: string
  usdc?: string
}

// ============================================================================
// Test Wallets
// ============================================================================

/**
 * Deterministic test wallets for E2E testing.
 * These are well-known test keys - NEVER use in production.
 *
 * Anvil default accounts (from `anvil` local node):
 * These accounts are pre-funded with 10,000 ETH each.
 */
export const TEST_WALLETS: TestWallet[] = [
  {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    chainId: 31337, // Anvil local
  },
  {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    chainId: 31337,
  },
  {
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
    chainId: 31337,
  },
]

/**
 * Get a test wallet by index.
 */
export function getTestWallet(index: number = 0): TestWallet {
  return TEST_WALLETS[index % TEST_WALLETS.length]
}

// ============================================================================
// Wallet Connection Mocking
// ============================================================================

/**
 * Mock wagmi wallet connection in the browser.
 * This injects a mock wallet provider that auto-signs transactions.
 */
export async function mockWalletConnection(page: Page, wallet: TestWallet = TEST_WALLETS[0]) {
  await page.addInitScript((walletData) => {
    // Store wallet data for the mock provider
    (window as unknown as Record<string, unknown>).__TEST_WALLET__ = walletData

    // Mock ethereum provider
    const mockProvider = {
      isMetaMask: true,
      _testWallet: walletData,
      selectedAddress: walletData.address,
      chainId: `0x${walletData.chainId.toString(16)}`,
      networkVersion: walletData.chainId.toString(),

      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        console.log('[MockWallet] Request:', method, params)

        switch (method) {
          case 'eth_requestAccounts':
          case 'eth_accounts':
            return [walletData.address]

          case 'eth_chainId':
            return `0x${walletData.chainId.toString(16)}`

          case 'net_version':
            return walletData.chainId.toString()

          case 'wallet_switchEthereumChain':
            // Simulate successful chain switch
            return null

          case 'eth_getBalance':
            // Return 100 ETH in wei
            return '0x56BC75E2D63100000'

          case 'eth_estimateGas':
            return '0x5208' // 21000 gas

          case 'eth_gasPrice':
            return '0x3B9ACA00' // 1 gwei

          case 'eth_getTransactionCount':
            return '0x0'

          case 'eth_sendTransaction':
            // Return a mock transaction hash
            return '0x' + '1234567890abcdef'.repeat(4)

          case 'personal_sign':
          case 'eth_signTypedData_v4':
            // Return a mock signature
            return '0x' + 'a'.repeat(130)

          default:
            console.warn('[MockWallet] Unhandled method:', method)
            return null
        }
      },

      on: (event: string, callback: (data: unknown) => void) => {
        console.log('[MockWallet] Event listener added:', event)
        // Store callbacks for later triggering
        type EventsMap = Record<string, Array<(data: unknown) => void>>
        const w = window as unknown as { __WALLET_EVENTS__?: EventsMap }
        if (!w.__WALLET_EVENTS__) {
          w.__WALLET_EVENTS__ = {}
        }
        if (!w.__WALLET_EVENTS__[event]) {
          w.__WALLET_EVENTS__[event] = []
        }
        w.__WALLET_EVENTS__[event].push(callback)
      },

      removeListener: (event: string, callback: (data: unknown) => void) => {
        type EventsMap = Record<string, Array<(data: unknown) => void>>
        const w = window as unknown as { __WALLET_EVENTS__?: EventsMap }
        if (w.__WALLET_EVENTS__?.[event]) {
          const idx = w.__WALLET_EVENTS__[event].indexOf(callback)
          if (idx > -1) w.__WALLET_EVENTS__[event].splice(idx, 1)
        }
      },
    }

    // Inject mock provider
    Object.defineProperty(window, 'ethereum', {
      value: mockProvider,
      writable: true,
      configurable: true,
    })
  }, wallet)
}

/**
 * Trigger a wallet event (like account or chain change).
 */
export async function triggerWalletEvent(page: Page, event: string, data: unknown) {
  await page.evaluate(({ event, data }) => {
    type EventsMap = Record<string, Array<(data: unknown) => void>>
    const w = window as unknown as { __WALLET_EVENTS__?: EventsMap }
    if (w.__WALLET_EVENTS__?.[event]) {
      w.__WALLET_EVENTS__[event].forEach(callback => callback(data))
    }
  }, { event, data })
}

/**
 * Simulate connecting a wallet via the UI.
 * This clicks through the wallet connection flow.
 */
export async function connectWalletViaUI(page: Page) {
  // Click the connect/sign in button
  const connectButton = page.locator('button').filter({ hasText: /connect|sign in/i }).first()
  if (await connectButton.isVisible()) {
    await connectButton.click()
    await page.waitForTimeout(500)

    // Look for wallet option in modal
    const walletOption = page.locator('button').filter({ hasText: /metamask|wallet/i }).first()
    if (await walletOption.isVisible()) {
      await walletOption.click()
      await page.waitForTimeout(500)
    }
  }
}

// ============================================================================
// SIWE (Sign-In With Ethereum) Mocking
// ============================================================================

/**
 * Mock SIWE authentication flow.
 */
export async function mockSIWEAuth(page: Page, wallet: TestWallet = TEST_WALLETS[0]) {
  // Mock SIWE message endpoint
  await page.route('**/siwe/message', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          message: `juicy.vision wants you to sign in with your Ethereum account:\n${wallet.address}\n\nSign in to juicy.vision\n\nURI: https://juicy.vision\nVersion: 1\nChain ID: ${wallet.chainId}\nNonce: testnonce123\nIssued At: ${new Date().toISOString()}`,
        },
      }),
    })
  })

  // Mock SIWE verify endpoint
  await page.route('**/siwe/verify', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          address: wallet.address,
          chainId: wallet.chainId,
        },
      }),
    })
  })
}

// ============================================================================
// Balance Mocking
// ============================================================================

/**
 * Mock token balances for the test wallet.
 */
export async function mockWalletBalances(page: Page, balances: WalletBalance = { eth: '10.0' }) {
  // Mock ETH balance RPC call
  await page.route('**/*', async (route, request) => {
    const postData = request.postData()
    if (postData && postData.includes('eth_getBalance')) {
      // Convert ETH to wei
      const ethWei = BigInt(Math.floor(parseFloat(balances.eth) * 1e18)).toString(16)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: '0x' + ethWei,
        }),
      })
    } else {
      await route.continue()
    }
  })
}

// ============================================================================
// Transaction Mocking
// ============================================================================

/**
 * Mock transaction submission and confirmation.
 */
export async function mockTransactionExecution(page: Page, options: {
  shouldSucceed?: boolean
  confirmationDelay?: number
  txHash?: string
} = {}) {
  const {
    shouldSucceed = true,
    txHash = '0x' + '1234567890abcdef'.repeat(4),
  } = options

  // Mock transaction receipt
  await page.route('**/*', async (route, request) => {
    const postData = request.postData()
    if (postData && postData.includes('eth_getTransactionReceipt')) {
      if (shouldSucceed) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: {
              transactionHash: txHash,
              blockNumber: '0x1',
              blockHash: '0x' + 'a'.repeat(64),
              status: '0x1', // Success
              gasUsed: '0x5208',
            },
          }),
        })
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: {
              transactionHash: txHash,
              blockNumber: '0x1',
              blockHash: '0x' + 'a'.repeat(64),
              status: '0x0', // Failed
              gasUsed: '0x5208',
            },
          }),
        })
      }
    } else {
      await route.continue()
    }
  })
}

// ============================================================================
// Exports
// ============================================================================

export const testWallet = TEST_WALLETS[0]
