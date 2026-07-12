import { formatUnits } from 'viem'
import {
  currencyLabel,
  formatFundAccessAmount,
  type FundAccessAmountSnapshot,
  type FundAccessContextSnapshot,
  type FundAccessKind,
} from '../../services/fundAccess'

interface FundAccessSummaryProps {
  kind: FundAccessKind
  context: FundAccessContextSnapshot
  access: FundAccessAmountSnapshot
  isDark: boolean
}

function AmountCell({ compact, exact }: { compact: string; exact: string }) {
  return (
    <td
      className="min-w-0 max-w-0 break-all py-1.5 pl-3 text-right font-mono text-xs tabular-nums"
      title={exact}
    >
      {compact}
    </td>
  )
}

export function FundAccessSummary({ kind, context, access, isDark }: FundAccessSummaryProps) {
  const configuredUnit = currencyLabel(access.currency, context)
  const source = kind === 'payout' ? context.balance : context.currentSurplus
  const sourceLabel = kind === 'payout' ? 'Terminal balance' : 'Current surplus'
  const remaining = access.unlimited
    ? `Unlimited ${configuredUnit}`
    : `${formatFundAccessAmount(access.remaining, context.decimals)} ${configuredUnit}`
  const remainingExact = access.unlimited
    ? `Unlimited ${configuredUnit}`
    : `${formatUnits(access.remaining, context.decimals)} ${configuredUnit}`
  const sourceCompact = `${formatFundAccessAmount(source, context.decimals)} ${context.tokenSymbol}`
  const sourceExact = `${formatUnits(source, context.decimals)} ${context.tokenSymbol}`
  const availableCompact = `${formatFundAccessAmount(access.available, context.decimals)} ${configuredUnit}`
  const availableExact = `${formatUnits(access.available, context.decimals)} ${configuredUnit}`

  return (
    <div
      data-testid={`fund-access-${kind}-summary`}
      className={`w-full min-w-0 overflow-hidden p-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}
    >
      <table className="w-full table-fixed border-collapse">
        <tbody>
          <tr>
            <th scope="row" className={`w-[46%] py-1.5 pr-2 text-left text-xs font-normal ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {kind === 'payout' ? 'Limit remaining' : 'Allowance remaining'}
            </th>
            <AmountCell compact={remaining} exact={remainingExact} />
          </tr>
          <tr>
            <th scope="row" className={`w-[46%] py-1.5 pr-2 text-left text-xs font-normal ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {sourceLabel}
            </th>
            <AmountCell compact={sourceCompact} exact={sourceExact} />
          </tr>
          <tr className={isDark ? 'border-t border-white/10' : 'border-t border-gray-200'}>
            <th scope="row" className={`w-[46%] py-2 pr-2 text-left text-xs font-medium ${kind === 'payout' ? 'text-juice-orange' : isDark ? 'text-purple-400' : 'text-purple-600'}`}>
              Available now
            </th>
            <td
              className={`min-w-0 max-w-0 break-all py-2 pl-3 text-right font-mono text-xs font-medium tabular-nums ${kind === 'payout' ? 'text-juice-orange' : isDark ? 'text-purple-400' : 'text-purple-600'}`}
              title={availableExact}
            >
              {availableCompact}
            </td>
          </tr>
        </tbody>
      </table>
      <p className={`mt-2 break-words text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
        Accounting context: {context.tokenSymbol} · currency {context.accountingCurrency.toString()} · {context.decimals} decimals · ruleset {context.rulesetId.toString()} / cycle {context.rulesetCycleNumber.toString()}
      </p>
    </div>
  )
}
