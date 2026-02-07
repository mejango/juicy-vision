import { useMemo } from 'react'
import { useThemeStore } from '../../stores'
import { formatUnits } from 'viem'

interface ProjectSummaryProps {
  projectName: string
  balance: string // in project's native currency units
  volume: string // in project's native currency units
  paymentsCount: number
  createdAt?: number // Unix timestamp
  isRevnet?: boolean
  hasNftHook?: boolean
  connectedChainsCount?: number
  ethPrice?: number | null
  currency?: number // 1 = ETH, 2 = USD
  decimals?: number // 18 for ETH, 6 for USDC
}

function formatUsd(
  weiString: string,
  ethPrice: number | null,
  currency: number = 1,
  decimals: number = 18
): string {
  try {
    const wei = BigInt(weiString)
    const value = parseFloat(formatUnits(wei, decimals))

    // If already USD (currency=2), no conversion needed
    const usd = currency === 2 ? value : (ethPrice ? value * ethPrice : 0)

    if (usd === 0) return '$0'
    if (!ethPrice && currency !== 2) return '' // Can't convert ETH without price
    if (usd < 1) return '<$1'
    if (usd >= 1000000) return `$${(usd / 1000000).toFixed(1)}M`
    if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}K`
    return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  } catch {
    return ''
  }
}

function getProjectAge(createdAt: number): { days: number; label: string } {
  // createdAt is a Unix timestamp (seconds)
  const created = new Date(createdAt * 1000)
  const now = new Date()
  const days = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24))

  if (days < 1) return { days, label: 'today' }
  if (days === 1) return { days, label: 'yesterday' }
  if (days < 7) return { days, label: `${days} days ago` }
  if (days < 30) return { days, label: `${Math.floor(days / 7)} weeks ago` }
  if (days < 365) return { days, label: `${Math.floor(days / 30)} months ago` }
  return { days, label: `${Math.floor(days / 365)} years ago` }
}

export default function ProjectSummary({
  projectName,
  balance,
  volume,
  paymentsCount,
  createdAt,
  isRevnet,
  hasNftHook,
  connectedChainsCount,
  ethPrice,
  currency = 1,
  decimals = 18,
}: ProjectSummaryProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const summary = useMemo(() => {
    const balanceUsd = formatUsd(balance, ethPrice ?? null, currency, decimals)
    const volumeUsd = formatUsd(volume, ethPrice ?? null, currency, decimals)
    const age = createdAt ? getProjectAge(createdAt) : null

    const parts: string[] = []

    // Opening - what type of project
    if (isRevnet) {
      parts.push(`${projectName} is a revnet`)
    } else {
      parts.push(`${projectName} is a Juicebox project`)
    }

    // Age context
    if (age) {
      parts[0] += ` launched ${age.label}`
    }

    // Omnichain context
    if (connectedChainsCount && connectedChainsCount > 1) {
      parts.push(`operating across ${connectedChainsCount} chains`)
    }

    // Financial snapshot
    const balanceNum = parseFloat(formatUnits(BigInt(balance), decimals))
    const volumeNum = parseFloat(formatUnits(BigInt(volume), decimals))

    if (volumeNum > 0 || paymentsCount > 0) {
      let financialPart = ''

      if (volumeUsd && volumeNum > 0) {
        financialPart = `It has processed ${volumeUsd} in total volume`
        if (paymentsCount > 0) {
          financialPart += ` across ${paymentsCount.toLocaleString()} payment${paymentsCount === 1 ? '' : 's'}`
        }
      } else if (paymentsCount > 0) {
        financialPart = `It has received ${paymentsCount.toLocaleString()} payment${paymentsCount === 1 ? '' : 's'}`
      }

      if (financialPart) {
        parts.push(financialPart)
      }
    }

    // Current state
    if (balanceNum > 0 && balanceUsd) {
      parts.push(`currently holding ${balanceUsd} in its treasury`)
    } else if (balanceNum === 0 && volumeNum > 0) {
      parts.push(`with funds actively deployed`)
    }

    // Features
    const features: string[] = []
    if (hasNftHook) features.push('NFT rewards')
    if (features.length > 0) {
      parts.push(`featuring ${features.join(' and ')}`)
    }

    // Combine into sentences
    let result = parts[0]
    if (parts.length > 1) {
      result += ', ' + parts.slice(1, -1).join(', ')
      if (parts.length > 2) {
        result += ', and ' + parts[parts.length - 1]
      } else {
        result += ' and ' + parts[parts.length - 1]
      }
    }
    result += '.'

    // Add engagement call if early stage
    if (paymentsCount < 10 && age && age.days < 30) {
      result += ' Be an early supporter!'
    } else if (paymentsCount >= 100) {
      result += ' Join a growing community of supporters.'
    }

    return result
  }, [projectName, balance, volume, paymentsCount, createdAt, isRevnet, hasNftHook, connectedChainsCount, ethPrice, currency, decimals])

  return (
    <div className={`p-4 rounded-lg ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
      <p className={`text-sm font-medium mb-1 ${isDark ? 'text-juice-orange' : 'text-orange-600'}`}>
        Juicy Summary
      </p>
      <p className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
        {summary}
      </p>
    </div>
  )
}
