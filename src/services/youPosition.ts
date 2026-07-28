/**
 * "You" position data layer for the Owners/Tokens tab's Accounts subtab.
 *
 * Per chain, the connected wallet's stake in a project read straight from the
 * deployed V6 contract graph:
 *   - JBTokens.totalBalanceOf / creditBalanceOf (credits + claimed ERC-20)
 *   - controller.totalTokenSupplyWithReservedTokensOf (cash-out denominator,
 *     used as a sanity guard on the balance)
 *   - JBTerminalStore.currentReclaimableSurplusOf (live cash-out value in the
 *     accounting token; internally surplus-net-of-payout-limits — the V6 store
 *     exposes only the terminals/tokens overload, which folds the
 *     currentSurplusOf read into the same call)
 *   - REVLoans.borrowableAmountFrom (revnets only; 0 while the cash-out delay
 *     is active)
 *   - REVOwner.cashOutDelayOf (revnets only; the loans/cash-outs unlock time)
 *
 * Null-tolerant per chain: any failed read yields null for that field (the UI
 * renders an em dash), never a fake zero. Cross-chain totals must only be
 * produced when every row read successfully — see the total helpers below.
 */

import { zeroAddress, type Address, type PublicClient } from 'viem'
import {
  jbContractAddress,
  jbControllerAbi,
  jbDirectoryAbi,
  jbMultiTerminalAbi,
  jbTerminalStoreAbi,
  jbTokensAbi,
  type JBChainId,
} from '@bananapus/nana-sdk-core'
import {
  getAccountingContexts,
  getBorrowableAmount,
  getCashOutDelay,
  getCreditBalance,
} from '@bananapus/nana-sdk-core/v6'
import { NATIVE_TOKEN, USDC_ADDRESSES, type SupportedChainId } from '../constants'
import { cashOutProtocolFee } from '../utils/terminalPreview'
import { publicClientFor } from './projectTx'

/** The accounting token a chain's monetary values (cash out, loan) are denominated in. */
export interface YouAccountingToken {
  token: Address
  /** Display unit: 'ETH', 'USDC', or 'TOKEN' for unrecognized accounting ERC-20s. */
  symbol: string
  decimals: number
  /** The raw accounting-context currency id (uint32), as terminal-store reads expect. */
  currency: number
}

export interface YouPositionRow {
  chainId: number
  /** JBTokens.totalBalanceOf — credits + claimed ERC-20. null = unreadable. */
  balance: bigint | null
  /** Unclaimed internal credits (JBTokens.creditBalanceOf). */
  creditBalance: bigint | null
  /** balance − creditBalance; null when either side is unreadable. */
  erc20Balance: bigint | null
  /**
   * What `balance` reclaims right now, in the accounting token's units, NET of
   * the 2.5% protocol fee where it applies (tax != 0 fees the whole reclaim;
   * tax == 0 fees only min(reclaim, feeFreeSurplusOf)). null = unreadable —
   * including when the fee inputs can't be read; never a gross value posing
   * as spendable.
   */
  cashOutValue: bigint | null
  /**
   * Whether this chain's ruleset scopes cash-outs to LOCAL balances. When
   * false the per-chain quote prices against the omnichain surplus, so
   * summing per-chain quotes double counts — the total must be suppressed.
   * null = ruleset unreadable.
   */
  cashOutScopedToLocal: boolean | null
  /** REVLoans borrowable-now against `balance`. null = no loans on this chain / unreadable. */
  maxLoan: bigint | null
  /** Cash-out delay unlock timestamp (unix seconds). 0 or past = unlocked. */
  lockedUntil: bigint | null
  accountingToken: YouAccountingToken | null
}

/** The minimal project facts the loader needs. */
export interface YouPositionProject {
  /** Loans + cash-out delay are revnet features; skip those reads otherwise. */
  isRevnet?: boolean
}

/**
 * A chain the project lives on, with the project's id ON THAT CHAIN. V6 project
 * ids are independent per chain, so every per-chain read must use the id for
 * that specific chain — never the home id everywhere.
 */
export interface YouPositionChain {
  chainId: number
  projectId: number | string
}

/** Injectable for tests: swap the RPC client factory without touching the network. */
export interface YouPositionDeps {
  clientFor?: (chainId: number) => PublicClient
}

function v6AddressOf(contract: keyof (typeof jbContractAddress)['6'], chainId: number): Address | null {
  const byChain = jbContractAddress['6'][contract] as Record<string, Address> | undefined
  return byChain?.[String(chainId)] ?? null
}

/** Whether REVLoans is deployed on a chain (a missing deployment renders "—", not 0). */
export function hasRevLoans(chainId: number): boolean {
  return v6AddressOf('REVLoans', chainId) !== null
}

/**
 * Derive the display unit for an on-chain accounting context. Accounting-context
 * currency ids are uint32(uint160(token)) — NOT the 1/2 protocol denominations —
 * so recognition goes by token address: proven native → ETH, canonical USDC → USDC.
 */
export function describeAccountingToken(
  chainId: number,
  context: { token: Address; decimals: number; currency: number },
): YouAccountingToken {
  const token = context.token.toLowerCase()
  let symbol = 'TOKEN'
  if (token === NATIVE_TOKEN.toLowerCase()) symbol = 'ETH'
  else if (token === USDC_ADDRESSES[chainId as SupportedChainId]?.toLowerCase()) symbol = 'USDC'
  return { token: context.token, symbol, decimals: context.decimals, currency: context.currency }
}

/**
 * Whether the revnet's cash-out delay is still active. The delay gates BOTH
 * direct cash outs (REVOwner reverts) and loans (borrowableAmountFrom returns
 * 0); the cash-out *value* still computes, so the UI shows it marked locked.
 */
export function isCashOutLocked(
  lockedUntil: bigint | null | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  return lockedUntil != null && lockedUntil > 0n && lockedUntil > BigInt(nowSeconds)
}

function emptyRow(chainId: number): YouPositionRow {
  return {
    chainId,
    balance: null,
    creditBalance: null,
    erc20Balance: null,
    cashOutValue: null,
    cashOutScopedToLocal: null,
    maxLoan: null,
    lockedUntil: null,
    accountingToken: null,
  }
}

async function loadChainPosition(
  projectId: bigint,
  isRevnet: boolean | undefined,
  chainId: number,
  account: Address,
  clientFor: (chainId: number) => PublicClient,
): Promise<YouPositionRow> {
  let client: PublicClient
  try {
    client = clientFor(chainId)
  } catch {
    return emptyRow(chainId)
  }

  const cid = chainId as JBChainId
  const jbTokens = v6AddressOf('JBTokens', chainId)
  const jbDirectory = v6AddressOf('JBDirectory', chainId)

  // The cash-out denominator lives on the project's ACTUAL controller (pending
  // reserved tokens are controller storage), so resolve it from the directory.
  const controllerJob: Promise<Address | null> = (async () => {
    if (!jbDirectory) return null
    const controller = await client.readContract({
      address: jbDirectory,
      abi: jbDirectoryAbi,
      functionName: 'controllerOf',
      args: [projectId],
    })
    return !controller || controller === zeroAddress ? null : controller
  })().catch(() => null)

  const supplyJob: Promise<bigint | null> = controllerJob
    .then(controller =>
      controller
        ? client.readContract({
            address: controller,
            abi: jbControllerAbi,
            functionName: 'totalTokenSupplyWithReservedTokensOf',
            args: [projectId],
          })
        : null,
    )
    .catch(() => null)

  // The live ruleset metadata prices the protocol fee (cashOutTaxRate) and
  // says whether cash-outs are scoped to this chain's local balances.
  const rulesetJob: Promise<{ cashOutTaxRate: bigint; scopeCashOutsToLocalBalances: boolean } | null> =
    controllerJob
      .then(async controller => {
        if (!controller) return null
        const [, metadata] = await client.readContract({
          address: controller,
          abi: jbControllerAbi,
          functionName: 'currentRulesetOf',
          args: [projectId],
        })
        return {
          cashOutTaxRate: BigInt(metadata.cashOutTaxRate),
          scopeCashOutsToLocalBalances: Boolean(metadata.scopeCashOutsToLocalBalances),
        }
      })
      .catch(() => null)

  const [balance, creditBalance, supply, ruleset, accountingToken, lockedUntil] = await Promise.all([
    jbTokens
      ? client
          .readContract({
            address: jbTokens,
            abi: jbTokensAbi,
            functionName: 'totalBalanceOf',
            args: [account, projectId],
          })
          .catch(() => null)
      : Promise.resolve(null),
    getCreditBalance(client, { chainId: cid, projectId, holder: account }).catch(() => null),
    supplyJob,
    rulesetJob,
    getAccountingContexts(client, { chainId: cid, projectId })
      .then(contexts => (contexts.length ? describeAccountingToken(chainId, contexts[0]) : null))
      .catch(() => null),
    isRevnet
      ? getCashOutDelay(client, { chainId: cid, revnetId: projectId }).catch(() => null)
      : Promise.resolve(null),
  ])

  // Claimed ERC-20 portion. A credit balance exceeding the total balance means
  // the two reads straddled a state change — treat the split as unknown.
  const erc20Balance =
    balance != null && creditBalance != null && balance >= creditBalance ? balance - creditBalance : null

  // Cash out value: what `balance` tokens reclaim now, in the accounting token.
  // Guarded by the supply read so a nonsense balance > supply never queries the
  // store with arguments the contract math would misprice. The gross reclaim is
  // then netted of the protocol fee — an ambient "worth now" figure that
  // ignores the 2.5% fee overstates what the wallet can actually take out.
  const cashOutScopedToLocal = ruleset ? ruleset.scopeCashOutsToLocalBalances : null
  let cashOutValue: bigint | null = null
  if (balance != null) {
    if (balance === 0n) {
      cashOutValue = 0n
    } else if (supply != null && supply >= balance && accountingToken) {
      const store = v6AddressOf('JBTerminalStore', chainId)
      const gross = store
        ? await client
            .readContract({
              address: store,
              abi: jbTerminalStoreAbi,
              functionName: 'currentReclaimableSurplusOf',
              args: [
                projectId,
                balance,
                [],
                [accountingToken.token],
                BigInt(accountingToken.decimals),
                BigInt(accountingToken.currency),
              ],
            })
            .catch(() => null)
        : null
      if (gross != null && gross === 0n) {
        cashOutValue = 0n
      } else if (gross != null && ruleset) {
        // feeFreeSurplusOf reduces the fee ONLY on zero-tax rulesets, so it is
        // read only then — from the project's primary terminal for the token.
        let feeFreeSurplus: bigint | null = 0n
        if (ruleset.cashOutTaxRate === 0n) {
          feeFreeSurplus = await (async () => {
            if (!jbDirectory) return null
            const terminal = await client.readContract({
              address: jbDirectory,
              abi: jbDirectoryAbi,
              functionName: 'primaryTerminalOf',
              args: [projectId, accountingToken.token],
            })
            if (!terminal || terminal === zeroAddress) return null
            return client.readContract({
              address: terminal,
              abi: jbMultiTerminalAbi,
              functionName: 'feeFreeSurplusOf',
              args: [projectId, accountingToken.token],
            })
          })().catch(() => null)
        }
        cashOutValue =
          feeFreeSurplus == null
            ? null
            : gross -
              cashOutProtocolFee({
                reclaimAmount: gross,
                cashOutTaxRate: ruleset.cashOutTaxRate,
                beneficiaryIsFeeless: false,
                feeFreeSurplus,
              })
      }
    }
  }

  // Max loan (revnets only), in the accounting token's exact decimals/currency.
  // Returns 0 while the cash-out delay is active — the UI substitutes the
  // cash-out value as the would-be loan in that state.
  let maxLoan: bigint | null = null
  if (isRevnet && hasRevLoans(chainId) && balance != null && accountingToken) {
    maxLoan =
      balance === 0n
        ? 0n
        : await getBorrowableAmount(client, {
            chainId: cid,
            revnetId: projectId,
            collateralCount: balance,
            decimals: BigInt(accountingToken.decimals),
            currency: BigInt(accountingToken.currency),
          })
            .then(result => result.borrowableNow)
            .catch(() => null)
  }

  return {
    chainId,
    balance,
    creditBalance,
    erc20Balance,
    cashOutValue,
    cashOutScopedToLocal,
    maxLoan,
    lockedUntil,
    accountingToken,
  }
}

/**
 * Load the connected wallet's per-chain position. One row per requested chain,
 * in order; a chain whose reads fail produces a row of nulls (never zeros).
 *
 * Each chain is read with ITS OWN project id (V6 ids are independent per chain),
 * so a linked deployment with a divergent id on some chain is never read against
 * the home id — which would target the wrong project entirely.
 */
export async function loadYouPosition(
  project: YouPositionProject,
  chains: readonly YouPositionChain[],
  account: Address,
  deps: YouPositionDeps = {},
): Promise<YouPositionRow[]> {
  const clientFor = deps.clientFor ?? (publicClientFor as (chainId: number) => PublicClient)
  return Promise.all(
    chains.map(chain => loadChainPosition(BigInt(chain.projectId), project.isRevnet, chain.chainId, account, clientFor)),
  )
}

/** Sum a token-count field across rows — only when EVERY row produced it. */
export function totalIfComplete(
  rows: YouPositionRow[],
  field: 'balance' | 'creditBalance' | 'erc20Balance',
): bigint | null {
  if (!rows.length || rows.some(row => row[field] == null)) return null
  return rows.reduce((sum, row) => sum + (row[field] as bigint), 0n)
}

/**
 * Sum a monetary field across rows. Valid only when every row produced the
 * value AND every row denominates it in the same unit (symbol + decimals —
 * canonical USDC addresses differ per chain, so the derived unit is the key).
 * Anything else returns null; never label a partial total with one row's token.
 */
export function monetaryTotalIfComplete(
  rows: YouPositionRow[],
  field: 'cashOutValue' | 'maxLoan',
): bigint | null {
  if (!rows.length) return null
  // When cash-outs are NOT scoped to local balances, every chain quotes
  // against the shared omnichain surplus — the per-chain estimates are each
  // "what this chain would pay alone" and summing them prices phantom value.
  // Show the per-chain rows, never a total.
  if (field === 'cashOutValue' && rows.some(row => row.cashOutScopedToLocal !== true)) {
    return null
  }
  const first = rows[0].accountingToken
  if (!first) return null
  const unit = `${first.symbol}@${first.decimals}`
  for (const row of rows) {
    if (row[field] == null || !row.accountingToken) return null
    if (`${row.accountingToken.symbol}@${row.accountingToken.decimals}` !== unit) return null
  }
  return rows.reduce((sum, row) => sum + (row[field] as bigint), 0n)
}
