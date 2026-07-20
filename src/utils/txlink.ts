import type { Address, Hex } from 'viem'

export const TXLINK_BASE_URL = 'https://txlink.stupidtech.net/'

export interface TxLinkEntry {
  chainId: number
  to: Address
  data: Hex
  value: bigint
}

export interface TxLinkPayload {
  chainId: number | undefined
  to: string | undefined | null
  data: string | undefined | null
  value: bigint | string | undefined | null
  /** Optional ERC-20 approval sent before the main call. */
  approval?: { token: string | undefined | null; data: string | undefined | null } | null
}

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/
const HEX_DATA_PATTERN = /^0x(?:[0-9a-fA-F]{2})*$/

function validAddress(value: string | undefined | null): Address | null {
  return typeof value === 'string' && ADDRESS_PATTERN.test(value) ? value as Address : null
}

function validHexData(value: string | undefined | null): Hex | null {
  return typeof value === 'string' && HEX_DATA_PATTERN.test(value) ? value as Hex : null
}

function validValue(value: bigint | string | undefined | null): bigint | null {
  if (typeof value === 'bigint') return value >= 0n ? value : null
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = BigInt(value.trim())
    return parsed >= 0n ? parsed : null
  } catch {
    return null
  }
}

/** One txlink URL per JSON-RPC call; `from` is intentionally omitted so txlink fills it from the opener's wallet. */
export function buildTxLinkUrl(entry: TxLinkEntry): string {
  const params = JSON.stringify({
    to: entry.to,
    data: entry.data,
    value: `0x${entry.value.toString(16)}`,
  })
  return `${TXLINK_BASE_URL}?method=eth_sendTransaction&chainId=${entry.chainId}&params=${encodeURIComponent(params)}`
}

/** Approval entry first (when present), then the main call. Returns [] if anything is missing or invalid. */
export function buildTxLinkEntries(payload: TxLinkPayload): TxLinkEntry[] {
  const { chainId } = payload
  if (typeof chainId !== 'number' || !Number.isSafeInteger(chainId) || chainId <= 0) return []
  const to = validAddress(payload.to)
  const data = validHexData(payload.data)
  const value = validValue(payload.value)
  if (!to || !data || value === null) return []

  const entries: TxLinkEntry[] = []
  if (payload.approval) {
    const approvalTo = validAddress(payload.approval.token)
    const approvalData = validHexData(payload.approval.data)
    if (!approvalTo || !approvalData) return []
    entries.push({ chainId, to: approvalTo, data: approvalData, value: 0n })
  }
  entries.push({ chainId, to, data, value })
  return entries
}

export function parseTxLinkUrl(url: string): TxLinkEntry | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (`${parsed.origin}${parsed.pathname}` !== TXLINK_BASE_URL) return null
  if (parsed.searchParams.get('method') !== 'eth_sendTransaction') return null
  const chainIdRaw = parsed.searchParams.get('chainId')
  const paramsRaw = parsed.searchParams.get('params')
  if (!chainIdRaw || !/^\d+$/.test(chainIdRaw) || !paramsRaw) return null
  const chainId = Number(chainIdRaw)
  if (!Number.isSafeInteger(chainId) || chainId <= 0) return null

  let tx: unknown
  try {
    tx = JSON.parse(paramsRaw)
  } catch {
    return null
  }
  if (typeof tx !== 'object' || tx === null) return null
  const { to, data, value } = tx as Record<string, unknown>
  const validTo = validAddress(typeof to === 'string' ? to : null)
  const validData = validHexData(typeof data === 'string' ? data : null)
  if (!validTo || !validData) return null
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) return null
  return { chainId, to: validTo, data: validData, value: BigInt(value) }
}
