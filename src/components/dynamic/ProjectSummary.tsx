import { useMemo } from 'react'
import { useThemeStore } from '../../stores'
import { resolveAccountingToken, formatBalanceUsd, formatBalanceNative, toTokenFloat } from '../../utils/currency'

interface ProjectSummaryProps {
  projectName: string
  balance: string // in project's native currency units
  volume: string // in project's native currency units
  /**
   * Bendystraw's time-of-payment USD volume (1e18-scaled raw string). When
   * present this prices the volume line — multiplying historical volume by
   * TODAY'S spot price misstates what was actually processed.
   */
  volumeUsd?: string
  paymentsCount: number
  balanceAvailable?: boolean
  volumeAvailable?: boolean
  paymentsAvailable?: boolean
  createdAt?: number // Unix timestamp
  isRevnet?: boolean
  hasNftHook?: boolean
  connectedChainsCount?: number
  ethPrice?: number | null
  currency?: number // 1 = native ETH, 2 = canonical USDC, otherwise token-derived
  decimals?: number // 18 for ETH, 6 for USDC
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
  volumeUsd,
  paymentsCount,
  balanceAvailable = true,
  volumeAvailable = true,
  paymentsAvailable = true,
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
    // Resolve the project's accounting token so any unit phrasing is correct
    // (a USDC project is 6 decimals and shown as "$", not "ETH").
    const token = resolveAccountingToken(currency, decimals)
    // USD phrasing works for USD-denominated projects always, and for ETH
    // projects only when we have a price. Otherwise fall back to native units.
    const usdReady = token.isUsd || !!ethPrice
    const fmtValue = (raw: string) =>
      usdReady
        ? formatBalanceUsd(raw, ethPrice ?? null, currency, decimals)
        : formatBalanceNative(raw, currency, decimals)

    const balanceStr = fmtValue(balance)
    // Volume prefers the indexer's time-of-payment USD total over converting
    // the native total at today's spot price. formatBalanceUsd with currency 2
    // renders an already-USD raw amount (1e18-scaled) without a price feed.
    const volumeUsdNum =
      volumeUsd && /^\d+$/.test(volumeUsd) ? toTokenFloat(volumeUsd, 18) : null
    const volumeStr =
      volumeUsdNum != null && volumeUsdNum > 0
        ? formatBalanceUsd(volumeUsd!, null, 2, 18)
        : fmtValue(volume)
    const balanceNum = toTokenFloat(balance, decimals)
    const volumeNum = toTokenFloat(volume, decimals)
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
      parts[0] += `, live across ${connectedChainsCount} chains`
    }

    // What a revnet is, in plain English
    if (isRevnet) {
      parts.push('where token issuance follows preset stages that decrease over time, so earlier supporters receive more for the same contribution')
      parts.push('with its rules locked in and enforced automatically')
    }

    // Financial snapshot
    if ((volumeAvailable && volumeNum > 0) || (paymentsAvailable && paymentsCount > 0)) {
      let financialPart = ''

      if (volumeAvailable && volumeStr && volumeNum > 0) {
        financialPart = `It has processed ${volumeStr} in total volume`
        if (paymentsAvailable && paymentsCount > 0) {
          financialPart += ` across ${paymentsCount.toLocaleString()} payment${paymentsCount === 1 ? '' : 's'}`
        }
      } else if (paymentsAvailable && paymentsCount > 0) {
        financialPart = `It has received ${paymentsCount.toLocaleString()} payment${paymentsCount === 1 ? '' : 's'}`
      }

      if (financialPart) {
        parts.push(financialPart)
      }
    }

    // Current state
    if (balanceAvailable && balanceNum > 0 && balanceStr) {
      parts.push(`currently holding ${balanceStr} in its treasury`)
    } else if (balanceAvailable && volumeAvailable && balanceNum === 0 && volumeNum > 0) {
      parts.push(`with funds actively deployed`)
    }

    // Features
    if (hasNftHook) {
      parts.push(`has got things for sale`)
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
    if (paymentsAvailable && paymentsCount < 10 && age && age.days < 30) {
      result += ' Be an early supporter!'
    } else if (paymentsAvailable && paymentsCount >= 100) {
      result += ' Join a growing community of supporters.'
    }

    return result
  }, [projectName, balance, volume, volumeUsd, paymentsCount, balanceAvailable, volumeAvailable, paymentsAvailable, createdAt, isRevnet, hasNftHook, connectedChainsCount, ethPrice, currency, decimals])

  return (
    <div className={`p-4 rounded-lg ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
      <p className={`text-sm font-medium mb-1 ${isDark ? 'text-juice-cyan' : 'text-cyan-600'}`}>
        Juicy Summary
      </p>
      <p className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
        {summary}
      </p>
    </div>
  )
}
