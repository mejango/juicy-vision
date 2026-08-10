import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CashOutModal from './CashOutModal'
import type { CashOutPreviewOutcome } from '../../utils/terminalPreview'

const TERMINAL = '0x130f5dd2bd8805443cf41755253d778a75a67f53' as const
const TOKEN = '0x000000000000000000000000000000000000eeee' as const
const HOLDER = '0x1234567890123456789012345678901234567890' as const

const mocks = vi.hoisted(() => ({
  getPaymentTerminal: vi.fn(),
  resolveOutcome: vi.fn(),
  buildCashOutTx: vi.fn(),
  simulate: vi.fn(),
  waitForReceipt: vi.fn(),
  sendTransaction: vi.fn(),
  getChainId: vi.fn(),
  switchChain: vi.fn(),
  addTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  readContract: vi.fn(),
}))

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: HOLDER }),
  useWalletClient: () => ({
    data: { account: { address: HOLDER }, getChainId: mocks.getChainId, sendTransaction: mocks.sendTransaction },
  }),
  useSwitchChain: () => ({ switchChainAsync: mocks.switchChain }),
}))

vi.mock('@bananapus/nana-sdk-core/v6', async importOriginal => ({
  ...(await importOriginal<typeof import('@bananapus/nana-sdk-core/v6')>()),
  buildCashOutTx: mocks.buildCashOutTx,
}))

vi.mock('../../stores', () => {
  const useTransactionStore = Object.assign(
    () => ({ addTransaction: mocks.addTransaction, updateTransaction: mocks.updateTransaction }),
    {
      getState: () => ({
        transactions: [],
        addTransaction: mocks.addTransaction,
        updateTransaction: mocks.updateTransaction,
      }),
    },
  )
  return {
    useThemeStore: () => ({ theme: 'dark' }),
    useTransactionStore,
    useAuthStore: () => ({ mode: 'self_custody', isAuthenticated: () => false }),
  }
})

vi.mock('../../hooks', () => ({
  executeManagedTransaction: vi.fn(),
  useManagedWallet: () => ({ address: null }),
  useWalletBalances: () => ({ perChain: [{ chainId: 11155111, eth: 10n ** 18n }], loading: false, available: true }),
  formatEthBalance: (value: bigint) => value.toString(),
}))

vi.mock('../../hooks/useManagedWallet', () => ({
  useManagedWallet: () => ({ address: null, isManagedMode: false }),
  executeManagedTransaction: vi.fn(),
}))

vi.mock('../../hooks/useSafeApp', () => ({
  useSafeApp: () => ({ isSafeApp: false, safeInfo: null, detecting: false }),
}))

vi.mock('../../hooks/useReviewedTransactionAccount', () => ({
  useReviewedTransactionAccount: () => ({ assertCurrentAccount: vi.fn() }),
}))

vi.mock('../../utils/transactionVerification', () => ({
  verifyCashOutParams: () => ({ doubts: [], verifiedParams: {} }),
}))

vi.mock('../../utils/paymentTerminal', () => ({ getPaymentTerminal: mocks.getPaymentTerminal }))

vi.mock('../../utils/projectTrust', () => ({
  assertCurrentProjectCashOutConfigurationTrusted: vi.fn().mockResolvedValue(undefined),
  requireRecognizedRuntimeHook: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../utils/terminalPreview', async importOriginal => ({
  ...(await importOriginal<typeof import('../../utils/terminalPreview')>()),
  resolveCashOutPreviewOutcome: mocks.resolveOutcome,
}))

vi.mock('../../utils/transactionSafety', () => ({
  estimateTransactionGasWithHeadroom: vi.fn().mockResolvedValue(200_000n),
  simulateTransaction: mocks.simulate,
  waitForSuccessfulTransaction: mocks.waitForReceipt,
}))

vi.mock('viem', async importOriginal => ({
  ...(await importOriginal<typeof import('viem')>()),
  createPublicClient: () => ({ readContract: mocks.readContract }),
}))

vi.mock('../../constants', async importOriginal => ({
  ...(await importOriginal<typeof import('../../constants')>()),
  RPC_ENDPOINTS: { 11155111: ['https://rpc.test'] },
}))

const OUTCOME: CashOutPreviewOutcome = {
  route: 'treasury',
  expectedReturn: 10n ** 18n,
  minimumReturn: 10n ** 18n,
  terminalMinimum: 10n ** 18n,
  metadata: '0x',
  treasuryGross: 10n ** 18n,
  treasuryProtocolFee: 0n,
  treasuryNet: 10n ** 18n,
  buyback: null,
}

function renderModal(overrides: Partial<ComponentProps<typeof CashOutModal>> = {}) {
  const props: ComponentProps<typeof CashOutModal> = {
    isOpen: true,
    onClose: vi.fn(),
    projectId: '1',
    projectName: 'Test Project',
    chainId: 11155111,
    tokenAmount: '100',
    tokenSymbol: 'TEST',
    reclaimToken: TOKEN,
    reclaimTokenDecimals: 18,
    currencySymbol: 'ETH',
    expectedTerminal: TERMINAL,
    ...overrides,
  }
  render(<CashOutModal {...props} />)
  return props
}

describe('CashOutModal double-submit guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.getPaymentTerminal.mockResolvedValue({ address: TERMINAL })
    mocks.resolveOutcome.mockReturnValue(OUTCOME)
    mocks.buildCashOutTx.mockReturnValue({
      abi: [{ name: 'cashOutTokensOf', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] }],
      functionName: 'cashOutTokensOf',
      args: [],
    })
    mocks.readContract.mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === 'previewCashOutFrom') return Promise.resolve([{ id: 1n }, 10n ** 18n, 0n, []])
      if (functionName === 'feeFreeSurplusOf') return Promise.resolve(0n)
      if (functionName === 'isFeelessFor') return Promise.resolve(false)
      return Promise.resolve(0n)
    })
    mocks.simulate.mockResolvedValue(undefined)
    mocks.waitForReceipt.mockResolvedValue(undefined)
    mocks.sendTransaction.mockResolvedValue('0xhash')
    mocks.getChainId.mockResolvedValue(11155111)
    mocks.switchChain.mockResolvedValue(undefined)
    mocks.addTransaction.mockReturnValue('tx-1')
  })

  afterEach(() => vi.restoreAllMocks())

  it('sends only one cash out when the confirm button is clicked twice in the same tick', async () => {
    renderModal()

    const button = await screen.findByRole('button', { name: 'Confirm Cash Out' })
    await waitFor(() => expect(button).toBeEnabled())

    // Two synchronous clicks in a single act — the in-flight window before the
    // first await, exactly where a double burn would occur without the lock.
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await waitFor(() => expect(mocks.sendTransaction).toHaveBeenCalledTimes(1))
    // A second concurrent flow would have opened its own transaction record.
    expect(mocks.addTransaction).toHaveBeenCalledTimes(1)
    expect(mocks.sendTransaction).toHaveBeenCalledTimes(1)
  })

  // The modal is a native <dialog>. Escape now arrives as the UA `cancel` event
  // and a backdrop click is a click on the dialog element itself, so both
  // dismissal paths have to respect the same in-flight guard the close button
  // uses. Before the migration neither path existed for this modal at all.
  describe('dismissal guards', () => {
    async function startCashOut() {
      const button = await screen.findByRole('button', { name: 'Confirm Cash Out' })
      await waitFor(() => expect(button).toBeEnabled())
      await act(async () => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await waitFor(() => expect(mocks.sendTransaction).toHaveBeenCalledTimes(1))
    }

    function dialog(): HTMLDialogElement {
      const element = document.querySelector('dialog')
      if (!element) throw new Error('cash out dialog is not open')
      return element as HTMLDialogElement
    }

    it('closes on Escape while the cash out is still a preview', async () => {
      const props = renderModal()
      await screen.findByRole('button', { name: 'Confirm Cash Out' })

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(props.onClose).toHaveBeenCalledTimes(1)
    })

    it('closes on a backdrop click while the cash out is still a preview', async () => {
      const user = userEvent.setup()
      const props = renderModal()
      await screen.findByRole('button', { name: 'Confirm Cash Out' })

      await user.click(dialog())

      expect(props.onClose).toHaveBeenCalledTimes(1)
    })

    it('blocks Escape once the transaction is in flight', async () => {
      // A signature that never settles keeps the modal out of the preview,
      // confirmed and failed states for the whole test.
      mocks.sendTransaction.mockReturnValue(new Promise(() => {}))
      const props = renderModal()
      await startCashOut()

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(props.onClose).not.toHaveBeenCalled()
      expect(dialog().open).toBe(true)
    })

    it('blocks a backdrop click once the transaction is in flight', async () => {
      const user = userEvent.setup()
      mocks.sendTransaction.mockReturnValue(new Promise(() => {}))
      const props = renderModal()
      await startCashOut()

      await user.click(dialog())

      expect(props.onClose).not.toHaveBeenCalled()
    })
  })
})
