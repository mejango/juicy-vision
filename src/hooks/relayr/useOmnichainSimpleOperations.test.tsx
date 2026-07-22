import { act, renderHook } from '@testing-library/react'
import { keccak256, toBytes } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { execute, reset, useOmnichainTransaction } = vi.hoisted(() => {
  const execute = vi.fn()
  const reset = vi.fn()
  const transaction = {
    execute,
    bundleState: {
      bundleId: null,
      status: 'idle' as const,
      chainStates: [],
      paymentOptions: [],
      selectedPaymentChain: null,
      paymentTxHash: null,
      error: null,
      synchronizedStartTime: 1_800_000_000,
    },
    isExecuting: false,
    isComplete: false,
    isExpired: false,
    hasError: false,
    reset,
  }
  return {
    execute,
    reset,
    useOmnichainTransaction: vi.fn(() => transaction),
  }
})

vi.mock('./useOmnichainTransaction', () => ({ useOmnichainTransaction }))

import { useOmnichainDeployERC20 } from './useOmnichainDeployERC20'
import { useOmnichainQueueRuleset } from './useOmnichainQueueRuleset'

describe('simple Relayr omnichain operation boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    execute.mockResolvedValue(undefined)
  })

  it('passes reviewed ERC-20 metadata, per-chain project IDs, and a deterministic salt exactly', async () => {
    const options = { deploymentKey: 'deploy-token-7' }
    const { result } = renderHook(() => useOmnichainDeployERC20(options))
    const params = {
      chainIds: [1, 10],
      projectIds: { 1: 7, 10: 19 },
      tokenName: 'Juice Token',
      tokenSymbol: 'jbx',
      controllerAddresses: {
        1: '0x1111111111111111111111111111111111111111',
        10: '0x2222222222222222222222222222222222222222',
      },
    }

    await act(async () => result.current.deploy(params))

    expect(useOmnichainTransaction).toHaveBeenCalledWith(options)
    expect(execute).toHaveBeenCalledWith({
      chainIds: [1, 10],
      projectIds: { 1: 7, 10: 19 },
      deployERC20Config: {
        tokenName: 'Juice Token',
        tokenSymbol: 'jbx',
        salt: keccak256(toBytes('juicebox-erc20-v1-7-JBX')),
        controllerAddresses: params.controllerAddresses,
      },
    })
  })

  it('rejects unsafe metadata or a missing project before reaching Relayr orchestration', async () => {
    const { result } = renderHook(() => useOmnichainDeployERC20())

    await expect(result.current.deploy({
      chainIds: [1],
      projectIds: { 1: 7 },
      tokenName: 'Juice Token',
      tokenSymbol: 'J BX',
      controllerAddresses: {},
    })).rejects.toThrow('Token symbol')
    await expect(result.current.deploy({
      chainIds: [1],
      projectIds: {},
      tokenName: 'Juice Token',
      tokenSymbol: 'JBX',
      controllerAddresses: {},
    })).rejects.toThrow('No project ID provided')
    expect(execute).not.toHaveBeenCalled()
  })

  it('preserves chain-specific rulesets, live queue targets, memo, and synchronized start input', async () => {
    const { result } = renderHook(() => useOmnichainQueueRuleset())
    const mainnetRuleset = [{ duration: 30, weight: 10n }]
    const optimismRuleset = [{ duration: 60, weight: 20n }]

    await act(async () => result.current.queue({
      chainIds: [1, 10],
      projectIds: { 1: 7, 10: 19 },
      rulesetConfigurationsByChain: {
        1: mainnetRuleset,
        10: optimismRuleset,
      } as never,
      queueTargets: {
        1: '0x1111111111111111111111111111111111111111',
        10: '0x2222222222222222222222222222222222222222',
      },
      memo: 'Reviewed omnichain ruleset',
      mustStartAtOrAfter: 1_800_000_000,
    }))

    expect(execute).toHaveBeenCalledWith({
      chainIds: [1, 10],
      projectIds: { 1: 7, 10: 19 },
      rulesetConfig: {
        rulesetConfigurations: undefined,
        rulesetConfigurationsByChain: {
          1: mainnetRuleset,
          10: optimismRuleset,
        },
        queueTargets: {
          1: '0x1111111111111111111111111111111111111111',
          10: '0x2222222222222222222222222222222222222222',
        },
        memo: 'Reviewed omnichain ruleset',
        mustStartAtOrAfter: 1_800_000_000,
      },
    })
    expect(result.current.synchronizedStartTime).toBe(1_800_000_000)
  })

  it('surfaces the shared Relayr reset and execution state unchanged', () => {
    const deploy = renderHook(() => useOmnichainDeployERC20()).result.current
    const queue = renderHook(() => useOmnichainQueueRuleset()).result.current

    deploy.reset()
    queue.reset()

    expect(reset).toHaveBeenCalledTimes(2)
    expect(deploy.bundleState.status).toBe('idle')
    expect(queue.isExecuting).toBe(false)
  })
})
