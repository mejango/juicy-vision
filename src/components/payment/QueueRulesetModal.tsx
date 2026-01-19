import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useWallet, useClient } from '@getpara/react-sdk'
import { createParaViemClient } from '@getpara/viem-v2-integration'
import { encodeFunctionData, http, type Chain } from 'viem'
import { mainnet, optimism, base, arbitrum } from 'viem/chains'
import { useThemeStore, useTransactionStore } from '../../stores'
import { useWalletBalances, formatEthBalance } from '../../hooks'
import { type JBRulesetConfig } from '../../services/relayr'

// Contract constants - JBController5_1
const JB_CONTROLLER = '0xf3cc99b11bd73a2e3b8815fb85fe0381b29987e1' as const

// ABI for queueRulesetsOf
const CONTROLLER_QUEUE_RULESETS_ABI = [
  {
    name: 'queueRulesetsOf',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      {
        name: 'rulesetConfigurations',
        type: 'tuple[]',
        components: [
          { name: 'mustStartAtOrAfter', type: 'uint48' },
          { name: 'duration', type: 'uint32' },
          { name: 'weight', type: 'uint112' },
          { name: 'weightCutPercent', type: 'uint32' },
          { name: 'approvalHook', type: 'address' },
          {
            name: 'metadata',
            type: 'tuple',
            components: [
              { name: 'reservedPercent', type: 'uint16' },
              { name: 'cashOutTaxRate', type: 'uint16' },
              { name: 'baseCurrency', type: 'uint32' },
              { name: 'pausePay', type: 'bool' },
              { name: 'pauseCreditTransfers', type: 'bool' },
              { name: 'allowOwnerMinting', type: 'bool' },
              { name: 'allowSetCustomToken', type: 'bool' },
              { name: 'allowTerminalMigration', type: 'bool' },
              { name: 'allowSetTerminals', type: 'bool' },
              { name: 'allowSetController', type: 'bool' },
              { name: 'allowAddAccountingContext', type: 'bool' },
              { name: 'allowAddPriceFeed', type: 'bool' },
              { name: 'ownerMustSendPayouts', type: 'bool' },
              { name: 'holdFees', type: 'bool' },
              { name: 'useTotalSurplusForCashOuts', type: 'bool' },
              { name: 'useDataHookForPay', type: 'bool' },
              { name: 'useDataHookForCashOut', type: 'bool' },
              { name: 'dataHook', type: 'address' },
              { name: 'metadata', type: 'uint16' },
            ],
          },
          {
            name: 'splitGroups',
            type: 'tuple[]',
            components: [
              { name: 'groupId', type: 'uint256' },
              {
                name: 'splits',
                type: 'tuple[]',
                components: [
                  { name: 'percent', type: 'uint32' },
                  { name: 'projectId', type: 'uint64' },
                  { name: 'beneficiary', type: 'address' },
                  { name: 'preferAddToBalance', type: 'bool' },
                  { name: 'lockedUntil', type: 'uint48' },
                  { name: 'hook', type: 'address' },
                ],
              },
            ],
          },
          {
            name: 'fundAccessLimitGroups',
            type: 'tuple[]',
            components: [
              { name: 'terminal', type: 'address' },
              { name: 'token', type: 'address' },
              {
                name: 'payoutLimits',
                type: 'tuple[]',
                components: [
                  { name: 'amount', type: 'uint224' },
                  { name: 'currency', type: 'uint32' },
                ],
              },
              {
                name: 'surplusAllowances',
                type: 'tuple[]',
                components: [
                  { name: 'amount', type: 'uint224' },
                  { name: 'currency', type: 'uint32' },
                ],
              },
            ],
          },
        ],
      },
      { name: 'memo', type: 'string' },
    ],
    outputs: [{ name: 'rulesetId', type: 'uint256' }],
  },
] as const

const CHAINS: Record<number, Chain> = {
  1: mainnet,
  10: optimism,
  8453: base,
  42161: arbitrum,
}

const CHAIN_INFO: Record<number, { name: string; shortName: string; color: string }> = {
  1: { name: 'Ethereum', shortName: 'ETH', color: '#627EEA' },
  10: { name: 'Optimism', shortName: 'OP', color: '#FF0420' },
  8453: { name: 'Base', shortName: 'BASE', color: '#0052FF' },
  42161: { name: 'Arbitrum', shortName: 'ARB', color: '#28A0F0' },
}

const EXPLORER_URLS: Record<number, string> = {
  1: 'https://etherscan.io/tx/',
  10: 'https://optimistic.etherscan.io/tx/',
  8453: 'https://basescan.org/tx/',
  42161: 'https://arbiscan.io/tx/',
}

interface ChainRulesetData {
  chainId: number
  projectId: number
}

interface QueueRulesetModalProps {
  isOpen: boolean
  onClose: () => void
  projectName?: string
  chainRulesetData: ChainRulesetData[]
  rulesetConfig: JBRulesetConfig
  synchronizedStartTime: number
  memo: string
}

type ChainStatus = 'pending' | 'signing' | 'submitted' | 'confirmed' | 'failed'

interface ChainTxState {
  chainId: number
  projectId: number
  status: ChainStatus
  txHash?: string
  error?: string
}

export default function QueueRulesetModal({
  isOpen,
  onClose,
  projectName,
  chainRulesetData,
  rulesetConfig,
  synchronizedStartTime,
  memo,
}: QueueRulesetModalProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { data: wallet } = useWallet()
  const paraClient = useClient()
  const { addTransaction, updateTransaction } = useTransactionStore()
  const { totalEth } = useWalletBalances()

  const [chainStates, setChainStates] = useState<ChainTxState[]>([])
  const [currentChainIndex, setCurrentChainIndex] = useState<number>(-1)
  const [isStarted, setIsStarted] = useState(false)

  const hasGasBalance = totalEth >= 0.001
  const isOmnichain = chainRulesetData.length > 1
  const startDate = new Date(synchronizedStartTime * 1000)

  // All chains completed (success or fail)
  const allCompleted = chainStates.length > 0 && chainStates.every(
    cs => cs.status === 'confirmed' || cs.status === 'failed'
  )
  const anyFailed = chainStates.some(cs => cs.status === 'failed')
  const allSucceeded = chainStates.length > 0 && chainStates.every(cs => cs.status === 'confirmed')

  // Initialize chain states
  useEffect(() => {
    if (isOpen) {
      setChainStates(
        chainRulesetData.map(cd => ({
          chainId: cd.chainId,
          projectId: cd.projectId,
          status: 'pending',
        }))
      )
      setCurrentChainIndex(-1)
      setIsStarted(false)
    }
  }, [isOpen, chainRulesetData])

  const updateChainState = useCallback((chainId: number, update: Partial<ChainTxState>) => {
    setChainStates(prev =>
      prev.map(cs =>
        cs.chainId === chainId
          ? { ...cs, ...update }
          : cs
      )
    )
  }, [])

  // Convert ruleset config to contract format
  const buildRulesetArgs = useCallback(() => {
    return [{
      mustStartAtOrAfter: rulesetConfig.mustStartAtOrAfter, // uint48 fits in number
      duration: rulesetConfig.duration,
      weight: BigInt(rulesetConfig.weight),
      weightCutPercent: rulesetConfig.weightCutPercent,
      approvalHook: rulesetConfig.approvalHook as `0x${string}`,
      metadata: {
        reservedPercent: rulesetConfig.metadata.reservedPercent,
        cashOutTaxRate: rulesetConfig.metadata.cashOutTaxRate,
        baseCurrency: rulesetConfig.metadata.baseCurrency,
        pausePay: rulesetConfig.metadata.pausePay,
        pauseCreditTransfers: rulesetConfig.metadata.pauseCreditTransfers,
        allowOwnerMinting: rulesetConfig.metadata.allowOwnerMinting,
        allowSetCustomToken: rulesetConfig.metadata.allowSetCustomToken,
        allowTerminalMigration: rulesetConfig.metadata.allowTerminalMigration,
        allowSetTerminals: rulesetConfig.metadata.allowSetTerminals,
        allowSetController: rulesetConfig.metadata.allowSetController,
        allowAddAccountingContext: rulesetConfig.metadata.allowAddAccountingContext,
        allowAddPriceFeed: rulesetConfig.metadata.allowAddPriceFeed,
        ownerMustSendPayouts: rulesetConfig.metadata.ownerMustSendPayouts,
        holdFees: rulesetConfig.metadata.holdFees,
        useTotalSurplusForCashOuts: rulesetConfig.metadata.useTotalSurplusForCashOuts,
        useDataHookForPay: rulesetConfig.metadata.useDataHookForPay,
        useDataHookForCashOut: rulesetConfig.metadata.useDataHookForCashOut,
        dataHook: rulesetConfig.metadata.dataHook as `0x${string}`,
        metadata: rulesetConfig.metadata.metadata,
      },
      splitGroups: rulesetConfig.splitGroups.map(sg => ({
        groupId: BigInt(sg.groupId),
        splits: sg.splits.map(s => ({
          percent: s.percent,
          projectId: BigInt(s.projectId),
          beneficiary: s.beneficiary as `0x${string}`,
          preferAddToBalance: s.preferAddToBalance,
          lockedUntil: Number(s.lockedUntil),
          hook: s.hook as `0x${string}`,
        })),
      })),
      fundAccessLimitGroups: rulesetConfig.fundAccessLimitGroups.map(fg => ({
        terminal: fg.terminal as `0x${string}`,
        token: fg.token as `0x${string}`,
        payoutLimits: fg.payoutLimits.map(pl => ({
          amount: BigInt(pl.amount),
          currency: pl.currency,
        })),
        surplusAllowances: fg.surplusAllowances.map(sa => ({
          amount: BigInt(sa.amount),
          currency: sa.currency,
        })),
      })),
    }]
  }, [rulesetConfig])

  // Queue ruleset on a single chain
  const queueOnChain = useCallback(async (chainData: ChainRulesetData) => {
    if (!paraClient || !wallet?.address) {
      throw new Error('Wallet not connected')
    }

    const chain = CHAINS[chainData.chainId]
    if (!chain) {
      throw new Error(`Unsupported chain: ${chainData.chainId}`)
    }

    updateChainState(chainData.chainId, { status: 'signing' })

    try {
      const txId = addTransaction({
        type: 'deploy',
        projectId: String(chainData.projectId),
        chainId: chainData.chainId,
        amount: '0',
        status: 'pending',
      })

      const walletClient = createParaViemClient(paraClient, {
        chain,
        transport: http(),
      })

      const rulesetArgs = buildRulesetArgs()

      const callData = encodeFunctionData({
        abi: CONTROLLER_QUEUE_RULESETS_ABI,
        functionName: 'queueRulesetsOf',
        args: [
          BigInt(chainData.projectId),
          rulesetArgs,
          memo,
        ],
      })

      updateChainState(chainData.chainId, { status: 'submitted' })

      const hash = await walletClient.sendTransaction({
        to: JB_CONTROLLER,
        data: callData,
        value: 0n,
      })

      updateChainState(chainData.chainId, { status: 'confirmed', txHash: hash })
      updateTransaction(txId, { hash, status: 'submitted' })

      return hash
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Transaction failed'
      updateChainState(chainData.chainId, { status: 'failed', error: errorMessage })
      throw err
    }
  }, [paraClient, wallet, memo, buildRulesetArgs, addTransaction, updateTransaction, updateChainState])

  // Start the queuing process
  const handleStart = useCallback(async () => {
    if (!paraClient || !wallet?.address || chainRulesetData.length === 0) return

    setIsStarted(true)

    // Process chains sequentially to allow user to sign each
    for (let i = 0; i < chainRulesetData.length; i++) {
      setCurrentChainIndex(i)
      try {
        await queueOnChain(chainRulesetData[i])
      } catch (err) {
        console.error(`Queue failed on chain ${chainRulesetData[i].chainId}:`, err)
        // Continue with next chain even if one fails
      }
    }

    setCurrentChainIndex(-1)
  }, [paraClient, wallet, chainRulesetData, queueOnChain])

  if (!isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={!isStarted || allCompleted ? onClose : undefined}
      />

      {/* Modal */}
      <div className={`relative w-full max-w-md border ${
        isDark ? 'bg-juice-dark border-white/10' : 'bg-white border-gray-200'
      }`}>
        {/* Header */}
        <div className={`px-5 py-4 border-b flex items-center justify-between ${
          isDark ? 'border-white/10' : 'border-gray-100'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 flex items-center justify-center text-xl ${
              allSucceeded
                ? 'bg-green-500/20'
                : anyFailed
                  ? 'bg-red-500/20'
                  : isDark ? 'bg-purple-500/20' : 'bg-purple-100'
            }`}>
              {allSucceeded ? '✓' : anyFailed ? '!' : '⚙️'}
            </div>
            <div>
              <h2 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {allSucceeded
                  ? 'Ruleset Queued'
                  : anyFailed && allCompleted
                    ? 'Some Queues Failed'
                    : isStarted
                      ? 'Queueing Ruleset...'
                      : 'Confirm Queue Ruleset'}
              </h2>
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {projectName || 'Project'}
              </p>
            </div>
          </div>
          {(!isStarted || allCompleted) && (
            <button
              onClick={onClose}
              className={`p-2 transition-colors ${
                isDark ? 'text-gray-400 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* Synchronized Start Time */}
          <div className={`p-3 ${isDark ? 'bg-purple-500/10' : 'bg-purple-50'}`}>
            <div className={`text-xs font-medium ${isDark ? 'text-purple-300' : 'text-purple-700'}`}>
              Synchronized Start Time
            </div>
            <div className={`text-sm font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {startDate.toLocaleString()}
            </div>
            {isOmnichain && (
              <div className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                All chains will activate at the same time
              </div>
            )}
          </div>

          {/* Chain Status */}
          <div className="space-y-2">
            {chainStates.map((cs, idx) => {
              const chainInfo = CHAIN_INFO[cs.chainId]
              const isCurrent = idx === currentChainIndex

              return (
                <div
                  key={cs.chainId}
                  className={`p-3 flex items-center justify-between ${
                    isCurrent
                      ? isDark ? 'bg-purple-500/20 border border-purple-500/50' : 'bg-purple-100 border border-purple-300'
                      : isDark ? 'bg-white/5' : 'bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: chainInfo?.color || '#888' }}
                    />
                    <span className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {chainInfo?.name || `Chain ${cs.chainId}`}
                    </span>
                    <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      Project #{cs.projectId}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {cs.status === 'pending' && (
                      <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        Waiting...
                      </span>
                    )}
                    {cs.status === 'signing' && (
                      <div className="flex items-center gap-2">
                        <div className="animate-spin w-3 h-3 border-2 border-purple-500 border-t-transparent rounded-full" />
                        <span className={`text-xs ${isDark ? 'text-purple-300' : 'text-purple-600'}`}>
                          Sign in wallet
                        </span>
                      </div>
                    )}
                    {cs.status === 'submitted' && (
                      <div className="flex items-center gap-2">
                        <div className="animate-spin w-3 h-3 border-2 border-juice-cyan border-t-transparent rounded-full" />
                        <span className={`text-xs ${isDark ? 'text-juice-cyan' : 'text-cyan-600'}`}>
                          Confirming...
                        </span>
                      </div>
                    )}
                    {cs.status === 'confirmed' && (
                      <div className="flex items-center gap-2">
                        <span className="text-green-500">✓</span>
                        {cs.txHash && (
                          <a
                            href={`${EXPLORER_URLS[cs.chainId]}${cs.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-juice-cyan hover:underline"
                          >
                            View
                          </a>
                        )}
                      </div>
                    )}
                    {cs.status === 'failed' && (
                      <span className="text-xs text-red-400">
                        Failed
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Error details */}
          {anyFailed && (
            <div className={`p-3 ${isDark ? 'bg-red-500/10' : 'bg-red-50'}`}>
              {chainStates.filter(cs => cs.status === 'failed').map(cs => (
                <div key={cs.chainId} className="text-xs">
                  <span className={isDark ? 'text-red-400' : 'text-red-600'}>
                    {CHAIN_INFO[cs.chainId]?.name || `Chain ${cs.chainId}`}:
                  </span>
                  <span className={`ml-1 ${isDark ? 'text-red-400/70' : 'text-red-500'}`}>
                    {cs.error || 'Unknown error'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Pre-queue info */}
          {!isStarted && (
            <>
              {/* Gas balance check */}
              <div className={`flex justify-between items-center text-sm ${
                isDark ? 'text-gray-400' : 'text-gray-500'
              }`}>
                <span>Your ETH balance (for gas)</span>
                <span className={`font-mono ${!hasGasBalance ? 'text-red-400' : ''}`}>
                  {formatEthBalance(totalEth)} ETH
                </span>
              </div>

              {!hasGasBalance && (
                <div className={`p-3 text-sm ${isDark ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-600'}`}>
                  Insufficient ETH for gas fees
                </div>
              )}

              {isOmnichain && (
                <div className={`p-3 text-sm ${isDark ? 'bg-amber-500/10 text-amber-300' : 'bg-amber-50 text-amber-700'}`}>
                  You will need to sign {chainRulesetData.length} transactions, one for each chain.
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className={`px-5 py-4 border-t ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          {!isStarted && (
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className={`flex-1 py-3 font-medium border-2 transition-colors ${
                  isDark
                    ? 'border-white/20 text-white hover:bg-white/10'
                    : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                Cancel
              </button>
              <button
                onClick={handleStart}
                disabled={!hasGasBalance}
                className="flex-1 py-3 font-bold bg-purple-500 text-white hover:bg-purple-500/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Queue{isOmnichain ? ` on ${chainRulesetData.length} Chains` : ''}
              </button>
            </div>
          )}

          {isStarted && !allCompleted && (
            <div className={`text-center text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Please sign each transaction in your wallet
            </div>
          )}

          {allCompleted && (
            <button
              onClick={onClose}
              className="w-full py-3 font-medium bg-purple-500 text-white hover:bg-purple-500/90 transition-colors"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
