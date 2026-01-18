import { ParsedComponent } from '../../utils/messageParser'
import ConnectWalletButton from './ConnectWalletButton'
import ProjectCard from './ProjectCard'
import PaymentForm from './PaymentForm'
import TransactionStatus from './TransactionStatus'
import TransactionPreview from './TransactionPreview'
import CashOutForm from './CashOutForm'
import SendPayoutsForm from './SendPayoutsForm'
import RecommendationChips from './RecommendationChips'
import PriceChart from './PriceChart'
import ActivityFeed from './ActivityFeed'
import RulesetSchedule from './RulesetSchedule'
import { BalanceChart, HoldersChart, VolumeChart } from './charts'
import OptionsPicker from './OptionsPicker'
import ProjectChainPicker from './ProjectChainPicker'
import TopProjects from './TopProjects'

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
      return (
        <PaymentForm
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
      try {
        parsedChips = props.chips
          ? (typeof props.chips === 'string' ? JSON.parse(props.chips) : props.chips)
          : undefined
      } catch {
        // JSON not yet complete during streaming
        return null
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
          type={props.type as 'issuance' | 'cashout' | 'all' | undefined}
          range={props.range as '7d' | '30d' | '90d' | '1y' | 'all' | undefined}
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
      try {
        parsedGroups = props.groups
          ? (typeof props.groups === 'string' ? JSON.parse(props.groups) : props.groups)
          : []
        // Enable multiSelect for all groups so users can always provide more context
        parsedGroups = parsedGroups.map((g: Record<string, unknown>) => ({ ...g, multiSelect: true }))
      } catch {
        // JSON not yet complete during streaming
        return null
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

    default:
      return (
        <div className="glass p-3 text-gray-400 text-sm">
          Unknown component: {type}
        </div>
      )
  }
}
