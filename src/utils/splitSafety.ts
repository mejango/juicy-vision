import { isAddress, zeroAddress } from 'viem'

const DEAD_ADDRESS = '0x000000000000000000000000000000000000dead'
const SPLITS_TOTAL_PERCENT = 1_000_000_000
const MAX_LOCKED_UNTIL = 2 ** 48 - 1
const MAX_PROJECT_ID = (1n << 64n) - 1n

type SplitKind = 'payout' | 'reserved'

export interface SplitInput {
  percent: string
  beneficiary: string
  projectId: string
  preferAddToBalance: boolean
  lockedUntil: number
  hook: string
  /** Existing hooks may be carried forward only after live provenance checks. */
  isNew?: boolean
}

interface BuildSplitOptions {
  kind: SplitKind
  sourceProjectId: string | number | bigint
}

function toContractPercent(percent: string, field: string): number {
  const trimmed = percent.trim()
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
    throw new Error(`${field} must be a valid percentage`)
  }
  const [wholeText, rawFraction = ''] = trimmed.split('.')
  const fraction = rawFraction.replace(/0+$/, '')
  if (fraction.length > 7) {
    throw new Error(`${field} has more precision than the contract supports`)
  }
  const encoded = BigInt(wholeText) * 10_000_000n + BigInt((fraction || '0').padEnd(7, '0'))
  if (encoded <= 0n || encoded > BigInt(SPLITS_TOTAL_PERCENT)) {
    throw new Error(`${field} must be greater than 0% and no greater than 100%`)
  }
  return Number(encoded)
}

function parseProjectId(value: string, field: string): bigint {
  if (value.trim() === '') return 0n
  if (!/^\d+$/.test(value.trim())) throw new Error(`${field} has an invalid project ID`)
  const projectId = BigInt(value)
  if (projectId <= 0n || projectId > MAX_PROJECT_ID) {
    throw new Error(`${field} has an invalid project ID`)
  }
  return projectId
}

function parseBeneficiary(value: string, field: string): `0x${string}` {
  if (value.trim() === '') return zeroAddress
  if (!isAddress(value)) throw new Error(`${field} needs a valid beneficiary address`)
  return value as `0x${string}`
}

export function buildSplit(split: SplitInput, field: string, options: BuildSplitOptions) {
  const projectId = parseProjectId(split.projectId, field)
  const sourceProjectId = BigInt(options.sourceProjectId)
  const beneficiary = parseBeneficiary(split.beneficiary, field)
  const normalizedBeneficiary = beneficiary.toLowerCase()
  const isMissingBeneficiary = normalizedBeneficiary === zeroAddress || normalizedBeneficiary === DEAD_ADDRESS

  if (!isAddress(split.hook)) throw new Error(`${field} has an invalid split hook`)
  if (split.hook.toLowerCase() !== zeroAddress && split.isNew !== false) {
    throw new Error(`${field} cannot introduce a new split hook in this flow`)
  }
  if (!Number.isSafeInteger(split.lockedUntil) || split.lockedUntil < 0 || split.lockedUntil > MAX_LOCKED_UNTIL) {
    throw new Error(`${field} has an invalid lock time`)
  }

  if (projectId === 0n) {
    if (isMissingBeneficiary) throw new Error(`${field} needs an explicit non-burn wallet recipient`)
    if (split.preferAddToBalance) throw new Error(`${field} has an irrelevant add-to-balance preference`)
  } else {
    if (projectId === sourceProjectId) throw new Error(`${field} cannot route back to its source project`)
    const isExisting = split.isNew === false

    if (options.kind === 'reserved') {
      if (split.preferAddToBalance) {
        throw new Error(`${field} has an irrelevant add-to-balance preference`)
      }
      if (isMissingBeneficiary && !isExisting) {
        throw new Error(`${field} needs an explicit fallback beneficiary`)
      }
    } else if (!split.preferAddToBalance && isMissingBeneficiary && !isExisting) {
      throw new Error(`${field} needs an explicit destination-token beneficiary`)
    } else if (split.preferAddToBalance && normalizedBeneficiary === DEAD_ADDRESS && !isExisting) {
      throw new Error(`${field} cannot use a burn beneficiary`)
    }
  }

  return {
    percent: toContractPercent(split.percent, `${field} percentage`),
    projectId,
    beneficiary,
    preferAddToBalance: projectId > 0n && options.kind === 'payout'
      ? split.preferAddToBalance
      : false,
    lockedUntil: split.lockedUntil,
    hook: split.hook as `0x${string}`,
  }
}

export function buildSplitGroup(
  splits: SplitInput[],
  field: string,
  options: BuildSplitOptions,
) {
  const built = splits.map((split, index) => buildSplit(split, `${field} recipient ${index + 1}`, options))
  const total = built.reduce((sum, split) => sum + split.percent, 0)
  if (total > SPLITS_TOTAL_PERCENT) throw new Error(`${field} recipients exceed 100%`)
  return built
}

interface StoredSplit {
  percent: number
  projectId: number
  beneficiary: string
  preferAddToBalance: boolean
  lockedUntil: number
  hook: string
}

/**
 * Validates already-live groups before a distribution or a preservation-only
 * edit. Clone provenance for nonzero hooks must be checked by the live reader.
 */
export function assertSafeStoredSplitGroups(
  groups: Array<{ groupId?: string | number; splits: StoredSplit[] }>,
  options: { kind?: SplitKind; sourceProjectId?: string | number | bigint } = {},
): void {
  groups.forEach((group, groupIndex) => {
    const kind = options.kind ?? (String(group.groupId) === '1' ? 'reserved' : 'payout')
    const sourceProjectId = options.sourceProjectId ?? 0n
    let total = 0

    group.splits.forEach((split, splitIndex) => {
      const field = `Split group ${groupIndex + 1} recipient ${splitIndex + 1}`
      if (!Number.isSafeInteger(split.percent) || split.percent <= 0 || split.percent > SPLITS_TOTAL_PERCENT) {
        throw new Error(`${field} has an invalid percentage`)
      }
      total += split.percent
      buildSplit({
        percent: `${Math.floor(split.percent / 10_000_000)}.${String(split.percent % 10_000_000).padStart(7, '0')}`,
        beneficiary: split.beneficiary,
        projectId: split.projectId === 0 ? '' : String(split.projectId),
        preferAddToBalance: split.preferAddToBalance,
        lockedUntil: split.lockedUntil,
        hook: split.hook,
        isNew: false,
      }, field, { kind, sourceProjectId })
    })

    if (total > SPLITS_TOTAL_PERCENT) throw new Error(`Split group ${groupIndex + 1} exceeds 100%`)
  })
}
