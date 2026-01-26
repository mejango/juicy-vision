import { lazy, Suspense, ReactNode, ComponentType } from 'react'
import { ParsedComponent } from '../../utils/messageParser'
import ErrorBoundary, { ComponentErrorFallback } from '../ui/ErrorBoundary'
import ComponentShimmer from './ComponentShimmer'
import OptionsPickerShimmer from './OptionsPickerShimmer'
import TransactionPreviewShimmer from './TransactionPreviewShimmer'

// =============================================================================
// Lazy-loaded Components
// =============================================================================

const ConnectWalletButton = lazy(() => import('./ConnectWalletButton'))
const ProjectCard = lazy(() => import('./ProjectCard'))
const NoteCard = lazy(() => import('./NoteCard'))
const TransactionStatus = lazy(() => import('./TransactionStatus'))
const TransactionPreview = lazy(() => import('./TransactionPreview'))
const CashOutForm = lazy(() => import('./CashOutForm'))
const SendPayoutsForm = lazy(() => import('./SendPayoutsForm'))
const SendReservedTokensForm = lazy(() => import('./SendReservedTokensForm'))
const UseSurplusAllowanceForm = lazy(() => import('./UseSurplusAllowanceForm'))
const DeployERC20Form = lazy(() => import('./DeployERC20Form'))
const QueueRulesetForm = lazy(() => import('./QueueRulesetForm'))
const CreateProjectForm = lazy(() => import('./CreateProjectForm'))
const CreateRevnetForm = lazy(() => import('./CreateRevnetForm'))
const PriceChart = lazy(() => import('./PriceChart'))
const ActivityFeed = lazy(() => import('./ActivityFeed'))
const RulesetSchedule = lazy(() => import('./RulesetSchedule'))
// OptionsPicker is eagerly loaded to avoid shimmer flash - it's commonly used and should appear instantly
import OptionsPicker from './OptionsPicker'
const ProjectChainPicker = lazy(() => import('./ProjectChainPicker'))
const TopProjects = lazy(() => import('./TopProjects'))
const NFTGallery = lazy(() => import('./NFTGallery'))
const NFTCard = lazy(() => import('./NFTCard'))
const Storefront = lazy(() => import('./Storefront'))
const LandingPagePreview = lazy(() => import('./LandingPagePreview'))
const SuccessVisualization = lazy(() => import('./SuccessVisualization'))
const InteractionsSheet = lazy(() => import('./InteractionsSheet'))
const ActionButton = lazy(() => import('./ActionButton'))

// Chart components
const BalanceChart = lazy(() => import('./charts').then(m => ({ default: m.BalanceChart })))
const HoldersChart = lazy(() => import('./charts').then(m => ({ default: m.HoldersChart })))
const VolumeChart = lazy(() => import('./charts').then(m => ({ default: m.VolumeChart })))
const TokenPriceChart = lazy(() => import('./charts').then(m => ({ default: m.TokenPriceChart })))
const PoolPriceChart = lazy(() => import('./charts').then(m => ({ default: m.PoolPriceChart })))
const MultiChainCashOutChart = lazy(() => import('./charts').then(m => ({ default: m.MultiChainCashOutChart })))

// =============================================================================
// Registry Configuration
// =============================================================================

type PropMapper = (props: Record<string, unknown>) => Record<string, unknown>

interface ComponentConfig {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: ComponentType<any>
  mapProps?: PropMapper
  fallback?: ReactNode
}

const parseIntProp = (value: unknown): number | undefined =>
  value ? parseInt(String(value), 10) : undefined

const COMPONENT_REGISTRY: Record<string, ComponentConfig> = {
  // Wallet
  'connect-wallet': { component: ConnectWalletButton },
  'connect-account': { component: ConnectWalletButton },

  // Project Cards
  'project-card': {
    component: ProjectCard,
    mapProps: (p) => ({ projectId: p.projectId, chainId: p.chainId }),
  },
  'payment-form': {
    // Deprecated: use project-card instead
    component: ProjectCard,
    mapProps: (p) => ({ projectId: p.projectId, chainId: p.chainId }),
  },
  'note-card': {
    component: NoteCard,
    mapProps: (p) => ({ projectId: p.projectId, chainId: p.chainId, defaultNote: p.defaultNote }),
  },

  // Project Management Forms
  'cash-out-form': {
    component: CashOutForm,
    mapProps: (p) => ({ projectId: p.projectId, chainId: p.chainId }),
  },
  'send-payouts-form': {
    component: SendPayoutsForm,
    mapProps: (p) => ({ projectId: p.projectId, chainId: p.chainId }),
  },
  'send-reserved-tokens-form': {
    component: SendReservedTokensForm,
    mapProps: (p) => ({ projectId: p.projectId, chainId: p.chainId }),
  },
  'use-surplus-allowance-form': {
    component: UseSurplusAllowanceForm,
    mapProps: (p) => ({ projectId: p.projectId, chainId: p.chainId }),
  },
  'deploy-erc20-form': {
    component: DeployERC20Form,
    mapProps: (p) => ({ projectId: p.projectId, chainId: p.chainId }),
  },
  'queue-ruleset-form': {
    component: QueueRulesetForm,
    mapProps: (p) => ({ projectId: p.projectId, chainId: p.chainId }),
  },
  'create-project-form': {
    component: CreateProjectForm,
    mapProps: (p) => ({ defaultOwner: p.owner, defaultChainIds: p.chainIds }),
  },
  'create-revnet-form': {
    component: CreateRevnetForm,
    mapProps: (p) => ({ defaultOperator: p.operator, defaultChainIds: p.chainIds }),
  },

  // Transactions
  'transaction-status': {
    component: TransactionStatus,
    mapProps: (p) => ({ txId: p.txId }),
  },
  'transaction-preview': {
    component: TransactionPreview,
    mapProps: (p) => ({
      action: p.action,
      contract: p.contract,
      chainId: p.chainId,
      projectId: p.projectId,
      parameters: p.parameters,
      explanation: p.explanation,
      chainConfigs: p.chainConfigs,
      _isTruncated: p._isTruncated,
    }),
  },
  'action-button': {
    component: ActionButton,
    mapProps: (p) => ({
      action: p.action,
      label: p.label,
    }),
  },

  // Charts
  'price-chart': {
    component: PriceChart,
    mapProps: (p) => ({ projectId: p.projectId, chainId: p.chainId, range: p.range }),
  },
  'balance-chart': {
    component: BalanceChart,
    mapProps: (p) => ({ projectId: p.projectId, chainId: p.chainId, range: p.range }),
  },
  'holders-chart': {
    component: HoldersChart,
    mapProps: (p) => ({ projectId: p.projectId, chainId: p.chainId, limit: parseIntProp(p.limit) }),
  },
  'volume-chart': {
    component: VolumeChart,
    mapProps: (p) => ({ projectId: p.projectId, chainId: p.chainId, range: p.range }),
  },
  'token-price-chart': {
    component: TokenPriceChart,
    mapProps: (p) => ({
      projectId: p.projectId,
      chainId: p.chainId,
      range: p.range,
      poolAddress: p.poolAddress,
      projectTokenAddress: p.projectTokenAddress,
    }),
  },
  'pool-price-chart': {
    component: PoolPriceChart,
    mapProps: (p) => ({
      poolAddress: p.poolAddress,
      projectTokenAddress: p.projectTokenAddress,
      chainId: p.chainId,
      tokenSymbol: p.tokenSymbol,
      range: p.range,
    }),
  },
  'multi-chain-cash-out-chart': {
    component: MultiChainCashOutChart,
    mapProps: (p) => ({
      projectId: p.projectId,
      chainId: p.chainId,
      chains: p.chains,
      range: p.range,
    }),
  },

  // Activity & Rulesets
  'activity-feed': {
    component: ActivityFeed,
    mapProps: (p) => ({ projectId: p.projectId, chainId: p.chainId, limit: parseIntProp(p.limit) }),
  },
  'ruleset-schedule': {
    component: RulesetSchedule,
    mapProps: (p) => ({ projectId: p.projectId, chainId: p.chainId }),
  },

  // Pickers
  'project-chain-picker': {
    component: ProjectChainPicker,
    mapProps: (p) => ({ projectId: p.projectId }),
  },
  'top-projects': {
    component: TopProjects,
    mapProps: (p) => ({ limit: parseIntProp(p.limit), orderBy: p.orderBy }),
  },

  // NFTs
  'nft-gallery': {
    component: NFTGallery,
    mapProps: (p) => ({
      projectId: p.projectId,
      chainId: p.chainId,
      columns: p.columns,
      showMintActions: p.showMintActions,
    }),
  },
  'nft-card': {
    component: NFTCard,
    mapProps: (p) => ({ projectId: p.projectId, tierId: p.tierId, chainId: p.chainId }),
  },
  'storefront': {
    component: Storefront,
    mapProps: (p) => ({
      projectId: p.projectId,
      chainId: p.chainId,
      sortBy: p.sortBy,
      filterCategory: p.filterCategory,
      showSoldOut: p.showSoldOut,
    }),
  },

  // Interactions
  'interactions-sheet': {
    component: InteractionsSheet,
    mapProps: (p) => ({
      context: p.context || 'app',
      projectId: p.projectId,
      chainId: p.chainId,
    }),
  },

  // Landing & Visualization
  'landing-page-preview': {
    component: LandingPagePreview,
    mapProps: (p) => ({
      projectId: p.projectId,
      chainId: p.chainId,
      layout: p.layout,
      showComponents: p.showComponents,
      title: p.title,
      subtitle: p.subtitle,
    }),
  },
  'success-visualization': {
    component: SuccessVisualization,
    mapProps: (p) => ({
      targetRaise: p.targetRaise,
      supporterCount: p.supporterCount,
      timeframe: p.timeframe,
      growthRate: p.growthRate,
      avgContribution: p.avgContribution,
    }),
  },
}

// =============================================================================
// Rendering Logic
// =============================================================================

interface ComponentRegistryProps {
  component: ParsedComponent
  chatId?: string
  messageId?: string
  userResponse?: string // The user's response to this component (if submitted)
}

function LazyWrapper({
  children,
  type,
  fallback,
}: {
  children: React.ReactNode
  type: string
  fallback?: ReactNode
}) {
  return (
    <ErrorBoundary fallback={<ComponentErrorFallback componentType={type} />}>
      <Suspense fallback={fallback || <ComponentShimmer />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  )
}

/**
 * Extract complete JSON objects from a partial array string at a given depth.
 * Works for both groups array and options array within a group.
 */
function extractCompleteObjects(jsonStr: string, startIdx: number): { objects: unknown[]; endIdx: number; isComplete: boolean } {
  const objects: unknown[] = []
  let depth = 0
  let inString = false
  let escapeNext = false
  let objectStart = -1
  let isComplete = false

  for (let i = startIdx; i < jsonStr.length; i++) {
    const char = jsonStr[i]

    if (escapeNext) {
      escapeNext = false
      continue
    }

    if (char === '\\' && inString) {
      escapeNext = true
      continue
    }

    if (char === '"' && !escapeNext) {
      inString = !inString
      continue
    }

    if (inString) continue

    if (char === '{') {
      if (depth === 0 && objectStart === -1) {
        objectStart = i
      }
      depth++
    } else if (char === '}') {
      depth--
      if (depth === 0 && objectStart !== -1) {
        const objectStr = jsonStr.slice(objectStart, i + 1)
        try {
          objects.push(JSON.parse(objectStr))
        } catch {
          // Invalid object, skip
        }
        objectStart = -1
      }
    } else if (char === '[') {
      depth++
    } else if (char === ']') {
      if (depth === 0) {
        isComplete = true
        return { objects, endIdx: i, isComplete }
      }
      depth--
    }
  }

  return { objects, endIdx: jsonStr.length, isComplete }
}

/**
 * Parse partial options-picker groups with support for streaming options within groups.
 * Returns groups with whatever options have been parsed so far, plus metadata about streaming state.
 */
function parsePartialOptionsGroups(jsonStr: string): {
  groups: Array<{
    id?: string
    label?: string
    type?: string
    multiSelect?: boolean
    options?: unknown[]
    expectedOptionCount?: number
    _isPartial?: boolean
  }>
  isComplete: boolean
  isInvalid: boolean
} {
  // Try full parse first
  try {
    const parsed = JSON.parse(jsonStr)
    if (Array.isArray(parsed)) {
      return { groups: parsed, isComplete: true, isInvalid: false }
    }
    return { groups: [], isComplete: true, isInvalid: true }
  } catch {
    // Continue to partial parsing
  }

  const trimmed = jsonStr.trim()
  if (!trimmed.startsWith('[')) {
    return { groups: [], isComplete: true, isInvalid: true }
  }

  if (trimmed.length < 3) {
    return { groups: [], isComplete: false, isInvalid: false }
  }

  const groups: Array<{
    id?: string
    label?: string
    type?: string
    multiSelect?: boolean
    options?: unknown[]
    expectedOptionCount?: number
    _isPartial?: boolean
  }> = []

  // Find complete groups first
  const { objects: completeGroups, endIdx, isComplete: groupsComplete } = extractCompleteObjects(jsonStr, 1)
  groups.push(...completeGroups as typeof groups)

  // Look for a partial group after the last complete one
  if (!groupsComplete) {
    // Find the start of the next (partial) group object
    let partialStart = endIdx
    for (let i = endIdx; i < jsonStr.length; i++) {
      if (jsonStr[i] === '{') {
        partialStart = i
        break
      }
    }

    if (partialStart < jsonStr.length) {
      const partialStr = jsonStr.slice(partialStart)

      // Try to extract what we can from the partial group
      const partialGroup: typeof groups[0] = { _isPartial: true }

      // Extract id
      const idMatch = partialStr.match(/"id"\s*:\s*"([^"]*)"/)
      if (idMatch) partialGroup.id = idMatch[1]

      // Extract label
      const labelMatch = partialStr.match(/"label"\s*:\s*"([^"]*)"/)
      if (labelMatch) partialGroup.label = labelMatch[1]

      // Extract type
      const typeMatch = partialStr.match(/"type"\s*:\s*"([^"]*)"/)
      if (typeMatch) partialGroup.type = typeMatch[1]

      // Extract multiSelect
      const multiMatch = partialStr.match(/"multiSelect"\s*:\s*(true|false)/)
      if (multiMatch) partialGroup.multiSelect = multiMatch[1] === 'true'

      // Extract expectedOptionCount
      const expectedMatch = partialStr.match(/"expectedOptionCount"\s*:\s*(\d+)/)
      if (expectedMatch) partialGroup.expectedOptionCount = parseInt(expectedMatch[1], 10)

      // Look for options array and extract complete options from it
      const optionsStart = partialStr.indexOf('"options"')
      if (optionsStart !== -1) {
        const arrayStart = partialStr.indexOf('[', optionsStart)
        if (arrayStart !== -1) {
          const { objects: options } = extractCompleteObjects(partialStr, arrayStart + 1)
          if (options.length > 0 || partialGroup.id) {
            partialGroup.options = options
          }
        }
      }

      // Only add partial group if we have at least an id or label
      if (partialGroup.id || partialGroup.label) {
        groups.push(partialGroup)
      }
    }
  }

  return { groups, isComplete: groupsComplete, isInvalid: false }
}

function renderOptionsPicker(
  props: Record<string, unknown>,
  componentIsStreaming?: boolean,
  chatId?: string,
  messageId?: string,
  userResponse?: string
) {
  const groupsStr = props.groups as string | undefined
  const streamTotal = props.streamTotal
    ? parseInt(String(props.streamTotal), 10)
    : undefined

  // Handle pre-parsed groups (already an array)
  if (Array.isArray(props.groups)) {
    return (
      <OptionsPicker
        groups={props.groups}
        submitLabel={props.submitLabel as string | undefined}
        allSelectedLabel={props.allSelectedLabel as string | undefined}
        expectedGroupCount={streamTotal}
        isStreaming={componentIsStreaming || false}
        chatId={chatId}
        messageId={messageId}
        creative={props.creative === 'true' || props.creative === true}
        userResponse={userResponse}
      />
    )
  }

  // No groups provided yet - if streaming, show empty picker with loading state
  if (!groupsStr) {
    if (componentIsStreaming) {
      return (
        <OptionsPicker
          groups={[]}
          isStreaming={true}
          expectedGroupCount={streamTotal || 2}
          chatId={chatId}
          messageId={messageId}
        />
      )
    }
    return (
      <div className="glass p-3 text-gray-400 text-sm">
        Options not available. Try asking again.
      </div>
    )
  }

  // Parse JSON string with option-level streaming support
  const { groups: parsedGroups, isComplete, isInvalid } = parsePartialOptionsGroups(groupsStr)

  // Streaming if either component tag incomplete or JSON array incomplete
  const isStreaming = componentIsStreaming || !isComplete

  // Invalid JSON - not recoverable
  if (isInvalid) {
    return (
      <div className="glass p-3 text-gray-400 text-sm">
        Options not available. Try asking again.
      </div>
    )
  }

  // No valid groups found but still streaming - show empty picker with shimmer placeholders
  if (parsedGroups.length === 0 && isStreaming) {
    return (
      <OptionsPicker
        groups={[]}
        isStreaming={true}
        expectedGroupCount={streamTotal || 2}
        chatId={chatId}
        messageId={messageId}
      />
    )
  }

  // No valid groups found and not streaming - nothing to show
  if (parsedGroups.length === 0) {
    return (
      <div className="glass p-3 text-gray-400 text-sm">
        Options not available. Try asking again.
      </div>
    )
  }

  return (
    <OptionsPicker
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      groups={parsedGroups as any}
      submitLabel={props.submitLabel as string | undefined}
      allSelectedLabel={props.allSelectedLabel as string | undefined}
      expectedGroupCount={streamTotal}
      isStreaming={isStreaming}
      chatId={chatId}
      messageId={messageId}
      creative={props.creative === 'true' || props.creative === true}
      userResponse={userResponse}
    />
  )
}

export default function ComponentRegistry({ component, chatId, messageId, userResponse }: ComponentRegistryProps) {
  const { type, props, isStreaming } = component

  // Handle loading state
  if (type === '_loading') {
    // Show component-specific shimmers for better UX
    const loadingType = props.loadingType as string | undefined
    if (loadingType === 'options-picker') {
      return <OptionsPickerShimmer />
    }
    if (loadingType === 'transaction-preview') {
      return <TransactionPreviewShimmer />
    }
    return <ComponentShimmer />
  }

  // Handle special case: options-picker needs custom parsing logic
  if (type === 'options-picker') {
    return renderOptionsPicker(props, isStreaming, chatId, messageId, userResponse)
  }

  // Look up component in registry
  const config = COMPONENT_REGISTRY[type]

  if (!config) {
    return (
      <div className="glass p-3 text-gray-400 text-sm">
        Unknown component: {type}
      </div>
    )
  }

  const Component = config.component
  const mappedProps = config.mapProps ? config.mapProps(props) : props

  return (
    <LazyWrapper type={type} fallback={config.fallback}>
      <Component {...mappedProps} />
    </LazyWrapper>
  )
}
