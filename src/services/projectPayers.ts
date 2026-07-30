/**
 * Project payer addresses — the deployed forwarding contracts that let anyone
 * pay a project by plain native-token transfer.
 *
 * Port of website/src/project-payer.js (deploy calldata boundary) plus the
 * discover.js projectPayers Bendystraw listing. Calldata construction stays
 * isolated from the UI so the exact ABI, validation, and target address are
 * auditable without following component state.
 */

import { JB_CHAINS, type JBChainId } from '@bananapus/nana-sdk-core'
import {
  JB_PROJECT_PAYER_DEPLOYER as SDK_PROJECT_PAYER_DEPLOYER,
  buildDeployProjectPayerTx,
  normalizeProjectPayerMetadata,
} from '@bananapus/nana-sdk-core/v6'
import { encodeFunctionData, isAddress } from 'viem'
import { getNetworkOption, safeRequest } from './bendystraw/client'

/**
 * JBProjectPayerDeployer — singleton, same address on all 8 supported chains.
 * Verified against website/data/manifest.json AND
 * deploy-all-v6/deployments/{ethereum,optimism,base,arbitrum,+sepolias}/JBProjectPayerDeployer.json.
 */
export const JB_PROJECT_PAYER_DEPLOYER = SDK_PROJECT_PAYER_DEPLOYER

/** The JBProjectPayerDeployer address on a chain, or null when it isn't deployed there. */
export function getProjectPayerDeployer(chainId: number): `0x${string}` | null {
  return JB_CHAINS[chainId as JBChainId] ? JB_PROJECT_PAYER_DEPLOYER : null
}

// ---------------------------------------------------------------------------
// Bendystraw listing
// ---------------------------------------------------------------------------

export interface ProjectPayerRow {
  chainId: number
  projectId: number
  version: number
  address: string
  defaultAddToBalance: boolean
  defaultBeneficiary: string
  paymentsCount: number
  addToBalanceCount: number
  /** Raw aggregate of payment-token base units — different decimals can mix, so only display the USD value. */
  totalFacilitated: string
  /** USD aggregate scaled by 1e18. */
  totalFacilitatedUsd: string
  lastUsedAt: number | null
  createdAt: number | null
}

export const PROJECT_PAYERS_QUERY = `
  query ProjectPayers($projectId: Int!, $chainId: Int!, $version: Int!, $limit: Int!, $offset: Int!) {
    projectPayers(
      where: { projectId: $projectId, chainId: $chainId, version: $version }
      orderBy: "totalFacilitatedUsd"
      orderDirection: "desc"
      limit: $limit
      offset: $offset
    ) {
      items {
        chainId
        projectId
        version
        address
        defaultAddToBalance
        defaultBeneficiary
        paymentsCount
        addToBalanceCount
        totalFacilitated
        totalFacilitatedUsd
        lastUsedAt
        createdAt
      }
      totalCount
    }
  }
`

interface ProjectPayersResponse {
  projectPayers: { items: ProjectPayerRow[]; totalCount: number }
}

const PAGE_SIZE = 100

/** Every indexed payer address for a project across its chains (V6 only). */
export async function fetchProjectPayers(
  chainProjects: ReadonlyArray<{ chainId: number; projectId: number }>,
): Promise<ProjectPayerRow[]> {
  const unique = new Map<string, { chainId: number; projectId: number }>()
  for (const ref of chainProjects) {
    if (!Number.isSafeInteger(ref.chainId) || ref.chainId < 1) throw new Error('Invalid chain ID')
    if (!Number.isSafeInteger(ref.projectId) || ref.projectId < 1) throw new Error('Invalid project ID')
    unique.set(`${ref.chainId}:${ref.projectId}`, ref)
  }

  const pages = await Promise.all([...unique.values()].map(async ref => {
    const rows: ProjectPayerRow[] = []
    let expectedTotal: number | null = null
    while (expectedTotal === null || rows.length < expectedTotal) {
      const data = await safeRequest<ProjectPayersResponse>(PROJECT_PAYERS_QUERY, {
        projectId: ref.projectId,
        chainId: ref.chainId,
        version: 6,
        limit: PAGE_SIZE,
        offset: rows.length,
      }, getNetworkOption(ref.chainId))
      const result = data.projectPayers
      if (!result || !Array.isArray(result.items) || !Number.isSafeInteger(result.totalCount) || result.totalCount < 0) {
        throw new Error('Indexed project payer data is incomplete')
      }
      if (expectedTotal !== null && result.totalCount !== expectedTotal) {
        throw new Error('Indexed project payer data changed while loading')
      }
      expectedTotal = result.totalCount
      if (!result.items.length && rows.length < expectedTotal) {
        throw new Error('Indexed project payer data ended before its reported total')
      }
      for (const row of result.items) {
        if (row.chainId !== ref.chainId || row.projectId !== ref.projectId || row.version !== 6) {
          throw new Error('Bendystraw returned a project payer for the wrong deployment')
        }
        rows.push(row)
      }
    }
    return rows
  }))
  return pages.flat().sort((a, b) => {
    const left = BigInt(a.totalFacilitatedUsd)
    const right = BigInt(b.totalFacilitatedUsd)
    return left === right ? 0 : right > left ? 1 : -1
  })
}

// ---------------------------------------------------------------------------
// Deploy calldata
// ---------------------------------------------------------------------------

function validAddress(value: string): value is `0x${string}` {
  return typeof value === 'string' && isAddress(value, { strict: false })
}

export { normalizeProjectPayerMetadata }

export interface ProjectPayerDeployParams {
  chainId: number
  projectId: number
  /** Token beneficiary; zero address mints to the original payer. */
  beneficiary: string
  memo: string
  /** Hex bytes forwarded to pay/addToBalance ('0x' for none). */
  metadata: string
  /** true = addToBalance (no tokens minted), false = pay. */
  addToBalance: boolean
  /** Payer-address admin; zero address makes the payer immutable. */
  owner: string
}

export interface ProjectPayerDeployCall {
  chainId: number
  to: `0x${string}`
  data: `0x${string}`
  review?: Pick<
    ReturnType<typeof buildDeployProjectPayerTx>,
    'abi' | 'functionName' | 'args'
  >
}

/** Encode a JBProjectPayerDeployer.deployProjectPayer call for the guarded runner. */
export function buildProjectPayerDeployCall(params: ProjectPayerDeployParams): ProjectPayerDeployCall {
  const { chainId, projectId, beneficiary, memo, metadata, addToBalance, owner } = params
  if (!Number.isSafeInteger(projectId) || projectId < 1) throw new Error('Enter a project ID')
  if (!validAddress(beneficiary)) throw new Error('Enter a default beneficiary address')
  if (!validAddress(owner)) throw new Error('Enter the payer admin address')
  if (!getProjectPayerDeployer(chainId)) {
    throw new Error(`JBProjectPayerDeployer is not deployed on chain ${chainId}`)
  }
  const request = buildDeployProjectPayerTx({
    chainId: chainId as JBChainId,
    projectId: BigInt(projectId),
    beneficiary,
    memo: String(memo || ''),
    metadata,
    addToBalance: !!addToBalance,
    owner,
  })
  const data = encodeFunctionData({
    abi: request.abi,
    functionName: request.functionName,
    args: request.args,
  })
  return {
    chainId: Number(chainId),
    to: request.address,
    data,
    review: {
      abi: request.abi,
      functionName: request.functionName,
      args: request.args,
    },
  }
}
