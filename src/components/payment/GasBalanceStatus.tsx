import { formatEthBalance } from '../../hooks'
import { Skeleton } from '../ui/Skeleton'

export function GasBalanceStatus({
  balance,
  hasGasBalance,
  loading,
  available,
  managed,
  isDark,
}: {
  balance: bigint
  hasGasBalance: boolean
  loading: boolean
  available: boolean
  managed: boolean
  isDark: boolean
}) {
  const unavailable = !managed && !loading && !available
  const insufficient = !managed && !loading && available && !hasGasBalance
  const value = managed
    ? 'Managed wallet'
    : unavailable
      ? 'Unavailable'
      : `${formatEthBalance(balance)} ETH`

  return (
    <>
      <div className={`flex items-center justify-between text-sm ${
        isDark ? 'text-gray-400' : 'text-gray-500'
      }`}>
        <span>Your ETH balance (for gas)</span>
        {loading && !managed ? (
          <Skeleton className="h-4 w-24" role="status" aria-label="Loading gas balance" />
        ) : (
          <span className={`font-mono ${unavailable || insufficient ? 'text-red-400' : ''}`}>
            {value}
          </span>
        )}
      </div>

      {(unavailable || insufficient) && (
        <div className={`p-3 text-sm ${
          isDark ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-600'
        }`}>
          {unavailable
            ? 'ETH balance could not be verified. Transaction blocked.'
            : 'Insufficient ETH for gas fees'}
        </div>
      )}
    </>
  )
}
