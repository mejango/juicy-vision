/**
 * Friendly decoding for known custom-error selectors surfaced by wallet/RPC
 * failures. Matching runs against every string reachable from the error object
 * (viem nests the revert data under cause/details), so both raw 4-byte
 * selectors and decoded error names are recognized. The matched technical
 * token is kept in the result so diagnostics never lose the selector.
 */

import { classifyCashOutExecutionError } from '@bananapus/nana-sdk-core/v6'

interface KnownTransactionError {
  matchers: string[]
  message: string
}

const KNOWN_TRANSACTION_ERRORS: KnownTransactionError[] = [
  {
    matchers: ['0x30116425', 'deploymentfailed'],
    message: 'The contract deployment failed. If this collection or shop existed before, reuse the existing deployment instead of starting a new one.',
  },
  {
    matchers: ['0x76d03816', 'jbprices_pricefeednotfound'],
    message: "This payment token cannot be converted into the required pricing currency because no price feed is available. Choose a supported currency.",
  },
  {
    matchers: ['0xee890b46', 'jb721tiershookstore_priceexceedsamount'],
    message: 'The payment is worth less than the selected shop items. Increase the payment or remove items before trying again.',
  },
  {
    matchers: ['0x6b2bb382', 'jbmultiterminal_undermin'],
    message: 'The live return fell below the minimum you reviewed. Refresh the quote and try again.',
  },
  {
    matchers: ['0xd81b2f2e', 'allowanceexpired'],
    message: 'Token authorization expired. Review and try again to renew it before paying.',
  },
  {
    matchers: ['0x9fa59b9a', 'jbterminalstore_inadequateterminalstorebalance'],
    message: 'The terminal balance no longer covers this amount. Review the updated available amount and try again.',
  },
  {
    matchers: ['jbterminalstore_inadequatecontrollerallowance'],
    message: 'The selected surplus allowance changed or is depleted. Refresh the live configuration and try again.',
  },
]

export function collectErrorText(value: unknown, seen = new Set<unknown>(), depth = 0): string[] {
  if (depth > 8 || value === null || value === undefined || seen.has(value)) return []
  if (typeof value === 'string') return [value]
  if (typeof value !== 'object') return []
  seen.add(value)
  const record = value as Record<string, unknown>
  return [
    record.shortMessage,
    record.message,
    record.details,
    record.errorName,
    record.signature,
    record.raw,
    record.data,
    record.cause,
    record.error,
  ].flatMap(item => collectErrorText(item, seen, depth + 1))
}

/**
 * Returns a friendly message for a recognized custom error, suffixed with the
 * matched selector/name so the technical detail stays available, or null when
 * the error is not recognized.
 */
export function friendlyTransactionError(error: unknown): string | null {
  const cashOut = classifyCashOutExecutionError(error)
  if (cashOut?.code === 'BUYBACK_SLIPPAGE_EXCEEDED') {
    return `The buyback pool moved below your protected minimum. Refresh the quote or choose a larger max slippage, then try again. [${cashOut.selector}]`
  }
  if (cashOut?.code === 'TERMINAL_UNDER_MIN') {
    return `The live return fell below the minimum you reviewed. Refresh the quote and try again. [${cashOut.selector}]`
  }
  const normalized = collectErrorText(error).join(' | ').toLowerCase()
  if (!normalized) return null
  for (const known of KNOWN_TRANSACTION_ERRORS) {
    const matched = known.matchers.find(matcher => normalized.includes(matcher))
    if (matched) return `${known.message} [${matched}]`
  }
  return null
}

/** Friendly decode when recognized, otherwise the raw message, otherwise the fallback. */
export function txErrorMessage(error: unknown, fallback: string): string {
  return friendlyTransactionError(error) ?? (error instanceof Error ? error.message : fallback)
}
