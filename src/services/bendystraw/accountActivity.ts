/**
 * Account-activity beneficiary merge.
 *
 * The top-level activityEvents filter has NO beneficiary field (verified
 * against the live schema), so events where the account only receives value —
 * payments to them, mints, automints — are fetched from the beneficiary-bearing
 * event roots and merged with the from-branch client-side. Rows present in
 * both branches (the account both sent and received) are deduped by sub-event
 * id; the merged feed sorts newest first.
 */

/** One beneficiary-root row: a bare sub-event row plus its chain + project. */
interface AccountActivitySubEventRow {
  id: string
  chainId: number
  timestamp: number
  txHash: string
  from?: string
  beneficiary?: string
  project?: unknown
  [key: string]: unknown
}

/** A from-branch activityEvents row (sub-event payloads keyed by kind). */
export interface AccountActivityRawRow {
  id: string
  chainId: number
  timestamp: number
  from?: string
  txHash?: string
  project?: unknown
  [key: string]: unknown
}

interface AccountActivityQueryRoot<T> {
  items?: T[]
  totalCount?: number
}

export interface AccountActivityQueryData {
  activityEvents?: AccountActivityQueryRoot<AccountActivityRawRow>
  beneficiaryPayEvents?: AccountActivityQueryRoot<AccountActivitySubEventRow>
  beneficiaryCashOutEvents?: AccountActivityQueryRoot<AccountActivitySubEventRow>
  beneficiaryMintTokensEvents?: AccountActivityQueryRoot<AccountActivitySubEventRow>
  beneficiaryManualMintTokensEvents?: AccountActivityQueryRoot<AccountActivitySubEventRow>
  beneficiaryAutoIssueEvents?: AccountActivityQueryRoot<AccountActivitySubEventRow>
}

/** root field → the sub-event key its rows land under on a merged activity row.
 *  Manual mints and automints reuse the mint sub-event shape (their root
 *  selections alias their count fields to `tokenCount`). */
const BENEFICIARY_ROOTS = [
  ['beneficiaryPayEvents', 'payEvent'],
  ['beneficiaryCashOutEvents', 'cashOutTokensEvent'],
  ['beneficiaryMintTokensEvents', 'mintTokensEvent'],
  ['beneficiaryManualMintTokensEvents', 'mintTokensEvent'],
  ['beneficiaryAutoIssueEvents', 'mintTokensEvent'],
] as const

/** The from-branch sub-event keys that can also appear under a beneficiary root. */
const DEDUPE_KEYS = ['payEvent', 'cashOutTokensEvent', 'mintTokensEvent', 'manualMintTokensEvent', 'autoIssueEvent'] as const

/** Dedupe namespace for a root: manual mints and automints keep their own
 *  from-branch key even though they render through the mint shape. */
const DEDUPE_KEY_BY_ROOT: Record<(typeof BENEFICIARY_ROOTS)[number][0], (typeof DEDUPE_KEYS)[number]> = {
  beneficiaryPayEvents: 'payEvent',
  beneficiaryCashOutEvents: 'cashOutTokensEvent',
  beneficiaryMintTokensEvents: 'mintTokensEvent',
  beneficiaryManualMintTokensEvents: 'manualMintTokensEvent',
  beneficiaryAutoIssueEvents: 'autoIssueEvent',
}

export function mergeAccountActivityEvents(data: AccountActivityQueryData): AccountActivityRawRow[] {
  const fromRows = data.activityEvents?.items ?? []

  const seen = new Set<string>()
  for (const row of fromRows) {
    for (const key of DEDUPE_KEYS) {
      const sub = row[key] as { id?: string } | null | undefined
      if (sub?.id) seen.add(`${key}:${sub.id}`)
    }
  }

  const merged: AccountActivityRawRow[] = [...fromRows]
  for (const [root, subKey] of BENEFICIARY_ROOTS) {
    const dedupeKey = DEDUPE_KEY_BY_ROOT[root]
    for (const row of data[root]?.items ?? []) {
      if (!row?.id) continue
      const dedupeId = `${dedupeKey}:${row.id}`
      if (seen.has(dedupeId)) continue
      seen.add(dedupeId)
      const { chainId, timestamp, project, ...sub } = row
      merged.push({
        id: row.id,
        chainId,
        timestamp,
        txHash: row.txHash,
        from: row.from,
        project: project ?? null,
        [subKey]: sub,
      })
    }
  }

  return merged.sort((a, b) => b.timestamp - a.timestamp)
}
