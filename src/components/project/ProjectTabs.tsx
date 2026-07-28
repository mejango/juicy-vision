/**
 * The project page's tab bar + tab content — one component rendered by both the
 * desktop and mobile dashboard layouts, so the two can never drift.
 *
 * Tab sets and ordering are 1:1 with website/src/discover.js (:5361-5402) via
 * `projectTabsFor`; juicy's difference is the ExplainerMessage copy each tab
 * opens with. Actions are lifted to props so the dashboard keeps owning its
 * modal plumbing.
 */

import { lazy, Suspense, type ReactNode } from 'react'
import { useThemeStore } from '../../stores'
import { ExplainerMessage } from '../ui/ExplainerMessage'
import {
  ownersSubtabsFor,
  projectTabsFor,
  type OwnersSubtabId,
  type ProjectTabId,
} from './flavor'
import type { ConnectedChain, Project, SuckerGroupBalance } from '../../services/bendystraw'

// Tab bodies are heavy (charts, log scans, pool math) — only pay for the open one.
const OverviewTab = lazy(() => import('./OverviewTab'))
const TermsTab = lazy(() => import('./TermsTab'))
const RulesetsTab = lazy(() => import('./RulesetsTab'))
const FundsTab = lazy(() => import('./FundsTab'))
const OwnersTab = lazy(() => import('./OwnersTab'))
const ExtrasTab = lazy(() => import('./ExtrasTab'))
const BackOfficeTab = lazy(() => import('./BackOfficeTab'))
const SettlementSubtab = lazy(() => import('./owners/SettlementSubtab'))
const SplitsSubtab = lazy(() => import('./owners/SplitsSubtab').then(m => ({ default: m.SplitsSubtab })))
const AutoIssuanceSubtab = lazy(() => import('./owners/AutoIssuanceSubtab').then(m => ({ default: m.AutoIssuanceSubtab })))
const LoansSubtab = lazy(() => import('./owners/LoansSubtab').then(m => ({ default: m.LoansSubtab })))
const MarketSubtab = lazy(() => import('./owners/MarketSubtab'))

export interface ProjectTabsProps {
  project: Project
  projectId: number
  chainId: number
  connectedChains: ConnectedChain[]
  suckerGroupBalance?: SuckerGroupBalance | null
  isRevnet: boolean
  isMobile: boolean
  hasShop: boolean
  hasErc20: boolean
  erc20Address?: `0x${string}` | null
  /** Resolved revnet operator address — powers Overview's Operator row on revnets. */
  revnetOperator?: string | null
  canEdit: boolean
  activeTab: ProjectTabId
  onTabChange: (tab: ProjectTabId) => void
  ownersSubtab: OwnersSubtabId
  onOwnersSubtabChange: (id: OwnersSubtabId) => void
  /** The activity feed the mobile layout shows as its first tab. */
  activityFeed?: ReactNode
  /** Rendered at the top of Overview for revnets — the price chart. */
  priceChart?: ReactNode
  /** Rendered under Overview's description on both layouts. */
  summary?: ReactNode
  /** Rendered at the bottom of Funds — juicy-only volume/balance history. */
  fundsCharts?: ReactNode
  /** Rendered at the bottom of Rulesets — juicy-only issuance projection. */
  rulesetsChart?: ReactNode
  shop?: ReactNode
  onQueueRuleset: () => void
  onSendPayouts: (kindTokenAddress: string) => void
  onUseAllowance: (kindTokenAddress: string) => void
  onEditMetadata: () => void
  onEditToken: () => void
  /** Opens the splits editor for a browsed stage (start-order index); omitted = the current ruleset. */
  onEditSplits: (stageIndex?: number) => void
  onDeployErc20: () => void
  onCashOut: () => void
}

function TabFallback() {
  const isDark = useThemeStore(s => s.theme === 'dark')
  return (
    <div className={`py-10 text-center text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
      Loading…
    </div>
  )
}

export default function ProjectTabs(props: ProjectTabsProps) {
  const isDark = useThemeStore(s => s.theme === 'dark')
  const {
    project, projectId, chainId, connectedChains, isRevnet, isMobile,
    hasShop, hasErc20, erc20Address, canEdit, activeTab, onTabChange,
    ownersSubtab, onOwnersSubtabChange,
  } = props

  const tabs = projectTabsFor({ isRevnet, isMobile, hasShop, hasErc20 })
  const chainIds = connectedChains.length
    ? connectedChains.map(c => c.chainId)
    : [chainId]
  // Per-chain project ids (V6 ids are independent per chain) for subtabs that
  // read or transact on non-home chains.
  const chainProjects = connectedChains.length
    ? connectedChains.map(c => ({ chainId: c.chainId, projectId: c.projectId }))
    : [{ chainId, projectId: project.projectId }]

  // Loans need REVLoans (revnets only); moves and LP need a real ERC-20 to bridge/pair.
  const ownersAvailability = {
    loanAvailable: isRevnet,
    moveChainsAvailable: hasErc20 && chainIds.length > 1,
    addLiquidityAvailable: hasErc20,
  }

  const renderOwnersSubtab = (id: Exclude<OwnersSubtabId, 'accounts'>): ReactNode => {
    switch (id) {
      case 'market':
        return <MarketSubtab project={project} chainIds={chainIds} chainProjects={chainProjects} />
      case 'settlement':
        return <SettlementSubtab project={project} chainIds={chainIds} chainProjects={chainProjects} />
      case 'splits':
        return <SplitsSubtab project={project} chainIds={chainIds} chainProjects={chainProjects} variant="splits" onEditSplits={props.onEditSplits} />
      case 'reserved':
        return <SplitsSubtab project={project} chainIds={chainIds} chainProjects={chainProjects} variant="reserved" />
      case 'autoissuance':
        return <AutoIssuanceSubtab project={project} chainIds={chainIds} chainProjects={chainProjects} />
      case 'loans':
        return <LoansSubtab project={project} chainIds={chainIds} chainProjects={chainProjects} />
      default:
        return null
    }
  }

  const body = () => {
    switch (activeTab) {
      case 'activity':
        return props.activityFeed ?? null

      case 'overview':
        return (
          <OverviewTab
            project={project}
            chainId={chainId}
            projectId={projectId}
            connectedChains={connectedChains}
            isRevnet={isRevnet}
            canEdit={canEdit}
            revnetOperator={props.revnetOperator}
            onEditMetadata={props.onEditMetadata}
            priceChart={isRevnet ? props.priceChart : undefined}
            summary={props.summary}
          />
        )

      case 'terms':
        return (
          <div className="space-y-6">
            <ExplainerMessage>
              This is an autonomous revnet — its terms were locked in at launch and step
              through stages on their own. Nobody can change them, including the operator.
            </ExplainerMessage>
            <TermsTab
              projectId={projectId}
              chainId={chainId}
              connectedChains={connectedChains}
              tokenSymbol={project.tokenSymbol}
            />
          </div>
        )

      case 'rulesets':
        return (
          <div className="space-y-6">
            <RulesetsTab
              projectId={String(projectId)}
              chainId={String(chainId)}
              isRevnet={isRevnet}
              onQueueRuleset={props.onQueueRuleset}
              onEditSplits={() => props.onEditSplits()}
            />
            {props.rulesetsChart && (
              <>
                <ExplainerMessage>
                  Here's how access to membership changes over time based on issuance cuts.
                  Contributors from earlier windows get more than later ones.
                </ExplainerMessage>
                {props.rulesetsChart}
              </>
            )}
          </div>
        )

      case 'funds':
        return (
          <div className="space-y-6">
            <FundsTab
              project={project}
              isOwner={canEdit}
              onSendPayouts={props.onSendPayouts}
              onUseAllowance={props.onUseAllowance}
              onViewRulesets={() => onTabChange('rulesets')}
            />
            {props.fundsCharts}
          </div>
        )

      case 'owners':
      case 'tokens':
        return (
          <OwnersTab
            project={project}
            chainIds={chainIds}
            chainProjects={chainProjects}
            isRevnet={isRevnet}
            hasErc20={hasErc20}
            erc20Address={erc20Address}
            tokenName={project.tokenSymbol}
            initialSubtab={ownersSubtab}
            onSubtabChange={onOwnersSubtabChange}
            renderSubtab={renderOwnersSubtab}
            onDeployErc20={props.onDeployErc20}
            onEditToken={props.onEditToken}
            onCashOut={props.onCashOut}
            {...ownersAvailability}
          />
        )

      case 'shop':
        return props.shop ?? null

      case 'extras':
        return (
          <ExtrasTab
            projectId={String(projectId)}
            chainId={String(chainId)}
            tokenSymbol={project.tokenSymbol ?? undefined}
            connectedChains={connectedChains.map(c => ({ chainId: c.chainId, projectId: c.projectId }))}
          />
        )

      case 'backoffice':
        return (
          <BackOfficeTab
            project={project}
            projectId={projectId}
            chainIds={chainIds}
            chainProjects={chainProjects}
            isRevnet={isRevnet}
            onEditMetadata={props.onEditMetadata}
            onEditToken={props.onEditToken}
            onEditSplits={props.onEditSplits}
          />
        )

      default:
        return null
    }
  }

  return (
    <>
      <div className={`sticky top-0 z-10 ${isMobile ? 'px-4 pt-2' : 'px-6 pt-4'} pb-0 ${
        isDark ? 'bg-juice-dark' : 'bg-white'
      }`}>
        <div className={`flex gap-6 overflow-x-auto border-b ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`pb-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                activeTab === tab.id
                  ? 'border-juice-orange text-juice-orange'
                  : isDark
                    ? 'border-transparent text-gray-400 hover:text-gray-200'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`${isMobile ? 'px-4' : 'px-6'} py-6 space-y-6`}>
        <Suspense fallback={<TabFallback />}>{body()}</Suspense>
      </div>
    </>
  )
}

export { ownersSubtabsFor }
