import { type Address, type PublicClient, zeroAddress } from 'viem'
import {
  JB_BUYBACK_HOOK,
  JB_BUYBACK_HOOK_REGISTRY,
  JB_CONTRACTS,
  JB_OMNICHAIN_DEPLOYER,
  REV_DEPLOYER,
  REV_OWNER,
} from '../constants'
import { requireRecognized721Hook } from '../services/nft'
import { requireRecognizedLpSplitHookClone } from './addressRegistry'
import { JB_CONTROLLER_ABI } from '../constants/abis/jbController'
import { getProjectController } from './paymentTerminal'

const RECOGNIZED_APPROVAL_HOOKS = new Set([
  '0xd25264015483caa5c34643942d41f94bed5f1e92', // JBDeadline3Hours
  '0x3a15ac0bcf4f7dd48359a36b3e293254cf26d4ca', // JBDeadline1Day
  '0xcda708c98fbdd15a7ff7f0c5c50f9371ca52c78f', // JBDeadline3Days
  '0x540923f7b6166bf9713490719a2210aeebc9fca2', // JBDeadline7Days
])

const RECOGNIZED_NEW_PROJECT_DATA_HOOKS = new Set([
  JB_BUYBACK_HOOK.toLowerCase(),
  JB_BUYBACK_HOOK_REGISTRY.toLowerCase(),
  '0xf21b8717cb50e497e90f375ec532557dd9022655', // CTDeployer
])

const CT_DEPLOYER = '0xf21b8717cb50e497e90f375ec532557dd9022655' as Address

// Recognition, not targeting: every JBP6FeeLPSplitHook (JBUniswapV4LPSplitHook)
// deployment a live project may already have wired into its reserved splits.
// New splits target the current one only — see JBP6_FEE_LP_SPLIT_HOOK in
// create-flow/builders.ts.
const RECOGNIZED_SPLIT_HOOKS = new Set([
  '0xe9493bc776699714a89aa982cf828d843f040d2a', // JBP6FeeLPSplitHook (current — fixed instance)
  '0xfcdbabd7b8de07c6e4ca7d79790e235848edc251', // JBP6FeeLPSplitHook (impl / prior instance)
  '0xaf2d8a027955871cd2f3c4d2f32338e574e69bc0', // JBP6FeeLPSplitHook (deprecated2)
  '0x2f23b09975eb9305670b01e94c11e702792f25a3', // JBP6FeeLPSplitHook (deprecated)
  '0xae6705c33c8b46f56878a1d4f1ce4d75fcfb6f62', // BannyLPSplitHook (retired)
])

const PROJECTS_ABI = [{
  name: 'ownerOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'projectId', type: 'uint256' }],
  outputs: [{ name: '', type: 'address' }],
}] as const

const REV_OWNER_ABI = [{
  name: 'deployer',
  type: 'function',
  stateMutability: 'view',
  inputs: [],
  outputs: [{ name: '', type: 'address' }],
}] as const

const OMNICHAIN_DEPLOYER_ABI = [{
  name: 'extraDataHookOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [
    { name: 'projectId', type: 'uint256' },
    { name: 'rulesetId', type: 'uint256' },
  ],
  outputs: [{
    name: '',
    type: 'tuple',
    components: [
      { name: 'dataHook', type: 'address' },
      { name: 'useDataHookForPay', type: 'bool' },
      { name: 'useDataHookForCashOut', type: 'bool' },
    ],
  }],
}] as const

const OMNICHAIN_TIERED_HOOK_ABI = [{
  name: 'tiered721HookOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [
    { name: 'projectId', type: 'uint256' },
    { name: 'rulesetId', type: 'uint256' },
  ],
  outputs: [
    { name: 'hook', type: 'address' },
    { name: 'useDataHookForCashOut', type: 'bool' },
  ],
}] as const

const CT_DEPLOYER_ABI = [{
  name: 'dataHookOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'projectId', type: 'uint256' }],
  outputs: [{ name: '', type: 'address' }],
}] as const

const BUYBACK_REGISTRY_ABI = [{
  name: 'hookOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'projectId', type: 'uint256' }],
  outputs: [{ name: '', type: 'address' }],
}] as const

function isZero(address: string | undefined): boolean {
  return !address || address.toLowerCase() === zeroAddress
}

export function requireRecognizedApprovalHook(address: string): void {
  if (isZero(address)) return
  if (!RECOGNIZED_APPROVAL_HOOKS.has(address.toLowerCase())) {
    throw new Error(`Rule-change hook not recognized: ${address}`)
  }
}

export function requireRecognizedSplitHook(address: string): void {
  if (isZero(address)) return
  if (!RECOGNIZED_SPLIT_HOOKS.has(address.toLowerCase())) {
    throw new Error(`Split hook not recognized: ${address}`)
  }
}

export async function requireRecognizedRuntimeSplitHook(
  client: Pick<PublicClient, 'readContract'>,
  address: Address,
): Promise<void> {
  if (isZero(address) || RECOGNIZED_SPLIT_HOOKS.has(address.toLowerCase())) return
  await requireRecognizedLpSplitHookClone(client, address)
}

export function requireRecognizedNewProjectDataHook(address: string): void {
  if (isZero(address)) return
  const normalized = address.toLowerCase()
  if (
    RECOGNIZED_NEW_PROJECT_DATA_HOOKS.has(normalized) ||
    normalized === REV_OWNER.toLowerCase() ||
    normalized === JB_OMNICHAIN_DEPLOYER.toLowerCase()
  ) return
  throw new Error(`Data hook not recognized: ${address}`)
}

async function requireRecognizedDataHook(
  client: Pick<PublicClient, 'readContract'>,
  projectId: bigint,
  rulesetId: bigint,
  address: Address,
  depth = 0,
): Promise<void> {
  if (isZero(address)) return
  const normalized = address.toLowerCase()
  if (normalized === JB_BUYBACK_HOOK.toLowerCase()) return

  if (normalized === JB_BUYBACK_HOOK_REGISTRY.toLowerCase()) {
    const resolvedHook = await client.readContract({
      address,
      abi: BUYBACK_REGISTRY_ABI,
      functionName: 'hookOf',
      args: [projectId],
    })
    if (resolvedHook.toLowerCase() !== JB_BUYBACK_HOOK.toLowerCase()) {
      throw new Error(`Buyback hook not recognized: ${resolvedHook}`)
    }
    return
  }

  if (normalized === CT_DEPLOYER.toLowerCase()) {
    const resolvedHook = await client.readContract({
      address,
      abi: CT_DEPLOYER_ABI,
      functionName: 'dataHookOf',
      args: [projectId],
    })
    if (isZero(resolvedHook)) throw new Error('Croptop data hook configuration is incomplete')
    await requireRecognized721Hook(client, resolvedHook, projectId)
    return
  }

  if (normalized === REV_OWNER.toLowerCase()) {
    const [owner, deployer] = await Promise.all([
      client.readContract({
        address: JB_CONTRACTS.JBProjects,
        abi: PROJECTS_ABI,
        functionName: 'ownerOf',
        args: [projectId],
      }),
      client.readContract({
        address,
        abi: REV_OWNER_ABI,
        functionName: 'deployer',
      }),
    ])
    if (owner.toLowerCase() !== normalized || deployer.toLowerCase() !== REV_DEPLOYER.toLowerCase()) {
      throw new Error(`Data hook not recognized: ${address}`)
    }
    return
  }

  if (normalized === JB_OMNICHAIN_DEPLOYER.toLowerCase()) {
    if (depth > 0) throw new Error(`Data hook not recognized: ${address}`)
    const extra = await client.readContract({
      address,
      abi: OMNICHAIN_DEPLOYER_ABI,
      functionName: 'extraDataHookOf',
      args: [projectId, rulesetId],
    })
    const usesExtra = extra.useDataHookForPay || extra.useDataHookForCashOut
    if (!usesExtra && isZero(extra.dataHook)) return
    if (isZero(extra.dataHook)) {
      throw new Error('Omnichain data hook configuration is incomplete')
    }
    await requireRecognizedDataHook(client, projectId, rulesetId, extra.dataHook, depth + 1)
    return
  }

  try {
    await requireRecognized721Hook(client, address, projectId)
  } catch {
    throw new Error(`Data hook not recognized: ${address}`)
  }
}

export async function requireRecognizedRuntimeHook(params: {
  client: Pick<PublicClient, 'readContract'>
  projectId: bigint
  rulesetId: bigint
  hook: Address
}): Promise<void> {
  await requireRecognizedDataHook(
    params.client,
    params.projectId,
    params.rulesetId,
    params.hook,
  )
}

async function assertCurrentProjectRuntimeConfigurationTrusted(params: {
  client: Pick<PublicClient, 'readContract'>
  projectId: bigint
  operation: 'pay' | 'cashOut'
}): Promise<bigint> {
  const controller = await getProjectController(params.client, params.projectId)
  const result = await params.client.readContract({
    address: controller,
    abi: JB_CONTROLLER_ABI,
    functionName: 'currentRulesetOf',
    args: [params.projectId],
  })
  const ruleset = result[0]
  const rulesetId = BigInt(ruleset.id)
  const metadata = result[1]
  if (rulesetId === 0n) throw new Error('Current project rules are unavailable')
  if (params.operation === 'pay' && metadata.pausePay) {
    throw new Error('Payments are paused by the current project rules')
  }
  if (params.operation === 'cashOut' && Number(metadata.cashOutTaxRate) >= 10_000) {
    throw new Error('Cash outs are disabled by the current project rules')
  }
  const usesHook = params.operation === 'pay'
    ? metadata.useDataHookForPay
    : metadata.useDataHookForCashOut
  if (usesHook) {
    if (isZero(metadata.dataHook)) {
      throw new Error(`Project ${params.operation} hook configuration is incomplete`)
    }
    await requireRecognizedDataHook(
      params.client,
      params.projectId,
      rulesetId,
      metadata.dataHook,
    )
  }
  return rulesetId
}

export async function assertCurrentProjectPayConfigurationTrusted(params: {
  client: Pick<PublicClient, 'readContract'>
  projectId: bigint
}): Promise<bigint> {
  return assertCurrentProjectRuntimeConfigurationTrusted({ ...params, operation: 'pay' })
}

export async function assertCurrentProjectCashOutConfigurationTrusted(params: {
  client: Pick<PublicClient, 'readContract'>
  projectId: bigint
}): Promise<bigint> {
  return assertCurrentProjectRuntimeConfigurationTrusted({ ...params, operation: 'cashOut' })
}

export async function assertCurrentRulesetId(params: {
  client: Pick<PublicClient, 'readContract'>
  projectId: bigint
  expectedRulesetId: bigint
}): Promise<void> {
  const controller = await getProjectController(params.client, params.projectId)
  const [ruleset] = await params.client.readContract({
    address: controller,
    abi: JB_CONTROLLER_ABI,
    functionName: 'currentRulesetOf',
    args: [params.projectId],
  })
  if (BigInt(ruleset.id) !== params.expectedRulesetId) {
    throw new Error('The project rules changed. Close this review and load the latest configuration.')
  }
}

interface RulesetQueueRoute {
  target: Address
  dataHook: Address
  useDataHookForPay: boolean
  useDataHookForCashOut: boolean
  currentRulesetId: bigint
}

export async function resolveRulesetQueueRoute(params: {
  client: Pick<PublicClient, 'readContract'>
  projectId: bigint
  expectedRulesetId?: bigint
}): Promise<RulesetQueueRoute> {
  const controller = await getProjectController(params.client, params.projectId)
  const [ruleset, metadata] = await params.client.readContract({
    address: controller,
    abi: JB_CONTROLLER_ABI,
    functionName: 'currentRulesetOf',
    args: [params.projectId],
  })
  const currentRulesetId = BigInt(ruleset.id)
  if (currentRulesetId === 0n) throw new Error('Current ruleset unavailable')
  if (params.expectedRulesetId !== undefined && currentRulesetId !== params.expectedRulesetId) {
    throw new Error('The project rules changed. Close this review and load the latest configuration.')
  }

  const currentHook = metadata.dataHook as Address
  if (currentHook.toLowerCase() === REV_OWNER.toLowerCase()) {
    throw new Error('Revnet rules cannot be changed through this ruleset editor')
  }

  if (currentHook.toLowerCase() === JB_OMNICHAIN_DEPLOYER.toLowerCase()) {
    if (!metadata.useDataHookForPay || !metadata.useDataHookForCashOut) {
      throw new Error('Omnichain hook configuration is incomplete')
    }
    await requireRecognizedDataHook(
      params.client,
      params.projectId,
      currentRulesetId,
      currentHook,
    )
    const [extra, tiered] = await Promise.all([
      params.client.readContract({
        address: JB_OMNICHAIN_DEPLOYER,
        abi: OMNICHAIN_DEPLOYER_ABI,
        functionName: 'extraDataHookOf',
        args: [params.projectId, currentRulesetId],
      }),
      params.client.readContract({
        address: JB_OMNICHAIN_DEPLOYER,
        abi: OMNICHAIN_TIERED_HOOK_ABI,
        functionName: 'tiered721HookOf',
        args: [params.projectId, currentRulesetId],
      }),
    ])
    if (isZero(tiered[0])) throw new Error('Omnichain 721 hook configuration is incomplete')
    await requireRecognized721Hook(params.client, tiered[0], params.projectId)
    if (!isZero(extra.dataHook)) {
      await requireRecognizedDataHook(
        params.client,
        params.projectId,
        currentRulesetId,
        extra.dataHook,
        1,
      )
    } else if (extra.useDataHookForPay || extra.useDataHookForCashOut) {
      throw new Error('Omnichain extra hook configuration is incomplete')
    }
    return {
      target: JB_OMNICHAIN_DEPLOYER as Address,
      dataHook: extra.dataHook,
      useDataHookForPay: extra.useDataHookForPay,
      useDataHookForCashOut: extra.useDataHookForCashOut,
      currentRulesetId,
    }
  }

  if ((metadata.useDataHookForPay || metadata.useDataHookForCashOut) && isZero(currentHook)) {
    throw new Error('Project data hook configuration is incomplete')
  }
  await requireRecognizedDataHook(
    params.client,
    params.projectId,
    currentRulesetId,
    currentHook,
  )
  return {
    target: controller,
    dataHook: currentHook,
    useDataHookForPay: metadata.useDataHookForPay,
    useDataHookForCashOut: metadata.useDataHookForCashOut,
    currentRulesetId,
  }
}

export async function assertRulesetConfigurationTrusted(params: {
  client: Pick<PublicClient, 'readContract'>
  projectId: bigint
  rulesetId: bigint
  approvalHook: string
  dataHook: string
  splitGroups: Array<{ splits: Array<{ hook: string }> }>
}): Promise<void> {
  requireRecognizedApprovalHook(params.approvalHook)
  await requireRecognizedDataHook(
    params.client,
    params.projectId,
    params.rulesetId,
    params.dataHook as Address,
  )
  for (const group of params.splitGroups) {
    for (const split of group.splits) {
      await requireRecognizedRuntimeSplitHook(params.client, split.hook as Address)
    }
  }
}
