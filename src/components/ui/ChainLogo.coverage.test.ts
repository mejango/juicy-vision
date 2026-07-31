/**
 * Source-level guard: every screen that NAMES a chain shows that chain's brand
 * mark beside the name. Chain choice moves money and the testnet names differ
 * by one word ("Base Sepolia" vs "OP Sepolia"), so the mark is the fast
 * disambiguator.
 *
 * The files listed here have no component test of their own — they carry heavy
 * wallet / router / query / SDK dependencies that make a jsdom mount
 * impractical. Everything that CAN be mounted asserts on the rendered JSX in
 * its own test file instead; this guard only stops a chain-naming site from
 * silently losing its mark in a refactor.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const read = (relativePath: string) => readFileSync(resolve(SRC, relativePath), 'utf8')

const FILES_NAMING_CHAINS = [
  'components/chat/ChatHistorySidebar.tsx',
  'components/dynamic/ProjectCard.tsx',
  'components/dynamic/ProjectChainPicker.tsx',
  'components/dynamic/ProjectSplitRoute.tsx',
  'components/dynamic/RulesetSchedule.tsx',
  'components/dynamic/ShopTab.tsx',
  'components/dynamic/TierDetailModal.tsx',
  'components/dynamic/charts/ChainToggleBar.tsx',
  'components/dynamic/create-flow/pickers.tsx',
  'components/dynamic/create-flow/StepDeploy.tsx',
  'components/project/ExtrasTab.tsx',
  'components/project/FundsTab.tsx',
  'components/project/OverviewTab.tsx',
  'components/project/OwnersTab.tsx',
  'components/project/PerChainAddressControl.tsx',
  'components/project/backoffice/AccountCard.tsx',
  'components/project/backoffice/PowersCard.tsx',
  'components/project/backoffice/shared.tsx',
  'components/project/owners/AccountsSubtab.tsx',
  'components/project/owners/AutoIssuanceSubtab.tsx',
  'components/project/owners/ClaimCreditsModal.tsx',
  'components/project/owners/MarketSubtab.tsx',
  'components/project/owners/SettlementSubtab.tsx',
  'components/project/owners/SplitsSubtab.tsx',
  'components/ui/SupplyBadge.tsx',
  'components/wallet/WalletPanel.tsx',
  'admin/pages/QueuedPaymentsPage.tsx',
  'pages/AccountView.tsx',
  'pages/ProjectDashboard.tsx',
  'pages/pay/PaymentPage.tsx',
]

/**
 * The native `<select>` chain pickers. An `<option>` cannot hold an image, and
 * these must STAY native selects: a custom listbox portals to document.body and
 * goes inert inside the app's native `<dialog>` modals (see
 * scripts/check-source-invariants.mjs). So the mark sits beside the select and
 * tracks the current selection.
 *
 * [path relative to src/, minimum number of ChainLogo usages]
 */
const SELECT_PICKERS: [string, number][] = [
  ['components/dynamic/NoteCard.tsx', 1],
  ['components/dynamic/create-flow/StepStages.tsx', 1],
  ['components/project/RulesetsTab.tsx', 1],
  ['components/project/owners/AddLiquidityModal.tsx', 1],
  ['components/project/owners/MoveChainsModal.tsx', 2],
  ['components/project/owners/OpenLoanModal.tsx', 1],
  ['components/project/owners/RemoveLiquidityModal.tsx', 1],
  ['components/project/shop/RedeemItemsModal.tsx', 1],
  ['pages/merchant/TerminalsPage.tsx', 2],
]

const ALL_FILES = [...FILES_NAMING_CHAINS, ...SELECT_PICKERS.map(([path]) => path)]

describe('chain logo coverage', () => {
  it.each(ALL_FILES)('%s marks the chain it names', path => {
    const source = read(path)
    expect(source).toContain('<ChainLogo')
    expect(source).toMatch(/import ChainLogo from ['"][^'"]*\/ChainLogo['"]/)
  })
})

describe('native select chain pickers', () => {
  it.each(SELECT_PICKERS)('%s marks each of its %i chain select(s)', (path, minimum) => {
    const uses = read(path).match(/<ChainLogo\b/g) || []
    expect(uses.length).toBeGreaterThanOrEqual(minimum)
  })

  it.each(SELECT_PICKERS)('%s never puts a ChainLogo inside an <option>', path => {
    for (const option of read(path).match(/<option\b[\s\S]*?<\/option>/g) || []) {
      expect(option).not.toContain('<ChainLogo')
    }
  })

  it.each(SELECT_PICKERS)('%s does not reach a document.body portal', path => {
    expect(read(path)).not.toContain('createPortal')
  })
})
