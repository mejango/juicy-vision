import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PAYMENT_REVIEW_EVENT, type PaymentReviewRequest } from '../../utils/paymentReview'
import PaymentPage from './PaymentPage'

const ACCOUNT = '0x1234567890123456789012345678901234567890'
const TERMINAL = '0x130f5Dd2bD8805443Cf41755253D778a75a67f53'
const NATIVE_TOKEN = '0x000000000000000000000000000000000000EEEe'
const { sendTransaction, readContract } = vi.hoisted(() => ({
  sendTransaction: vi.fn(),
  readContract: vi.fn(),
}))

vi.mock('react-router-dom', () => ({
  useParams: () => ({ sessionId: 'session-1' }),
}))

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: '0x1234567890123456789012345678901234567890', isConnected: true }),
  useConnect: () => ({ connect: vi.fn(), connectors: [], isPending: false }),
  useWalletClient: () => ({
    data: {
      account: { address: '0x1234567890123456789012345678901234567890' },
      chain: { id: 11155111 },
      getChainId: vi.fn().mockResolvedValue(11155111),
      sendTransaction,
    },
  }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
}))

vi.mock('viem', () => ({
  createPublicClient: () => ({
    readContract,
    getBalance: vi.fn().mockResolvedValue(2_000_000_000_000_000n),
    call: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
  }),
  encodeFunctionData: vi.fn(({ functionName }) => functionName === 'pay' ? '0x1234' : '0xabcd'),
  erc20Abi: [],
  formatUnits: vi.fn((value: bigint, decimals: number) =>
    (Number(value) / 10 ** decimals).toString()),
  http: vi.fn(),
}))

vi.mock('../../utils/paymentTerminal', () => ({
  getPaymentTerminal: vi.fn().mockResolvedValue({
    address: '0x130f5Dd2bD8805443Cf41755253D778a75a67f53',
    type: 'multi',
  }),
}))

vi.mock('../../utils/projectTrust', () => ({
  assertCurrentProjectPayConfigurationTrusted: vi.fn().mockResolvedValue(undefined),
  requireRecognizedRuntimeHook: vi.fn().mockResolvedValue(undefined),
}))

class MockWebSocket {
  static OPEN = 1
  readyState = 1
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()
}

describe('PaymentPage wallet review', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('WebSocket', MockWebSocket)
    readContract.mockResolvedValue([
      { id: 123n },
      1_000_000_000_000_000_000n,
      0n,
      [],
    ])

    const session = {
      id: 'session-1',
      deviceId: 'device-1',
      amountUsd: 1,
      token: null,
      tokenSymbol: 'ETH',
      status: 'pending',
      paymentMethod: null,
      txHash: null,
      merchantId: 'merchant-1',
      merchantName: 'Test Merchant',
      projectId: 9,
      chainId: 11155111,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
    }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/terminal/session/session-1')) {
        return { json: async () => ({ success: true, data: { session } }) }
      }
      if (url.endsWith('/terminal/session/session-1/pay/wallet')) {
        return {
          json: async () => ({
            success: true,
            data: {
              terminalAddress: TERMINAL,
              projectId: 9,
              tokenAddress: NATIVE_TOKEN,
              paymentAmount: '1000000000000000',
              paymentMemo: 'Terminal payment',
              quoteExpiresAt: new Date(Date.now() + 60_000).toISOString(),
            },
          }),
        }
      }
      throw new Error(`Unexpected request: ${url}`)
    }))
  })

  it('shows the exact review and sends nothing when the user cancels', async () => {
    let reviewRequest: PaymentReviewRequest | undefined
    const onReview = (event: Event) => {
      reviewRequest = (event as CustomEvent<PaymentReviewRequest>).detail
      reviewRequest.respond(false)
    }
    window.addEventListener(PAYMENT_REVIEW_EVENT, onReview)
    render(<PaymentPage />)

    fireEvent.click(await screen.findByRole('button', { name: /Pay with 0x1234/i }))

    await waitFor(() => expect(reviewRequest).toBeDefined())
    expect(reviewRequest!.review).toMatchObject({
      account: ACCOUNT,
      chainId: 11155111,
      projectId: '9',
      terminal: TERMINAL,
      route: 'direct terminal payment',
      tokenSymbol: 'ETH',
      tokenAddress: NATIVE_TOKEN,
      amountRaw: '1000000000000000',
      valueRaw: '1000000000000000',
      beneficiary: ACCOUNT,
      memo: 'Terminal payment',
      rulesetId: '123',
      callData: '0x1234',
      approval: null,
    })
    expect(sendTransaction).not.toHaveBeenCalled()
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/pay/wallet/start'))).toBe(false)
    window.removeEventListener(PAYMENT_REVIEW_EVENT, onReview)
  })
})
