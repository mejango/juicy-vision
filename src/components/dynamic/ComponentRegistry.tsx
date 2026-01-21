import { lazy, Suspense } from 'react'
import { ParsedComponent } from '../../utils/messageParser'
import ErrorBoundary, { ComponentErrorFallback } from '../ui/ErrorBoundary'
import ComponentShimmer from './ComponentShimmer'

// Lazy load all dynamic components for better initial bundle size
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
const PriceChart = lazy(() => import('./PriceChart'))
const ActivityFeed = lazy(() => import('./ActivityFeed'))
const RulesetSchedule = lazy(() => import('./RulesetSchedule'))
const OptionsPicker = lazy(() => import('./OptionsPicker'))
const ProjectChainPicker = lazy(() => import('./ProjectChainPicker'))
const TopProjects = lazy(() => import('./TopProjects'))
const NFTGallery = lazy(() => import('./NFTGallery'))
const NFTCard = lazy(() => import('./NFTCard'))
const Storefront = lazy(() => import('./Storefront'))
const LandingPagePreview = lazy(() => import('./LandingPagePreview'))
const SuccessVisualization = lazy(() => import('./SuccessVisualization'))

// Lazy load chart components
const BalanceChart = lazy(() => import('./charts').then(m => ({ default: m.BalanceChart })))
const HoldersChart = lazy(() => import('./charts').then(m => ({ default: m.HoldersChart })))
const VolumeChart = lazy(() => import('./charts').then(m => ({ default: m.VolumeChart })))
const TokenPriceChart = lazy(() => import('./charts').then(m => ({ default: m.TokenPriceChart })))
const PoolPriceChart = lazy(() => import('./charts').then(m => ({ default: m.PoolPriceChart })))
const MultiChainCashOutChart = lazy(() => import('./charts').then(m => ({ default: m.MultiChainCashOutChart })))

interface ComponentRegistryProps {
  component: ParsedComponent
}

function LazyComponent({ children, type }: { children: React.ReactNode; type: string }) {
  return (
    <ErrorBoundary fallback={<ComponentErrorFallback componentType={type} />}>
      <Suspense fallback={<ComponentShimmer />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  )
}

export default function ComponentRegistry({ component }: ComponentRegistryProps) {
  const { type, props } = component

  switch (type) {
    case '_loading':
      // ThinkingIndicator already shows loading state, no need for extra shimmer
      return null

    case 'connect-wallet':
    case 'connect-account':
      return (
        <LazyComponent type={type}>
          <ConnectWalletButton />
        </LazyComponent>
      )

    case 'project-card':
      // ProjectCard has built-in chain selector, no need for separate ProjectSelector
      return (
        <LazyComponent type={type}>
          <ProjectCard
            projectId={props.projectId}
            chainId={props.chainId}
          />
        </LazyComponent>
      )

    case 'payment-form':
      // Deprecated: use project-card instead (has built-in payment)
      return (
        <LazyComponent type={type}>
          <ProjectCard
            projectId={props.projectId}
            chainId={props.chainId}
          />
        </LazyComponent>
      )

    case 'note-card':
      // Note-focused card: memo is primary, payment is optional (defaults to 0)
      return (
        <LazyComponent type={type}>
          <NoteCard
            projectId={props.projectId}
            chainId={props.chainId}
            defaultNote={props.defaultNote}
          />
        </LazyComponent>
      )

    case 'cash-out-form':
      return (
        <LazyComponent type={type}>
          <CashOutForm
            projectId={props.projectId}
            chainId={props.chainId}
          />
        </LazyComponent>
      )

    case 'send-payouts-form':
      return (
        <LazyComponent type={type}>
          <SendPayoutsForm
            projectId={props.projectId}
            chainId={props.chainId}
          />
        </LazyComponent>
      )

    case 'send-reserved-tokens-form':
      return (
        <LazyComponent type={type}>
          <SendReservedTokensForm
            projectId={props.projectId}
            chainId={props.chainId}
          />
        </LazyComponent>
      )

    case 'use-surplus-allowance-form':
      return (
        <LazyComponent type={type}>
          <UseSurplusAllowanceForm
            projectId={props.projectId}
            chainId={props.chainId}
          />
        </LazyComponent>
      )

    case 'deploy-erc20-form':
      return (
        <LazyComponent type={type}>
          <DeployERC20Form
            projectId={props.projectId}
            chainId={props.chainId}
          />
        </LazyComponent>
      )

    case 'queue-ruleset-form':
      return (
        <LazyComponent type={type}>
          <QueueRulesetForm
            projectId={props.projectId}
            chainId={props.chainId}
          />
        </LazyComponent>
      )

    case 'transaction-status':
      return (
        <LazyComponent type={type}>
          <TransactionStatus txId={props.txId} />
        </LazyComponent>
      )

    case 'transaction-preview':
      return (
        <LazyComponent type={type}>
          <TransactionPreview
            action={props.action}
            contract={props.contract}
            chainId={props.chainId}
            projectId={props.projectId}
            parameters={props.parameters}
            explanation={props.explanation}
          />
        </LazyComponent>
      )

    case 'price-chart':
      return (
        <LazyComponent type={type}>
          <PriceChart
            projectId={props.projectId}
            chainId={props.chainId}
            range={props.range as '1y' | '5y' | '10y' | 'all' | undefined}
          />
        </LazyComponent>
      )

    case 'balance-chart':
      return (
        <LazyComponent type={type}>
          <BalanceChart
            projectId={props.projectId}
            chainId={props.chainId}
            range={props.range as '7d' | '30d' | '90d' | '1y' | 'all' | undefined}
          />
        </LazyComponent>
      )

    case 'holders-chart':
      return (
        <LazyComponent type={type}>
          <HoldersChart
            projectId={props.projectId}
            chainId={props.chainId}
            limit={props.limit ? parseInt(props.limit, 10) : undefined}
          />
        </LazyComponent>
      )

    case 'volume-chart':
      return (
        <LazyComponent type={type}>
          <VolumeChart
            projectId={props.projectId}
            chainId={props.chainId}
            range={props.range as '7d' | '30d' | '90d' | '1y' | 'all' | undefined}
          />
        </LazyComponent>
      )

    case 'token-price-chart':
      return (
        <LazyComponent type={type}>
          <TokenPriceChart
            projectId={props.projectId}
            chainId={props.chainId}
            range={props.range as '7d' | '30d' | '3m' | '1y' | 'all' | undefined}
            poolAddress={props.poolAddress}
            projectTokenAddress={props.projectTokenAddress}
          />
        </LazyComponent>
      )

    case 'pool-price-chart':
      return (
        <LazyComponent type={type}>
          <PoolPriceChart
            poolAddress={props.poolAddress}
            projectTokenAddress={props.projectTokenAddress}
            chainId={props.chainId}
            tokenSymbol={props.tokenSymbol}
            range={props.range as '7d' | '30d' | '3m' | '1y' | 'all' | undefined}
          />
        </LazyComponent>
      )

    case 'multi-chain-cash-out-chart':
      return (
        <LazyComponent type={type}>
          <MultiChainCashOutChart
            projectId={props.projectId}
            chainId={props.chainId}
            chains={props.chains}
            range={props.range as '7d' | '30d' | '3m' | '1y' | 'all' | undefined}
          />
        </LazyComponent>
      )

    case 'activity-feed':
      return (
        <LazyComponent type={type}>
          <ActivityFeed
            projectId={props.projectId}
            chainId={props.chainId}
            limit={props.limit ? parseInt(props.limit, 10) : undefined}
          />
        </LazyComponent>
      )

    case 'ruleset-schedule':
      return (
        <LazyComponent type={type}>
          <RulesetSchedule
            projectId={props.projectId}
            chainId={props.chainId}
          />
        </LazyComponent>
      )

    case 'options-picker':
      // Parse groups from JSON string if provided
      let parsedGroups
      let optionsParseError = false
      try {
        parsedGroups = props.groups
          ? (typeof props.groups === 'string' ? JSON.parse(props.groups) : props.groups)
          : []
      } catch {
        optionsParseError = true
        parsedGroups = []
      }
      // If no groups data at all, don't render anything (e.g., from exported markdown placeholder)
      if (!props.groups || parsedGroups.length === 0) {
        return null
      }
      if (optionsParseError) {
        return (
          <div className="glass p-3 text-red-400 text-sm">
            Failed to load options. Try asking again.
          </div>
        )
      }
      return (
        <LazyComponent type={type}>
          <OptionsPicker
            groups={parsedGroups}
            submitLabel={props.submitLabel}
            allSelectedLabel={props.allSelectedLabel}
          />
        </LazyComponent>
      )

    case 'project-chain-picker':
      return (
        <LazyComponent type={type}>
          <ProjectChainPicker
            projectId={props.projectId}
          />
        </LazyComponent>
      )

    case 'top-projects':
      return (
        <LazyComponent type={type}>
          <TopProjects
            limit={props.limit ? parseInt(props.limit, 10) : undefined}
            orderBy={props.orderBy as 'volume' | 'volumeUsd' | 'balance' | 'contributorsCount' | 'paymentsCount' | undefined}
          />
        </LazyComponent>
      )

    case 'nft-gallery':
      return (
        <LazyComponent type={type}>
          <NFTGallery
            projectId={props.projectId}
            chainId={props.chainId}
            columns={props.columns}
            showMintActions={props.showMintActions}
          />
        </LazyComponent>
      )

    case 'nft-card':
      return (
        <LazyComponent type={type}>
          <NFTCard
            projectId={props.projectId}
            tierId={props.tierId}
            chainId={props.chainId}
          />
        </LazyComponent>
      )

    case 'storefront':
      return (
        <LazyComponent type={type}>
          <Storefront
            projectId={props.projectId}
            chainId={props.chainId}
            sortBy={props.sortBy}
            filterCategory={props.filterCategory}
            showSoldOut={props.showSoldOut}
          />
        </LazyComponent>
      )

    case 'landing-page-preview':
      return (
        <LazyComponent type={type}>
          <LandingPagePreview
            projectId={props.projectId}
            chainId={props.chainId}
            layout={props.layout}
            showComponents={props.showComponents}
            title={props.title}
            subtitle={props.subtitle}
          />
        </LazyComponent>
      )

    case 'success-visualization':
      return (
        <LazyComponent type={type}>
          <SuccessVisualization
            targetRaise={props.targetRaise}
            supporterCount={props.supporterCount}
            timeframe={props.timeframe}
            growthRate={props.growthRate}
            avgContribution={props.avgContribution}
          />
        </LazyComponent>
      )

    default:
      return (
        <div className="glass p-3 text-gray-400 text-sm">
          Unknown component: {type}
        </div>
      )
  }
}
