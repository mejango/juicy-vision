import type { ActivityEvent } from '../services/bendystraw/client'

export interface EventInfo {
  action: string
  amount?: string
  txHash: string
  from: string
  fromContext: string
}

// Format amount with proper decimals and currency
// decimals: 6 for USDC, 18 for ETH (default)
// currency: 1=ETH, 2=USD (USDC)
export function formatAmount(amount: string, decimals: number = 18, currency: number = 1): string {
  const divisor = Math.pow(10, decimals)
  const num = parseFloat(amount) / divisor

  // Format the number
  let formatted: string
  if (num < 0.0001) formatted = '<0.0001'
  else if (num < 0.01) formatted = num.toFixed(4)
  else if (num < 1) formatted = num.toFixed(3)
  else if (num < 1000) formatted = num.toFixed(2)
  else formatted = num.toLocaleString(undefined, { maximumFractionDigits: 2 })

  // Append currency symbol
  const symbol = currency === 2 ? 'USDC' : 'ETH'
  return `${formatted} ${symbol}`
}

// Format timestamp to relative time
export function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000 - timestamp)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
  return `${Math.floor(seconds / 604800)}w ago`
}

// Extract event info from activity event using discriminated union
// Uses project.decimals and project.currency to format amounts correctly
export function getEventInfo(event: ActivityEvent): EventInfo {
  // Get project's accounting info (defaults: 18 decimals, ETH currency)
  const decimals = event.project?.decimals ?? 18
  // IMPORTANT: If decimals is 6, it's definitely USDC regardless of what API says
  // This is because some API responses incorrectly report currency: 1 for USDC projects
  const currency = decimals === 6 ? 2 : (event.project?.currency ?? 1)

  // Debug: log project info for USDC detection issues
  if (event.type === 'pay' && event.project?.name) {
    console.log(`[Activity] ${event.project.name}: decimals=${event.project?.decimals}, currency=${event.project?.currency} -> using decimals=${decimals}, currency=${currency}`)
  }

  switch (event.type) {
    case 'pay':
      return {
        action: 'Paid',
        amount: formatAmount(event.amount, decimals, currency),
        txHash: event.txHash,
        from: event.from,
        fromContext: 'Paid by',
      }
    case 'projectCreate':
      return {
        action: 'Created',
        txHash: event.txHash,
        from: event.from,
        fromContext: 'Made by',
      }
    case 'cashOut':
      return {
        action: 'Cashed out',
        amount: formatAmount(event.reclaimAmount, decimals, currency),
        txHash: event.txHash,
        from: event.from,
        fromContext: 'Redeemed by',
      }
    case 'addToBalance':
      return {
        action: 'Added to balance',
        amount: formatAmount(event.amount, decimals, currency),
        txHash: event.txHash,
        from: event.from,
        fromContext: 'Added by',
      }
    case 'mintTokens':
      return {
        action: 'Minted',
        // Token amounts always use 18 decimals, show as "tokens" not currency
        amount: formatTokenAmount(event.tokenCount),
        txHash: event.txHash,
        from: event.beneficiary || event.from,
        fromContext: 'Minted to',
      }
    case 'burn':
      return {
        action: 'Burned',
        // Token amounts always use 18 decimals, show as "tokens" not currency
        amount: formatTokenAmount(event.amount),
        txHash: event.txHash,
        from: event.from,
        fromContext: 'Burned by',
      }
    case 'deployErc20':
      return {
        action: `Deployed $${event.symbol}`,
        txHash: event.txHash,
        from: event.from,
        fromContext: 'Deployed by',
      }
    case 'sendPayouts':
      return {
        action: 'Sent payouts',
        amount: formatAmount(event.amount, decimals, currency),
        txHash: event.txHash,
        from: event.from,
        fromContext: 'Distributed by',
      }
    case 'sendReservedTokens':
      return {
        action: 'Distributed reserved tokens',
        txHash: event.txHash,
        from: event.from,
        fromContext: 'Distributed by',
      }
    case 'useAllowance':
      return {
        action: 'Used allowance',
        amount: formatAmount(event.amount, decimals, currency),
        txHash: event.txHash,
        from: event.from,
        fromContext: 'Used by',
      }
    case 'mintNft':
      return {
        action: 'Minted NFT',
        txHash: event.txHash,
        from: event.from,
        fromContext: 'Minted by',
      }
    case 'unknown':
    default:
      return {
        action: 'Transaction',
        txHash: event.txHash || '',
        from: event.from || '',
        fromContext: 'By',
      }
  }
}

// Format token amounts (always 18 decimals, shown as "tokens")
function formatTokenAmount(amount: string): string {
  const num = parseFloat(amount) / 1e18
  let formatted: string
  if (num < 0.01) formatted = num.toFixed(4)
  else if (num < 1000) formatted = num.toFixed(2)
  else formatted = num.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return `${formatted} tokens`
}
