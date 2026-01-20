import { ParsedComponent } from '../../utils/messageParser'
import ConnectWalletButton from './ConnectWalletButton'
import ProjectCard from './ProjectCard'
import TransactionStatus from './TransactionStatus'
import TransactionPreview from './TransactionPreview'
import CashOutForm from './CashOutForm'
import SendPayoutsForm from './SendPayoutsForm'
import SendReservedTokensForm from './SendReservedTokensForm'
import UseSurplusAllowanceForm from './UseSurplusAllowanceForm'
import DeployERC20Form from './DeployERC20Form'
import QueueRulesetForm from './QueueRulesetForm'
import RecommendationChips from './RecommendationChips'
import PriceChart from './PriceChart'
import ActivityFeed from './ActivityFeed'
import RulesetSchedule from './RulesetSchedule'
import { BalanceChart, HoldersChart, VolumeChart, TokenPriceChart, PoolPriceChart, MultiChainCashOutChart } from './charts'
import OptionsPicker from './OptionsPicker'
import ProjectChainPicker from './ProjectChainPicker'
import TopProjects from './TopProjects'
import NFTGallery from './NFTGallery'
import NFTCard from './NFTCard'
import Storefront from './Storefront'
import LandingPagePreview from './LandingPagePreview'
import SuccessVisualization from './SuccessVisualization'

interface ComponentRegistryProps {
  component: ParsedComponent
}

export default function ComponentRegistry({ component }: ComponentRegistryProps) {
  const { type, props } = component

  switch (type) {
    case '_loading':
      // Loading placeholder for components still being streamed
      // Don't show dots here - ThinkingIndicator already handles this
      return null

    case 'connect-wallet':
    case 'connect-account':
      return <ConnectWalletButton />

    case 'project-card':
      // ProjectCard has built-in chain selector, no need for separate ProjectSelector
      return (
        <ProjectCard
          projectId={props.projectId}
          chainId={props.chainId}
        />
      )

    case 'payment-form':
      // Deprecated: use project-card instead (has built-in payment)
      return (
        <ProjectCard
          projectId={props.projectId}
          chainId={props.chainId}
        />
      )

    case 'cash-out-form':
      return (
        <CashOutForm
          projectId={props.projectId}
          chainId={props.chainId}
        />
      )

    case 'send-payouts-form':
      return (
        <SendPayoutsForm
          projectId={props.projectId}
          chainId={props.chainId}
        />
      )

    case 'send-reserved-tokens-form':
      return (
        <SendReservedTokensForm
          projectId={props.projectId}
          chainId={props.chainId}
        />
      )

    case 'use-surplus-allowance-form':
      return (
        <UseSurplusAllowanceForm
          projectId={props.projectId}
          chainId={props.chainId}
        />
      )

    case 'deploy-erc20-form':
      return (
        <DeployERC20Form
          projectId={props.projectId}
          chainId={props.chainId}
        />
      )

    case 'queue-ruleset-form':
      return (
        <QueueRulesetForm
          projectId={props.projectId}
          chainId={props.chainId}
        />
      )

    case 'transaction-status':
      return <TransactionStatus txId={props.txId} />

    case 'transaction-preview':
      return (
        <TransactionPreview
          action={props.action}
          contract={props.contract}
          chainId={props.chainId}
          projectId={props.projectId}
          parameters={props.parameters}
          explanation={props.explanation}
        />
      )

    case 'recommendation-chips':
      // Parse chips from JSON string if provided
      let parsedChips
      let chipsParseError = false
      try {
        parsedChips = props.chips
          ? (typeof props.chips === 'string' ? JSON.parse(props.chips) : props.chips)
          : undefined
      } catch {
        // JSON not yet complete during streaming - check if it looks incomplete
        const chipsStr = props.chips || ''
        if (chipsStr.includes('{') && !chipsStr.endsWith(']')) {
          // Incomplete JSON - still streaming
          return (
            <div className="glass p-3 text-gray-400 text-sm animate-pulse">
              Loading suggestions...
            </div>
          )
        }
        chipsParseError = true
      }
      if (chipsParseError) {
        return (
          <div className="glass p-3 text-red-400 text-sm">
            Failed to load suggestions. Try asking again.
          </div>
        )
      }
      return (
        <RecommendationChips
          chips={parsedChips}
          onSelect={(prompt) => {
            window.dispatchEvent(new CustomEvent('juice:send-message', { detail: { message: prompt } }))
          }}
        />
      )

    case 'price-chart':
      return (
        <PriceChart
          projectId={props.projectId}
          chainId={props.chainId}
          range={props.range as '1y' | '5y' | '10y' | 'all' | undefined}
        />
      )

    case 'balance-chart':
      return (
        <BalanceChart
          projectId={props.projectId}
          chainId={props.chainId}
          range={props.range as '7d' | '30d' | '90d' | '1y' | 'all' | undefined}
        />
      )

    case 'holders-chart':
      return (
        <HoldersChart
          projectId={props.projectId}
          chainId={props.chainId}
          limit={props.limit ? parseInt(props.limit, 10) : undefined}
        />
      )

    case 'volume-chart':
      return (
        <VolumeChart
          projectId={props.projectId}
          chainId={props.chainId}
          range={props.range as '7d' | '30d' | '90d' | '1y' | 'all' | undefined}
        />
      )

    case 'token-price-chart':
      return (
        <TokenPriceChart
          projectId={props.projectId}
          chainId={props.chainId}
          range={props.range as '7d' | '30d' | '3m' | '1y' | 'all' | undefined}
          poolAddress={props.poolAddress}
          projectTokenAddress={props.projectTokenAddress}
        />
      )

    case 'pool-price-chart':
      return (
        <PoolPriceChart
          poolAddress={props.poolAddress}
          projectTokenAddress={props.projectTokenAddress}
          chainId={props.chainId}
          tokenSymbol={props.tokenSymbol}
          range={props.range as '7d' | '30d' | '3m' | '1y' | 'all' | undefined}
        />
      )

    case 'multi-chain-cash-out-chart':
      return (
        <MultiChainCashOutChart
          projectId={props.projectId}
          chainId={props.chainId}
          chains={props.chains}
          range={props.range as '7d' | '30d' | '3m' | '1y' | 'all' | undefined}
        />
      )

    case 'activity-feed':
      return (
        <ActivityFeed
          projectId={props.projectId}
          chainId={props.chainId}
          limit={props.limit ? parseInt(props.limit, 10) : undefined}
        />
      )

    case 'ruleset-schedule':
      return (
        <RulesetSchedule
          projectId={props.projectId}
          chainId={props.chainId}
        />
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
        // JSON not yet complete during streaming - check if it looks like incomplete JSON
        const groupsStr = props.groups || ''
        if (groupsStr.includes('{') && !groupsStr.endsWith(']')) {
          // Incomplete JSON - still streaming
          return (
            <div className="glass p-3 text-gray-400 text-sm animate-pulse">
              Loading options...
            </div>
          )
        }
        optionsParseError = true
        parsedGroups = []
      }
      if (optionsParseError) {
        return (
          <div className="glass p-3 text-red-400 text-sm">
            Failed to load options. Try asking again.
          </div>
        )
      }
      return (
        <OptionsPicker
          groups={parsedGroups}
          submitLabel={props.submitLabel}
          allSelectedLabel={props.allSelectedLabel}
        />
      )

    case 'project-chain-picker':
      return (
        <ProjectChainPicker
          projectId={props.projectId}
        />
      )

    case 'top-projects':
      return (
        <TopProjects
          limit={props.limit ? parseInt(props.limit, 10) : undefined}
          orderBy={props.orderBy as 'volume' | 'volumeUsd' | 'balance' | 'contributorsCount' | 'paymentsCount' | undefined}
        />
      )

    case 'nft-gallery':
      return (
        <NFTGallery
          projectId={props.projectId}
          chainId={props.chainId}
          columns={props.columns}
          showMintActions={props.showMintActions}
        />
      )

    case 'nft-card':
      return (
        <NFTCard
          projectId={props.projectId}
          tierId={props.tierId}
          chainId={props.chainId}
        />
      )

    case 'storefront':
      return (
        <Storefront
          projectId={props.projectId}
          chainId={props.chainId}
          sortBy={props.sortBy}
          filterCategory={props.filterCategory}
          showSoldOut={props.showSoldOut}
        />
      )

    case 'landing-page-preview':
      return (
        <LandingPagePreview
          projectId={props.projectId}
          chainId={props.chainId}
          layout={props.layout}
          showComponents={props.showComponents}
          title={props.title}
          subtitle={props.subtitle}
        />
      )

    case 'success-visualization':
      return (
        <SuccessVisualization
          targetRaise={props.targetRaise}
          supporterCount={props.supporterCount}
          timeframe={props.timeframe}
          growthRate={props.growthRate}
          avgContribution={props.avgContribution}
        />
      )

    default:
      return (
        <div className="glass p-3 text-gray-400 text-sm">
          Unknown component: {type}
        </div>
      )
  }
}
