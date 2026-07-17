/**
 * Project payer addresses — the deployed forwarding contracts that let anyone
 * pay a project by plain native-token transfer.
 *
 * Port of website/src/project-payer.js (deploy calldata boundary) plus the
 * discover.js projectPayers Bendystraw listing. Calldata construction stays
 * isolated from the UI so the exact ABI, validation, and target address are
 * auditable without following component state.
 */

import { encodeFunctionData, isAddress } from 'viem'
import { getNetworkOption, safeRequest } from './bendystraw/client'

/**
 * JBProjectPayerDeployer — singleton, same address on all 8 supported chains.
 * Verified against website/data/manifest.json AND
 * deploy-all-v6/deployments/{ethereum,optimism,base,arbitrum,+sepolias}/JBProjectPayerDeployer.json.
 */
export const JB_PROJECT_PAYER_DEPLOYER = '0x7321740fd0dcf73dd3e2aa8fc060454abfce9517' as `0x${string}`

export const PROJECT_PAYER_DEPLOY_ABI = [{
  type: 'function',
  name: 'deployProjectPayer',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'defaultProjectId', type: 'uint256' },
    { name: 'defaultBeneficiary', type: 'address' },
    { name: 'defaultMemo', type: 'string' },
    { name: 'defaultMetadata', type: 'bytes' },
    { name: 'defaultAddToBalance', type: 'bool' },
    { name: 'owner', type: 'address' },
  ],
  outputs: [{ name: 'projectPayer', type: 'address' }],
}] as const

// ---------------------------------------------------------------------------
// Bendystraw listing
// ---------------------------------------------------------------------------

export interface ProjectPayerRow {
  chainId: number
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
  query ProjectPayers($projectId: Int!, $version: Int!, $chainIds: [Int!], $limit: Int!, $offset: Int!) {
    projectPayers(
      where: { projectId: $projectId, version: $version, chainId_in: $chainIds }
      orderBy: "totalFacilitatedUsd"
      orderDirection: "desc"
      limit: $limit
      offset: $offset
    ) {
      items {
        chainId
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
const MAX_ROWS = 500

/** Every indexed payer address for a project across its chains (V6 only). */
export async function fetchProjectPayers(projectId: number, chainIds: number[]): Promise<ProjectPayerRow[]> {
  if (!Number.isSafeInteger(projectId) || projectId < 1) throw new Error('Invalid project ID')
  if (!chainIds.length) return []

  const rows: ProjectPayerRow[] = []
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const data = await safeRequest<ProjectPayersResponse>(PROJECT_PAYERS_QUERY, {
      projectId,
      version: 6,
      chainIds,
      limit: PAGE_SIZE,
      offset,
    }, getNetworkOption(chainIds[0]))
    const page = data.projectPayers?.items || []
    rows.push(...page)
    if (rows.length >= (data.projectPayers?.totalCount ?? 0) || page.length < PAGE_SIZE) break
  }
  return rows
}

// ---------------------------------------------------------------------------
// Deploy calldata
// ---------------------------------------------------------------------------

function validAddress(value: string): value is `0x${string}` {
  return typeof value === 'string' && isAddress(value, { strict: false })
}

/** Validate + normalize the optional hex metadata forwarded to pay/addToBalance. */
export function normalizeProjectPayerMetadata(metadata: string): `0x${string}` {
  const hex = String(metadata || '').trim() || '0x'
  if (!/^0x([0-9a-fA-F]{2})*$/.test(hex)) {
    throw new Error('Metadata must be hex bytes, e.g. 0x or 0x1234')
  }
  return hex as `0x${string}`
}

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
}

/** Encode a JBProjectPayerDeployer.deployProjectPayer call for the guarded runner. */
export function buildProjectPayerDeployCall(params: ProjectPayerDeployParams): ProjectPayerDeployCall {
  const { chainId, projectId, beneficiary, memo, metadata, addToBalance, owner } = params
  if (!Number.isSafeInteger(projectId) || projectId < 1) throw new Error('Enter a project ID')
  if (!validAddress(beneficiary)) throw new Error('Enter a default beneficiary address')
  if (!validAddress(owner)) throw new Error('Enter the payer admin address')
  const data = encodeFunctionData({
    abi: PROJECT_PAYER_DEPLOY_ABI,
    functionName: 'deployProjectPayer',
    args: [BigInt(projectId), beneficiary, String(memo || ''), normalizeProjectPayerMetadata(metadata), !!addToBalance, owner],
  })
  return { chainId: Number(chainId), to: JB_PROJECT_PAYER_DEPLOYER, data }
}
