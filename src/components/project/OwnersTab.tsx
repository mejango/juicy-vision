/**
 * Owners (revnet) / Tokens (custom) tab shell — 1:1 with website/src/discover.js
 * renderOwnersSection (:13921).
 *
 * Owns the token panel (ERC-20 facts + Deploy ERC-20/Edit CTA), the subtab row,
 * and subtab mounting. Subtabs build lazily on first open and stay mounted (but
 * hidden) after, so each pane's reads fire once. Only the Accounts subtab is
 * rendered here; every other subtab comes from the dashboard via `renderSubtab`.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useThemeStore } from '../../stores'
import { CHAINS } from '../../constants'
import { ownersSubtabsFor, type OwnersSubtabId } from './flavor'
import type { Project } from '../../services/bendystraw'
import { AccountsSubtab } from './owners/AccountsSubtab'

export interface OwnersTabProps {
  project: Project
  /** The sucker-group chains the project lives on (home chain first). */
  chainIds: number[]
  /** Per-chain project ids (V6 ids differ per chain). */
  chainProjects?: Array<{ chainId: number; projectId: number | string }>
  isRevnet: boolean
  /** True once the project's ERC-20 is deployed (drives the Market subtab + token panel). */
  hasErc20: boolean
  /** Deployed ERC-20 facts for the token panel (JB omnichain ERC-20s share one address on every chain). */
  erc20Address?: `0x${string}` | null
  tokenName?: string | null
  /** Initial subtab (e.g. parsed from the URL hash); defaults to Accounts. */
  initialSubtab?: OwnersSubtabId | null
  /** Fired on subtab switches so the dashboard can reflect the URL hash. */
  onSubtabChange?: (id: OwnersSubtabId) => void
  /** Renders every subtab other than 'accounts' (market/settlement/splits/reserved/autoissuance/loans). */
  renderSubtab: (id: Exclude<OwnersSubtabId, 'accounts'>) => ReactNode
  /** Token panel CTA — permission requirements are stated inside the modal, not by hiding the entry point. */
  onDeployErc20: () => void
  onEditToken: () => void
  // Accounts-subtab wallet actions (the dashboard owns the modals + availability).
  onCashOut: () => void
  onOpenLoan?: () => void
  loanAvailable?: boolean
  onMoveChains?: () => void
  moveChainsAvailable?: boolean
  onAddLiquidity?: () => void
  addLiquidityAvailable?: boolean
  onConnectWallet?: () => void
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export default function OwnersTab({
  project,
  chainIds,
  chainProjects,
  isRevnet,
  hasErc20,
  erc20Address,
  tokenName,
  initialSubtab,
  onSubtabChange,
  renderSubtab,
  onDeployErc20,
  onEditToken,
  onCashOut,
  onOpenLoan,
  loanAvailable,
  onMoveChains,
  moveChainsAvailable,
  onAddLiquidity,
  addLiquidityAvailable,
  onConnectWallet,
}: OwnersTabProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const subtabs = useMemo(
    () => ownersSubtabsFor({ isRevnet, hasErc20, isMobile: false, hasShop: false }),
    [isRevnet, hasErc20],
  )

  const validInitial = subtabs.some(subtab => subtab.id === initialSubtab) ? (initialSubtab as OwnersSubtabId) : 'accounts'
  const [active, setActive] = useState<OwnersSubtabId>(validInitial)
  // Lazy build-and-keep, matching the website shell: a subtab mounts on first
  // open and stays mounted (hidden) after, so its fetches don't re-fire.
  const [visited, setVisited] = useState<OwnersSubtabId[]>([validInitial])

  const show = useCallback(
    (id: OwnersSubtabId) => {
      setActive(id)
      setVisited(previous => (previous.includes(id) ? previous : [...previous, id]))
      onSubtabChange?.(id)
    },
    [onSubtabChange],
  )

  // The Accounts holders-table "Market [AMM]" row jumps here via a window event.
  useEffect(() => {
    const handler = (event: Event) => {
      const target = (event as CustomEvent<string>).detail as OwnersSubtabId
      if (subtabs.some(subtab => subtab.id === target)) show(target)
    }
    window.addEventListener('juice:goto-owners-subtab', handler)
    return () => window.removeEventListener('juice:goto-owners-subtab', handler)
  }, [subtabs, show])

  const keyText = isDark ? 'text-gray-500' : 'text-gray-400'
  const valueText = isDark ? 'text-gray-200' : 'text-gray-800'

  const tokenSegment = (key: string, value: ReactNode) => (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className={`text-xs ${keyText}`}>{key}:</span>
      <span className={`text-sm ${valueText}`}>{value}</span>
    </span>
  )

  return (
    <div className="space-y-4">
      {/* Token panel — name / symbol / address per chain + Deploy ERC-20/Edit CTA. */}
      <div className={`border p-4 ${isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'}`}>
        <div className={`text-xs font-medium uppercase tracking-wide mb-3 ${keyText}`}>Token</div>
        {!hasErc20 ? (
          <div>
            <div className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>No ERC-20 yet</div>
            <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
              Project balances remain internal Juicebox credits and can still be cashed out. Deploying an
              ERC-20 makes them claimable as a transferable token and enables market liquidity.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
            {tokenSegment('Name', tokenName || project.tokenSymbol || 'Token')}
            {project.tokenSymbol ? tokenSegment('Symbol', project.tokenSymbol) : null}
            {tokenSegment('Type', 'ERC-20')}
            {erc20Address
              ? tokenSegment(
                  'Address',
                  <span className="font-mono" title={erc20Address}>
                    {shortAddress(erc20Address)}
                  </span>,
                )
              : null}
            {erc20Address && chainIds.length ? (
              tokenSegment(
                'On',
                <span className="inline-flex flex-wrap gap-1.5">
                  {chainIds.map(chainId => {
                    const chain = CHAINS[chainId]
                    if (!chain) return null
                    return (
                      <a
                        key={chainId}
                        href={`${chain.explorer}/address/${erc20Address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`${erc20Address} on ${chain.name}`}
                        className={`px-1.5 py-0.5 text-xs border transition-colors ${
                          isDark
                            ? 'border-white/15 text-gray-300 hover:border-white/40'
                            : 'border-gray-200 text-gray-600 hover:border-gray-400'
                        }`}
                      >
                        {chain.shortName}
                      </a>
                    )
                  })}
                </span>,
              )
            ) : null}
          </div>
        )}
        <div className="mt-3">
          <button
            onClick={hasErc20 ? onEditToken : onDeployErc20}
            title={hasErc20 ? 'Edit the token name & symbol' : 'Deploy a transferable ERC-20 for this project'}
            className={`text-sm underline decoration-dotted underline-offset-2 transition-colors ${
              isDark ? 'text-juice-cyan hover:text-white' : 'text-cyan-700 hover:text-gray-900'
            }`}
          >
            {hasErc20 ? 'Edit' : 'Deploy ERC-20'}
          </button>
        </div>
      </div>

      {/* Subtab row */}
      <div className={`flex flex-wrap gap-1 border-b pb-px ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
        {subtabs.map(subtab => (
          <button
            key={subtab.id}
            onClick={() => show(subtab.id)}
            className={`px-3 py-1.5 text-sm -mb-px border-b-2 transition-colors ${
              active === subtab.id
                ? `border-juice-cyan font-medium ${isDark ? 'text-white' : 'text-gray-900'}`
                : `border-transparent ${
                    isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-800'
                  }`
            }`}
          >
            {subtab.label}
          </button>
        ))}
      </div>

      {/* Subtab content — visited panes stay mounted so their reads only fire once. */}
      {visited.map(id => (
        <div key={id} className={id === active ? '' : 'hidden'}>
          {id === 'accounts' ? (
            <AccountsSubtab
              project={project}
              chainIds={chainIds}
              chainProjects={chainProjects}
              isRevnet={isRevnet}
              hasErc20={hasErc20}
              onCashOut={onCashOut}
              onOpenLoan={onOpenLoan}
              loanAvailable={loanAvailable}
              onMoveChains={onMoveChains}
              moveChainsAvailable={moveChainsAvailable}
              onAddLiquidity={onAddLiquidity}
              addLiquidityAvailable={addLiquidityAvailable}
              onConnectWallet={onConnectWallet}
            />
          ) : (
            renderSubtab(id as Exclude<OwnersSubtabId, 'accounts'>)
          )}
        </div>
      ))}
    </div>
  )
}
