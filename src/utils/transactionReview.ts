import { decodeFunctionData, encodeFunctionData, type Abi, type Address, type Hex } from 'viem'
import {
  jbProjectPayerDeployerAbi,
} from '@bananapus/nana-sdk-core/v6'
import {
  JB_CONTROLLER_ABI,
  JB_CONTROLLER_ADDRESS,
  JB_OMNICHAIN_DEPLOYER_ABI,
  JB_OMNICHAIN_DEPLOYER_ADDRESS,
  REV_DEPLOYER_ABI,
  REV_DEPLOYER_ADDRESS,
} from '../constants/abis'
import { JB_PROJECT_PAYER_DEPLOYER } from '../services/projectPayers'

export const TRANSACTION_REVIEW_EVENT = 'juice:transaction-review-request'

export interface TransactionReviewCall {
  chainId: number
  to: Address
  data: Hex
  value?: bigint
  from?: Address
  abi?: Abi
  functionName?: string
  args?: readonly unknown[]
  label?: string
  contractName?: string
}

export interface TransactionReview {
  calls: readonly TransactionReviewCall[]
  title?: string
  description?: string
  confirmLabel?: string
  kind?: 'transaction' | 'authorization'
  authorization?: unknown
}

export interface ContractReviewCall {
  chainId: number
  address: Address
  abi: Abi
  functionName: string
  args?: readonly unknown[]
  value?: bigint
  account?: Address
}

export interface TransactionReviewEventDetail {
  review: TransactionReview
  respond: (approved: boolean) => void
}

type TransactionReviewHandler = (review: TransactionReview) => Promise<boolean>
let transactionReviewHandler: TransactionReviewHandler | null = null

const KNOWN_CALLS: Array<{ address: Address; abi: Abi; contractName: string }> = [
  {
    address: JB_CONTROLLER_ADDRESS,
    abi: JB_CONTROLLER_ABI,
    contractName: 'JBController',
  },
  {
    address: JB_OMNICHAIN_DEPLOYER_ADDRESS,
    abi: JB_OMNICHAIN_DEPLOYER_ABI,
    contractName: 'JBOmnichainDeployer',
  },
  {
    address: REV_DEPLOYER_ADDRESS,
    abi: REV_DEPLOYER_ABI,
    contractName: 'REVDeployer',
  },
  {
    address: JB_PROJECT_PAYER_DEPLOYER,
    abi: jbProjectPayerDeployerAbi,
    contractName: 'JBProjectPayerDeployer',
  },
]

function attachKnownCallDetails(call: TransactionReviewCall): TransactionReviewCall {
  if (call.abi && call.functionName) return call
  const known = KNOWN_CALLS.find(item => item.address.toLowerCase() === call.to.toLowerCase())
  if (!known || call.data === '0x') return call
  try {
    const decoded = decodeFunctionData({ abi: known.abi, data: call.data })
    return {
      ...call,
      abi: known.abi,
      functionName: decoded.functionName,
      args: decoded.args,
      contractName: call.contractName ?? known.contractName,
    }
  } catch {
    return call
  }
}

export function registerTransactionReviewHandler(handler: TransactionReviewHandler): () => void {
  transactionReviewHandler = handler
  return () => {
    if (transactionReviewHandler === handler) transactionReviewHandler = null
  }
}

export function requestTransactionReview(review: TransactionReview): Promise<boolean> {
  if (!review.calls.length) return Promise.reject(new Error('There is no transaction to review.'))
  const exactReview = {
    ...review,
    calls: review.calls.map(original => {
      const call = attachKnownCallDetails(original)
      return {
        ...call,
        args: call.args ? [...call.args] : undefined,
      }
    }),
  }
  if (transactionReviewHandler) return transactionReviewHandler(exactReview)
  // Hook/service unit tests exercise construction and safety checks without
  // mounting the app shell. Production must always have the review provider.
  if (import.meta.env.MODE === 'test') return Promise.resolve(true)
  return Promise.reject(new Error('Transaction review is unavailable. Reload the page before continuing.'))
}

export async function requireTransactionReview(review: TransactionReview): Promise<void> {
  if (!(await requestTransactionReview(review))) {
    throw new Error('Transaction review cancelled. Nothing was sent.')
  }
}

export async function requireContractTransactionReview(
  call: ContractReviewCall,
  options: Omit<TransactionReview, 'calls'> & { label?: string; contractName?: string } = {},
): Promise<void> {
  const { label, contractName, ...request } = options
  const data = encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args })
  await requireTransactionReview({
    ...request,
    calls: [{
      chainId: call.chainId,
      from: call.account,
      to: call.address,
      data,
      value: call.value,
      abi: call.abi,
      functionName: call.functionName,
      args: call.args,
      label,
      contractName,
    }],
  })
  const after = encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args })
  if (after !== data) throw new Error('Transaction data changed after review. Review it again.')
}

export function transactionReviewJson(review: TransactionReview): string {
  const transactions = review.calls.map(call => ({
    chainId: call.chainId,
    from: call.from,
    to: call.to,
    value: `0x${(call.value ?? 0n).toString(16)}`,
    data: call.data,
  }))
  const resultingCall = transactions.length === 1 ? transactions[0] : { transactions }
  return JSON.stringify(
    review.authorization ? { authorization: review.authorization, resultingCall } : resultingCall,
    (_, value) => typeof value === 'bigint' ? value.toString() : value,
    2,
  )
}

const EXPLORER: Record<number, string> = {
  1: 'https://etherscan.io',
  10: 'https://optimistic.etherscan.io',
  8453: 'https://basescan.org',
  42161: 'https://arbiscan.io',
  11155111: 'https://sepolia.etherscan.io',
  11155420: 'https://sepolia-optimism.etherscan.io',
  84532: 'https://sepolia.basescan.org',
  421614: 'https://sepolia.arbiscan.io',
}

export function buildTransactionAuditPrompt(review: TransactionReview): string {
  const lines = [
    'I am about to authorize a blockchain action in juicy.vision using Juicebox V6 contracts. Act as a careful transaction security reviewer. Trust the exact payload and verified V6 source over the UI. Decode it independently, compare it with my intent, and give a go/no-go.',
    '',
    'Exact app-controlled payload:',
    '```json',
    transactionReviewJson(review),
    '```',
    '',
    'Verify against the Juicebox V6 repositories: https://github.com/Bananapus/version-6',
  ]
  if (typeof window !== 'undefined') lines.push(`Audit the app page/build: ${window.location.href}`)
  review.calls.forEach((call, index) => {
    lines.push(EXPLORER[call.chainId]
      ? `${review.calls.length > 1 ? `Target ${index + 1}` : 'Target'}: ${EXPLORER[call.chainId]}/address/${call.to}`
      : `Target ${index + 1}: chain ${call.chainId}, ${call.to}`)
  })
  lines.push(
    '',
    'Check the chain, destination, native value, selector, every argument, recipient, beneficiary, spender, permission, ownership change, token movement, unlimited approval, delegatecall, and upgrade path. For Safe or Relayr, distinguish authorization/proposal/payment from later onchain execution and check every destination chain.',
    '',
    'Before a verdict, ask me 2–4 short questions about what I expect to change, who controls or receives what, how much moves, and on which chains. Wait for my answers and flag every mismatch.',
    '',
    'End with exactly one verdict: SAFE TO SIGN / DO NOT SIGN / NEEDS MORE INFO, followed by the key reasons. Explicitly warn if a target is not a verified Juicebox V6 deployment.',
  )
  return lines.join('\n')
}
