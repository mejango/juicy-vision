import {
  currencyLabel,
  formatFundAccessAmount,
  parseFundAccessAmount,
  rawFraction,
  type FundAccessAmountSnapshot,
  type FundAccessContextSnapshot,
  type FundAccessKind,
} from '../../services/fundAccess'

interface FundAccessAmountInputProps {
  kind: FundAccessKind
  context: FundAccessContextSnapshot
  access: FundAccessAmountSnapshot
  amount: string
  onAmountChange: (amount: string) => void
  onSubmit: () => void
  disabled?: boolean
  submitLabel: string
  isDark: boolean
}

export function FundAccessAmountInput({
  kind,
  context,
  access,
  amount,
  onAmountChange,
  onSubmit,
  disabled = false,
  submitLabel,
  isDark,
}: FundAccessAmountInputProps) {
  const parsed = parseFundAccessAmount(amount, context.decimals)
  const invalid = disabled || parsed === null || parsed > access.available
  const unit = currencyLabel(access.currency, context)

  return (
    <div data-testid={`fund-access-${kind}-controls`} className={`w-full min-w-0 p-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
      <label htmlFor={`${kind}-fund-access-amount`} className={`mb-2 block text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
        {kind === 'payout' ? 'Amount to distribute' : 'Amount to withdraw'}
      </label>
      <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className={`flex min-w-0 items-stretch overflow-hidden border ${isDark ? 'border-white/10 bg-juice-dark' : 'border-gray-200 bg-white'}`}>
          <input
            id={`${kind}-fund-access-amount`}
            aria-label={kind === 'payout' ? 'Payout amount' : 'Surplus allowance amount'}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={event => onAmountChange(event.target.value)}
            placeholder="0"
            disabled={disabled || access.available <= 0n}
            className={`min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none ${isDark ? 'text-white placeholder-gray-500' : 'text-gray-900 placeholder-gray-400'}`}
          />
          <span className={`flex max-w-[42%] items-center break-all border-l px-2 text-right text-xs ${isDark ? 'border-white/10 text-gray-400' : 'border-gray-200 text-gray-500'}`}>
            {unit}
          </span>
        </div>
        <button
          type="button"
          onClick={onSubmit}
          disabled={invalid}
          className={`min-h-10 w-full px-4 py-2 text-sm font-medium transition-colors sm:w-auto ${invalid
            ? 'cursor-not-allowed bg-gray-500/50 text-gray-400'
            : kind === 'payout'
              ? 'bg-juice-orange text-black hover:bg-juice-orange/90'
              : 'bg-purple-500 text-white hover:bg-purple-500/90'
          }`}
        >
          {submitLabel}
        </button>
      </div>
      {access.available > 0n && !disabled && (
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {[1n, 2n, 3n].map(numerator => {
            const raw = rawFraction(access.available, numerator, 4n)
            const value = formatFundAccessAmount(raw, context.decimals, context.decimals)
            return (
              <button
                key={numerator.toString()}
                type="button"
                onClick={() => onAmountChange(value)}
                disabled={raw === 0n}
                className={`min-w-0 overflow-hidden px-1 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${isDark ? 'bg-white/5 text-gray-400 hover:bg-white/10' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
              >
                {(numerator * 25n).toString()}%
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => onAmountChange(formatFundAccessAmount(access.available, context.decimals, context.decimals))}
            className={`min-w-0 overflow-hidden px-1 py-1 text-xs ${kind === 'payout'
              ? isDark ? 'bg-juice-orange/10 text-juice-orange' : 'bg-orange-50 text-orange-600'
              : isDark ? 'bg-purple-500/10 text-purple-400' : 'bg-purple-50 text-purple-600'
            }`}
          >
            Max
          </button>
        </div>
      )}
      {parsed !== null && parsed > access.available && (
        <p className="mt-2 break-words text-xs text-red-500">Amount exceeds the live available balance.</p>
      )}
    </div>
  )
}
