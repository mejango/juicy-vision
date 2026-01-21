import type { ActivityEvent } from '../services/bendystraw/client'

export interface EventInfo {
  action: string
  amount?: string
  txHash: string
  from: string
  fromContext: string
}

// Format large numbers for display
export function formatAmount(amount: string): string {
  const num = parseFloat(amount) / 1e18
  if (num < 0.0001) return '<0.0001'
  if (num < 0.01) return num.toFixed(4)
  if (num < 1) return num.toFixed(3)
  if (num < 1000) return num.toFixed(2)
  return num.toLocaleString(undefined, { maximumFractionDigits: 2 })
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
export function getEventInfo(event: ActivityEvent): EventInfo {
  switch (event.type) {
    case 'pay':
      return {
        action: 'Paid',
        amount: `${formatAmount(event.amount)} ETH`,
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
        amount: `${formatAmount(event.reclaimAmount)} ETH`,
        txHash: event.txHash,
        from: event.from,
        fromContext: 'Redeemed by',
      }
    case 'addToBalance':
      return {
        action: 'Added to balance',
        amount: `${formatAmount(event.amount)} ETH`,
        txHash: event.txHash,
        from: event.from,
        fromContext: 'Added by',
      }
    case 'mintTokens':
      return {
        action: 'Minted',
        amount: `${formatAmount(event.tokenCount)} tokens`,
        txHash: event.txHash,
        from: event.beneficiary || event.from,
        fromContext: 'Minted to',
      }
    case 'burn':
      return {
        action: 'Burned',
        amount: `${formatAmount(event.amount)} tokens`,
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
        amount: `${formatAmount(event.amount)} ETH`,
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
        amount: `${formatAmount(event.amount)} ETH`,
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
