// Human-readable transaction summary component

export type TransactionType =
  | 'pay'
  | 'cashOut'
  | 'sendPayouts'
  | 'sendReservedTokens'
  | 'useAllowance'
  | 'queueRuleset'
  | 'launchProject'
  | 'deployRevnet'
  | 'deployERC20'

interface PayDetails {
  projectId: string | number
  projectName?: string
  amount: string
  amountFormatted: string
  estimatedTokens?: string
  fee?: string
  feeFormatted?: string
  memo?: string
  currency?: string
}

interface CashOutDetails {
  projectId: string | number
  projectName?: string
  tokens: string
  tokensFormatted: string
  estimatedReturn: string
  estimatedReturnFormatted: string
  taxRate?: number
  currency?: string
}

interface SendPayoutsDetails {
  projectId: string | number
  projectName?: string
  amount: string
  amountFormatted: string
  fee?: string
  feeFormatted?: string
  recipients?: Array<{
    name?: string
    address: string
    percent: number
    amount?: string
  }>
  currency?: string
}

interface UseAllowanceDetails {
  projectId: string | number
  projectName?: string
  amount: string
  amountFormatted: string
  fee?: string
  feeFormatted?: string
  netAmount?: string
  netAmountFormatted?: string
  destination?: string
  currency?: string
}

interface QueueRulesetDetails {
  projectId: string | number
  projectName?: string
  effectiveDate?: string
  changes: Array<{
    field: string
    from?: string
    to: string
  }>
}

interface LaunchProjectDetails {
  projectName?: string
  owner: string
  chainIds: number[]
  chainNames?: string[]
  initialIssuance?: string
  reservedRate?: number
  cashOutTaxRate?: number
}

interface DeployRevnetDetails {
  name: string
  tokenSymbol?: string
  chainIds: number[]
  chainNames?: string[]
  stages: Array<{
    splitPercent: number
    decayPercent: number
    decayFrequency: string
  }>
  autoDeploySuckers?: boolean
}

interface DeployERC20Details {
  projectId: string | number
  projectName?: string
  tokenName: string
  tokenSymbol: string
  chainIds?: number[]
  chainNames?: string[]
}

interface SendReservedTokensDetails {
  projectId: string | number
  projectName?: string
  pendingTokens: string
  pendingTokensFormatted: string
  reservedRate?: number
  recipients?: Array<{
    name?: string
    address: string
    percent: number
    tokens?: string
    isProject?: boolean
    projectId?: number
  }>
}

type TransactionDetails =
  | { type: 'pay'; details: PayDetails }
  | { type: 'cashOut'; details: CashOutDetails }
  | { type: 'sendPayouts'; details: SendPayoutsDetails }
  | { type: 'sendReservedTokens'; details: SendReservedTokensDetails }
  | { type: 'useAllowance'; details: UseAllowanceDetails }
  | { type: 'queueRuleset'; details: QueueRulesetDetails }
  | { type: 'launchProject'; details: LaunchProjectDetails }
  | { type: 'deployRevnet'; details: DeployRevnetDetails }
  | { type: 'deployERC20'; details: DeployERC20Details }

export type TransactionSummaryProps = TransactionDetails & {
  isDark: boolean
}

// Chain name mapping
const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  10: 'Optimism',
  8453: 'Base',
  42161: 'Arbitrum',
}

function truncateAddress(address: string): string {
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

// Summary components for each transaction type
function PaySummary({ details, isDark }: { details: PayDetails; isDark: boolean }) {
  return (
    <div className={`p-4 space-y-3 ${isDark ? 'bg-juice-orange/5' : 'bg-orange-50/50'}`}>
      <div className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
        You are paying{' '}
        <span className={`font-semibold ${isDark ? 'text-juice-orange' : 'text-orange-600'}`}>
          {details.amountFormatted}
        </span>
        {' '}to{' '}
        <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
          {details.projectName || `Project #${details.projectId}`}
        </span>
      </div>

      <ul className={`text-sm space-y-1.5 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
        {details.estimatedTokens && (
          <li className="flex items-start gap-2">
            <span className="shrink-0">-</span>
            <span>
              You will receive approximately{' '}
              <span className={isDark ? 'text-white' : 'text-gray-900'}>
                {details.estimatedTokens}
              </span>
              {' '}tokens
            </span>
          </li>
        )}
        {details.fee && details.feeFormatted && (
          <li className="flex items-start gap-2">
            <span className="shrink-0">-</span>
            <span>
              A 2.5% fee ({details.feeFormatted}) will go to Juicebox
            </span>
          </li>
        )}
        {details.memo && (
          <li className="flex items-start gap-2">
            <span className="shrink-0">-</span>
            <span>
              Memo: "{details.memo}"
            </span>
          </li>
        )}
      </ul>
    </div>
  )
}

function CashOutSummary({ details, isDark }: { details: CashOutDetails; isDark: boolean }) {
  return (
    <div className={`p-4 space-y-3 ${isDark ? 'bg-red-500/5' : 'bg-red-50/50'}`}>
      <div className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
        You are cashing out{' '}
        <span className={`font-semibold ${isDark ? 'text-red-400' : 'text-red-600'}`}>
          {details.tokensFormatted}
        </span>
        {' '}tokens from{' '}
        <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
          {details.projectName || `Project #${details.projectId}`}
        </span>
      </div>

      <ul className={`text-sm space-y-1.5 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
        {details.taxRate !== undefined && (
          <li className="flex items-start gap-2">
            <span className="shrink-0">-</span>
            <span>
              Based on the current treasury and {details.taxRate}% cash out tax
            </span>
          </li>
        )}
        <li className="flex items-start gap-2">
          <span className="shrink-0">-</span>
          <span>
            You will receive approximately{' '}
            <span className={isDark ? 'text-white' : 'text-gray-900'}>
              {details.estimatedReturnFormatted}
            </span>
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="shrink-0">-</span>
          <span className={isDark ? 'text-red-400/70' : 'text-red-600'}>
            Your tokens will be permanently burned
          </span>
        </li>
      </ul>
    </div>
  )
}

function SendPayoutsSummary({ details, isDark }: { details: SendPayoutsDetails; isDark: boolean }) {
  const displayedRecipients = details.recipients?.slice(0, 3) || []
  const additionalCount = (details.recipients?.length || 0) - 3

  return (
    <div className={`p-4 space-y-3 ${isDark ? 'bg-green-500/5' : 'bg-green-50/50'}`}>
      <div className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
        Sending payouts from{' '}
        <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
          {details.projectName || `Project #${details.projectId}`}
        </span>
        {' '}treasury
      </div>

      <ul className={`text-sm space-y-1.5 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
        <li className="flex items-start gap-2">
          <span className="shrink-0">-</span>
          <span>
            Total:{' '}
            <span className={`font-semibold ${isDark ? 'text-green-400' : 'text-green-600'}`}>
              {details.amountFormatted}
            </span>
          </span>
        </li>
        {details.fee && (
          <li className="flex items-start gap-2">
            <span className="shrink-0">-</span>
            <span>Protocol fee: {details.feeFormatted} (2.5%)</span>
          </li>
        )}
        {displayedRecipients.length > 0 && (
          <li className="flex items-start gap-2">
            <span className="shrink-0">-</span>
            <span className="flex-1">
              <span className="block">Recipients:</span>
              <ul className="mt-1 ml-2 space-y-0.5">
                {displayedRecipients.map((r, i) => (
                  <li key={i}>
                    {r.name || truncateAddress(r.address)} receives {r.percent}%
                    {r.amount ? ` (${r.amount})` : ''}
                  </li>
                ))}
                {additionalCount > 0 && (
                  <li className={isDark ? 'text-gray-500' : 'text-gray-400'}>
                    + {additionalCount} more recipient{additionalCount !== 1 ? 's' : ''}...
                  </li>
                )}
              </ul>
            </span>
          </li>
        )}
      </ul>
    </div>
  )
}

function UseAllowanceSummary({ details, isDark }: { details: UseAllowanceDetails; isDark: boolean }) {
  return (
    <div className={`p-4 space-y-3 ${isDark ? 'bg-purple-500/5' : 'bg-purple-50/50'}`}>
      <div className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
        Withdrawing{' '}
        <span className={`font-semibold ${isDark ? 'text-purple-400' : 'text-purple-600'}`}>
          {details.amountFormatted}
        </span>
        {' '}from{' '}
        <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
          {details.projectName || `Project #${details.projectId}`}
        </span>
        {' '}surplus allowance
      </div>

      <ul className={`text-sm space-y-1.5 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
        {details.fee && (
          <li className="flex items-start gap-2">
            <span className="shrink-0">-</span>
            <span>Protocol fee: {details.feeFormatted} (2.5%)</span>
          </li>
        )}
        {details.netAmountFormatted && (
          <li className="flex items-start gap-2">
            <span className="shrink-0">-</span>
            <span>
              You receive:{' '}
              <span className={isDark ? 'text-white' : 'text-gray-900'}>
                {details.netAmountFormatted}
              </span>
            </span>
          </li>
        )}
        {details.destination && (
          <li className="flex items-start gap-2">
            <span className="shrink-0">-</span>
            <span>Destination: {truncateAddress(details.destination)}</span>
          </li>
        )}
      </ul>
    </div>
  )
}

function SendReservedTokensSummary({ details, isDark }: { details: SendReservedTokensDetails; isDark: boolean }) {
  const displayedRecipients = details.recipients?.slice(0, 3) || []
  const additionalCount = (details.recipients?.length || 0) - 3

  return (
    <div className={`p-4 space-y-3 ${isDark ? 'bg-amber-500/5' : 'bg-amber-50/50'}`}>
      <div className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
        Distributing{' '}
        <span className={`font-semibold ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
          {details.pendingTokensFormatted}
        </span>
        {' '}reserved tokens from{' '}
        <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
          {details.projectName || `Project #${details.projectId}`}
        </span>
      </div>

      <ul className={`text-sm space-y-1.5 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
        {details.reservedRate !== undefined && (
          <li className="flex items-start gap-2">
            <span className="shrink-0">-</span>
            <span>
              Reserved rate: {details.reservedRate}%
            </span>
          </li>
        )}
        {displayedRecipients.length > 0 && (
          <li className="flex items-start gap-2">
            <span className="shrink-0">-</span>
            <span className="flex-1">
              <span className="block">Recipients:</span>
              <ul className="mt-1 ml-2 space-y-0.5">
                {displayedRecipients.map((r, i) => (
                  <li key={i}>
                    {r.isProject ? (
                      <span className={isDark ? 'text-juice-orange' : 'text-orange-600'}>
                        Project #{r.projectId}
                      </span>
                    ) : (
                      r.name || truncateAddress(r.address)
                    )}
                    {' '}receives {r.percent}%
                    {r.tokens ? ` (~${r.tokens})` : ''}
                  </li>
                ))}
                {additionalCount > 0 && (
                  <li className={isDark ? 'text-gray-500' : 'text-gray-400'}>
                    + {additionalCount} more recipient{additionalCount !== 1 ? 's' : ''}...
                  </li>
                )}
              </ul>
            </span>
          </li>
        )}
        <li className="flex items-start gap-2">
          <span className="shrink-0">-</span>
          <span>
            Tokens will be minted and sent to configured splits
          </span>
        </li>
      </ul>
    </div>
  )
}

function QueueRulesetSummary({ details, isDark }: { details: QueueRulesetDetails; isDark: boolean }) {
  return (
    <div className={`p-4 space-y-3 ${isDark ? 'bg-blue-500/5' : 'bg-blue-50/50'}`}>
      <div className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
        Queueing new ruleset for{' '}
        <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
          {details.projectName || `Project #${details.projectId}`}
        </span>
      </div>

      <ul className={`text-sm space-y-1.5 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
        {details.effectiveDate && (
          <li className="flex items-start gap-2">
            <span className="shrink-0">-</span>
            <span>Takes effect: {details.effectiveDate}</span>
          </li>
        )}
        {details.changes.length > 0 && (
          <li className="flex items-start gap-2">
            <span className="shrink-0">-</span>
            <span className="flex-1">
              <span className="block">Changes:</span>
              <ul className="mt-1 ml-2 space-y-0.5">
                {details.changes.map((change, i) => (
                  <li key={i}>
                    {change.field}:{' '}
                    {change.from ? (
                      <>
                        <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>
                          {change.from}
                        </span>
                        {' -> '}
                      </>
                    ) : null}
                    <span className={isDark ? 'text-blue-400' : 'text-blue-600'}>
                      {change.to}
                    </span>
                  </li>
                ))}
              </ul>
            </span>
          </li>
        )}
      </ul>
    </div>
  )
}

function LaunchProjectSummary({ details, isDark }: { details: LaunchProjectDetails; isDark: boolean }) {
  const chainNames = details.chainNames || details.chainIds.map(id => CHAIN_NAMES[id] || `Chain ${id}`)

  return (
    <div className={`p-4 space-y-3 ${isDark ? 'bg-juice-orange/5' : 'bg-orange-50/50'}`}>
      <div className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
        Creating new Juicebox project
        {details.projectName && (
          <>
            :{' '}
            <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {details.projectName}
            </span>
          </>
        )}
      </div>

      <ul className={`text-sm space-y-1.5 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
        <li className="flex items-start gap-2">
          <span className="shrink-0">-</span>
          <span>
            Chains:{' '}
            <span className={isDark ? 'text-white' : 'text-gray-900'}>
              {chainNames.join(', ')}
            </span>
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="shrink-0">-</span>
          <span>Owner: {truncateAddress(details.owner)}</span>
        </li>
        {details.initialIssuance && (
          <li className="flex items-start gap-2">
            <span className="shrink-0">-</span>
            <span>Initial issuance: {details.initialIssuance} tokens/ETH</span>
          </li>
        )}
        {details.reservedRate !== undefined && (
          <li className="flex items-start gap-2">
            <span className="shrink-0">-</span>
            <span>Reserved rate: {details.reservedRate}%</span>
          </li>
        )}
      </ul>
    </div>
  )
}

function DeployRevnetSummary({ details, isDark }: { details: DeployRevnetDetails; isDark: boolean }) {
  const chainNames = details.chainNames || details.chainIds.map(id => CHAIN_NAMES[id] || `Chain ${id}`)

  return (
    <div className={`p-4 space-y-3 ${isDark ? 'bg-purple-500/5' : 'bg-purple-50/50'}`}>
      <div className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
        Deploying revnet:{' '}
        <span className={`font-semibold ${isDark ? 'text-purple-400' : 'text-purple-600'}`}>
          {details.name}
        </span>
        {details.tokenSymbol && (
          <span className={`ml-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            (${details.tokenSymbol})
          </span>
        )}
      </div>

      <ul className={`text-sm space-y-1.5 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
        <li className="flex items-start gap-2">
          <span className="shrink-0">-</span>
          <span>
            Chains:{' '}
            <span className={isDark ? 'text-white' : 'text-gray-900'}>
              {chainNames.join(', ')}
            </span>
          </span>
        </li>
        {details.stages.length > 0 && (
          <li className="flex items-start gap-2">
            <span className="shrink-0">-</span>
            <span className="flex-1">
              <span className="block">{details.stages.length} stage{details.stages.length !== 1 ? 's' : ''} configured:</span>
              <ul className="mt-1 ml-2 space-y-0.5">
                {details.stages.map((stage, i) => (
                  <li key={i}>
                    Stage {i + 1}: {stage.splitPercent}% operator split, {stage.decayPercent}% decay/{stage.decayFrequency}
                  </li>
                ))}
              </ul>
            </span>
          </li>
        )}
        {details.autoDeploySuckers && details.chainIds.length > 1 && (
          <li className="flex items-start gap-2">
            <span className="shrink-0">-</span>
            <span className={isDark ? 'text-juice-cyan' : 'text-cyan-600'}>
              Cross-chain bridging will be enabled via suckers
            </span>
          </li>
        )}
      </ul>
    </div>
  )
}

function DeployERC20Summary({ details, isDark }: { details: DeployERC20Details; isDark: boolean }) {
  const chainNames = details.chainNames || details.chainIds?.map(id => CHAIN_NAMES[id] || `Chain ${id}`)
  const isMultiChain = (details.chainIds?.length || 1) > 1

  return (
    <div className={`p-4 space-y-3 ${isDark ? 'bg-juice-cyan/5' : 'bg-cyan-50/50'}`}>
      <div className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
        Deploying ERC-20 token:{' '}
        <span className={`font-semibold ${isDark ? 'text-juice-cyan' : 'text-cyan-600'}`}>
          {details.tokenName}
        </span>
        {' '}
        <span className={`font-mono ${isDark ? 'text-juice-cyan' : 'text-cyan-600'}`}>
          (${details.tokenSymbol})
        </span>
      </div>

      <ul className={`text-sm space-y-1.5 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
        <li className="flex items-start gap-2">
          <span className="shrink-0">-</span>
          <span>
            For{' '}
            <span className={isDark ? 'text-white' : 'text-gray-900'}>
              {details.projectName || `Project #${details.projectId}`}
            </span>
          </span>
        </li>
        {chainNames && (
          <li className="flex items-start gap-2">
            <span className="shrink-0">-</span>
            <span>
              {isMultiChain ? 'Deploying on: ' : 'Network: '}
              <span className={isDark ? 'text-white' : 'text-gray-900'}>
                {chainNames.join(', ')}
              </span>
            </span>
          </li>
        )}
        {isMultiChain && (
          <li className="flex items-start gap-2">
            <span className="shrink-0">-</span>
            <span className={isDark ? 'text-juice-cyan' : 'text-cyan-600'}>
              Same token address on all chains via CREATE2
            </span>
          </li>
        )}
        <li className="flex items-start gap-2">
          <span className="shrink-0">-</span>
          <span>Token holders can claim and transfer freely</span>
        </li>
      </ul>
    </div>
  )
}

export default function TransactionSummary(props: TransactionSummaryProps) {
  const { type, details, isDark } = props

  switch (type) {
    case 'pay':
      return <PaySummary details={details as PayDetails} isDark={isDark} />
    case 'cashOut':
      return <CashOutSummary details={details as CashOutDetails} isDark={isDark} />
    case 'sendPayouts':
      return <SendPayoutsSummary details={details as SendPayoutsDetails} isDark={isDark} />
    case 'sendReservedTokens':
      return <SendReservedTokensSummary details={details as SendReservedTokensDetails} isDark={isDark} />
    case 'useAllowance':
      return <UseAllowanceSummary details={details as UseAllowanceDetails} isDark={isDark} />
    case 'queueRuleset':
      return <QueueRulesetSummary details={details as QueueRulesetDetails} isDark={isDark} />
    case 'launchProject':
      return <LaunchProjectSummary details={details as LaunchProjectDetails} isDark={isDark} />
    case 'deployRevnet':
      return <DeployRevnetSummary details={details as DeployRevnetDetails} isDark={isDark} />
    case 'deployERC20':
      return <DeployERC20Summary details={details as DeployERC20Details} isDark={isDark} />
    default:
      return null
  }
}

// Export details types for use in modals
export type {
  PayDetails,
  CashOutDetails,
  SendPayoutsDetails,
  SendReservedTokensDetails,
  UseAllowanceDetails,
  QueueRulesetDetails,
  LaunchProjectDetails,
  DeployRevnetDetails,
  DeployERC20Details,
}
