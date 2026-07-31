/**
 * Live-state adapter for the pure .jb draft reconstruction helpers.
 *
 * Keeping RPC/indexer reads here lets projectDraftExport.ts remain a
 * deterministic converter that is straightforward to test.
 */
import { erc20Abi } from 'viem'
import {
  JB_CONTRACTS,
  JB_ROUTER_TERMINAL,
  JB_ROUTER_TERMINAL_REGISTRY,
  NATIVE_TOKEN,
  USDC_ADDRESSES,
  type SupportedChainId,
} from '../constants'
import {
  buildDraftFromLive,
  type DraftFundsSnapshot,
  type DraftProjectInput,
  type DraftRuleset,
  type DraftRulesetMetadata,
  type ProjectDraftResult,
} from './projectDraftExport'
import {
  fetchConnectedChains,
  fetchProjectSplits,
  fetchProjectWithRuleset,
  fetchRevnetOperator,
} from './bendystraw'
import { publicClientFor } from './projectTx'

type DraftAccountingContext = DraftProjectInput['contexts'][number]
type DraftStageSource = DraftProjectInput['current']

const RULESET_TUPLE = {
  type: 'tuple',
  components: [
    { name: 'cycleNumber', type: 'uint48' },
    { name: 'id', type: 'uint48' },
    { name: 'basedOnId', type: 'uint48' },
    { name: 'start', type: 'uint48' },
    { name: 'duration', type: 'uint32' },
    { name: 'weight', type: 'uint112' },
    { name: 'weightCutPercent', type: 'uint32' },
    { name: 'approvalHook', type: 'address' },
    { name: 'metadata', type: 'uint256' },
  ],
} as const

const METADATA_TUPLE = {
  type: 'tuple',
  components: [
    { name: 'reservedPercent', type: 'uint16' },
    { name: 'cashOutTaxRate', type: 'uint16' },
    { name: 'baseCurrency', type: 'uint32' },
    { name: 'pausePay', type: 'bool' },
    { name: 'pauseCreditTransfers', type: 'bool' },
    { name: 'allowOwnerMinting', type: 'bool' },
    { name: 'allowSetCustomToken', type: 'bool' },
    { name: 'allowTerminalMigration', type: 'bool' },
    { name: 'allowSetTerminals', type: 'bool' },
    { name: 'allowSetController', type: 'bool' },
    { name: 'allowAddAccountingContext', type: 'bool' },
    { name: 'allowAddPriceFeed', type: 'bool' },
    { name: 'ownerMustSendPayouts', type: 'bool' },
    { name: 'holdFees', type: 'bool' },
    { name: 'scopeCashOutsToLocalBalances', type: 'bool' },
    { name: 'useDataHookForPay', type: 'bool' },
    { name: 'useDataHookForCashOut', type: 'bool' },
    { name: 'dataHook', type: 'address' },
    { name: 'metadata', type: 'uint16' },
  ],
} as const

const CONTROLLER_RULESET_ABI = [
  {
    name: 'currentRulesetOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{ ...RULESET_TUPLE, name: 'ruleset' }, { ...METADATA_TUPLE, name: 'metadata' }],
  },
  {
    name: 'upcomingRulesetOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{ ...RULESET_TUPLE, name: 'ruleset' }, { ...METADATA_TUPLE, name: 'metadata' }],
  },
] as const

const DIRECTORY_TERMINALS_ABI = [{
  name: 'terminalsOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'projectId', type: 'uint256' }],
  outputs: [{ name: '', type: 'address[]' }],
}] as const

const ROUTER_REGISTRY_TERMINAL_OF_ABI = [{
  name: 'terminalOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'projectId', type: 'uint256' }],
  outputs: [{ name: '', type: 'address' }],
}] as const

type OnchainRuleset = {
  id: number | bigint
  duration: number
  weight: bigint
  weightCutPercent: number
  approvalHook: string
}

type OnchainRulesetMetadata =
  Omit<DraftRulesetMetadata, 'reservedPercent' | 'cashOutTaxRate' | 'baseCurrency' | 'metadata'>
  & {
    reservedPercent: number
    cashOutTaxRate: number
    baseCurrency: number
    metadata: number
  }

function sameAddress(a: string | undefined | null, b: string | undefined | null): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase()
}

function isCustomToken(token: string, chainId: number): boolean {
  if (sameAddress(token, NATIVE_TOKEN)) return false
  return !sameAddress(token, USDC_ADDRESSES[chainId as SupportedChainId])
}

function toDraftRuleset(
  ruleset: OnchainRuleset,
  metadata: OnchainRulesetMetadata,
): DraftRuleset {
  return {
    id: String(ruleset.id),
    duration: Number(ruleset.duration || 0),
    weight: String(ruleset.weight || 0),
    weightCutPercent: Number(ruleset.weightCutPercent || 0),
    approvalHook: ruleset.approvalHook,
    metadata: {
      reservedPercent: Number(metadata.reservedPercent || 0),
      cashOutTaxRate: Number(metadata.cashOutTaxRate || 0),
      baseCurrency: Number(metadata.baseCurrency || 0),
      pausePay: !!metadata.pausePay,
      pauseCreditTransfers: !!metadata.pauseCreditTransfers,
      allowOwnerMinting: !!metadata.allowOwnerMinting,
      allowSetCustomToken: !!metadata.allowSetCustomToken,
      allowTerminalMigration: !!metadata.allowTerminalMigration,
      allowSetTerminals: !!metadata.allowSetTerminals,
      allowSetController: !!metadata.allowSetController,
      allowAddAccountingContext: !!metadata.allowAddAccountingContext,
      allowAddPriceFeed: !!metadata.allowAddPriceFeed,
      ownerMustSendPayouts: !!metadata.ownerMustSendPayouts,
      holdFees: !!metadata.holdFees,
      scopeCashOutsToLocalBalances: !!metadata.scopeCashOutsToLocalBalances,
      useDataHookForPay: !!metadata.useDataHookForPay,
      useDataHookForCashOut: !!metadata.useDataHookForCashOut,
      dataHook: metadata.dataHook,
      metadata: Number(metadata.metadata || 0),
    },
  }
}

async function readFundsSnapshot(
  projectId: string,
  chainId: number,
  rulesetId: string,
): Promise<{ snapshot: DraftFundsSnapshot; contexts: DraftAccountingContext[] }> {
  const splits = await fetchProjectSplits(projectId, chainId, rulesetId)
  const contexts: DraftAccountingContext[] = (splits.accountingContexts || []).map((context) => ({
    token: context.token,
    decimals: context.tokenDecimals,
    currency: context.currency,
  }))
  const payoutSplitsByToken: DraftFundsSnapshot['payoutSplitsByToken'] = {}
  for (const context of contexts) {
    const groupId = BigInt(context.token).toString()
    const group = (splits.splitGroups || []).find((candidate) => candidate.groupId === groupId)
    payoutSplitsByToken[context.token.toLowerCase()] = (group?.splits || []).map((split) => ({
      percent: split.percent,
      projectId: split.projectId,
      beneficiary: split.beneficiary,
      preferAddToBalance: split.preferAddToBalance,
      lockedUntil: split.lockedUntil,
      hook: split.hook,
    }))
  }
  const fundAccessByToken: DraftFundsSnapshot['fundAccessByToken'] = {}
  for (const group of splits.fundAccessLimitGroups || []) {
    fundAccessByToken[group.token.toLowerCase()] = {
      payoutLimits: group.payoutLimits.map((limit) => ({
        amount: limit.amount,
        currency: limit.currency,
      })),
      surplusAllowances: group.surplusAllowances.map((allowance) => ({
        amount: allowance.amount,
        currency: allowance.currency,
      })),
    }
  }
  return {
    snapshot: {
      reservedSplits: splits.reservedSplits,
      payoutSplitsByToken,
      fundAccessByToken,
    },
    contexts,
  }
}

/** Reconstruct the current deployment into an importable create-flow draft. */
export async function buildProjectCreateDraft(
  projectId: string,
  chainId: number,
  options?: { tokenSymbol?: string },
): Promise<ProjectDraftResult> {
  const pid = BigInt(projectId)
  const client = publicClientFor(chainId)
  const project = await fetchProjectWithRuleset(projectId, chainId, 6)
  if (!project) throw new Error('The project could not be verified onchain.')
  if (!project.controllerRecognized) {
    throw new Error('This project uses a non-standard controller, which the create wizard cannot reproduce.')
  }
  const isRevnetProject = !!project.isRevnet

  let chainIds = [chainId]
  try {
    const connected = await fetchConnectedChains(projectId, chainId, 6)
    if (connected.length) {
      chainIds = [...new Set([chainId, ...connected.map((chain) => chain.chainId)])]
    }
  } catch {
    // Export the current chain and let the wizard re-add chains if indexing is unavailable.
  }

  let [ruleset, metadata] = await client.readContract({
    address: JB_CONTRACTS.JBController,
    abi: CONTROLLER_RULESET_ABI,
    functionName: 'currentRulesetOf',
    args: [pid],
  })
  if (BigInt(ruleset.id) === 0n) {
    ;[ruleset, metadata] = await client.readContract({
      address: JB_CONTRACTS.JBController,
      abi: CONTROLLER_RULESET_ABI,
      functionName: 'upcomingRulesetOf',
      args: [pid],
    })
  }
  if (BigInt(ruleset.id) === 0n) {
    throw new Error('No live ruleset could be verified for this project.')
  }

  const terminals = await client.readContract({
    address: JB_CONTRACTS.JBDirectory,
    abi: DIRECTORY_TERMINALS_ABI,
    functionName: 'terminalsOf',
    args: [pid],
  })
  const terminalAddresses = terminals.map((terminal) => terminal.toLowerCase())
  if (!terminalAddresses.includes(JB_CONTRACTS.JBMultiTerminal.toLowerCase())) {
    throw new Error('The canonical terminal is missing, which the .jb editor cannot reproduce.')
  }
  const allowedTerminals = [
    JB_CONTRACTS.JBMultiTerminal.toLowerCase(),
    JB_ROUTER_TERMINAL_REGISTRY.toLowerCase(),
  ]
  if (terminalAddresses.some((terminal) => !allowedTerminals.includes(terminal))) {
    throw new Error('The project uses a custom terminal, which the .jb editor cannot reproduce.')
  }
  const usesRouterTerminalRegistry =
    terminalAddresses.includes(JB_ROUTER_TERMINAL_REGISTRY.toLowerCase())
  if (usesRouterTerminalRegistry) {
    const target = await client.readContract({
      address: JB_ROUTER_TERMINAL_REGISTRY,
      abi: ROUTER_REGISTRY_TERMINAL_OF_ABI,
      functionName: 'terminalOf',
      args: [pid],
    })
    if (!sameAddress(target, JB_ROUTER_TERMINAL)) {
      throw new Error('The project uses a custom router-terminal target, which the .jb editor cannot reproduce.')
    }
  }

  const currentFunds = await readFundsSnapshot(projectId, chainId, String(ruleset.id))
  const contexts = await Promise.all(currentFunds.contexts.map(async (context) => {
    if (!isCustomToken(context.token, chainId)) return context
    const symbol = await client.readContract({
      address: context.token as `0x${string}`,
      abi: erc20Abi,
      functionName: 'symbol',
    }).catch(() => '')
    return { ...context, symbol }
  }))

  let upcoming: DraftStageSource | null = null
  if (!isRevnetProject) {
    const [nextRuleset, nextMetadata] = await client.readContract({
      address: JB_CONTRACTS.JBController,
      abi: CONTROLLER_RULESET_ABI,
      functionName: 'upcomingRulesetOf',
      args: [pid],
    })
    if (BigInt(nextRuleset.id) !== 0n && String(nextRuleset.id) !== String(ruleset.id)) {
      const nextFunds = await readFundsSnapshot(projectId, chainId, String(nextRuleset.id))
      upcoming = {
        ruleset: toDraftRuleset(nextRuleset, nextMetadata),
        funds: nextFunds.snapshot,
      }
    }
  }

  let owner = project.owner || ''
  if (isRevnetProject) {
    const operator = await fetchRevnetOperator(projectId, chainId).catch(() => null)
    if (operator) owner = operator
  }

  return buildDraftFromLive({
    projectId: Number(projectId),
    chainId,
    chainIds,
    isRevnet: isRevnetProject,
    owner,
    metadata: project.metadata || {},
    tokenSymbol: options?.tokenSymbol,
    contexts,
    usesRouterTerminalRegistry,
    current: { ruleset: toDraftRuleset(ruleset, metadata), funds: currentFunds.snapshot },
    upcoming,
  })
}
