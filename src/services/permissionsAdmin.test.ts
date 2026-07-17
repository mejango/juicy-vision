import { describe, expect, it } from 'vitest'
import { decodeFunctionData, toFunctionSelector, type Address } from 'viem'
import { jbPermissionsAbi, jbProjectsAbi, revOwnerAbi } from '@bananapus/nana-sdk-core'
import { JBPermissionIdsV6 } from '@bananapus/nana-sdk-core/v6'
import {
  aggregatePermissionHolders,
  buildInitializeBuybackPoolRequest,
  buildOwnerPowerRequest,
  buildSetBuybackHookRequest,
  buildSetOperatorRequest,
  buildSetPermissionsRequest,
  buildSetRouterTerminalRequest,
  buildTransferOwnershipRequest,
  canEditPermissions,
  decodePermissionBitmap,
  JB_PERMISSION_MAX_ID,
  OWNER_POWERS,
  PERMISSIONS,
  permissionLabel,
  permissionSetsDiffer,
  powerAvailability,
  preloadPermissionSelection,
  selectedPermissionIds,
  v6ContractAddress,
} from './permissionsAdmin'

const OWNER = '0x1111111111111111111111111111111111111111' as Address
const OPERATOR = '0x2222222222222222222222222222222222222222' as Address
const OTHER = '0x3333333333333333333333333333333333333333' as Address

describe('permission catalog', () => {
  it('takes every id from the SDK JBPermissionIdsV6 (V6 renumbering, never from memory)', () => {
    const sdkIds = Object.values(JBPermissionIdsV6).sort((a, b) => a - b)
    expect(PERMISSIONS.map(p => p.id)).toEqual(sdkIds)
    expect(JB_PERMISSION_MAX_ID).toBe(sdkIds[sdkIds.length - 1])
  })

  it('has a human label and description for every id', () => {
    for (const info of PERMISSIONS) {
      expect(info.label, `label for ${info.key}`).not.toBe(info.key)
      expect(info.description, `description for ${info.key}`).not.toBe('')
    }
  })

  it('keeps labels attached to SDK names, not raw numbers', () => {
    expect(permissionLabel(JBPermissionIdsV6.QUEUE_RULESETS)).toBe('Queue rulesets')
    expect(permissionLabel(JBPermissionIdsV6.SET_SPLIT_GROUPS)).toBe('Set splits')
    expect(permissionLabel(JBPermissionIdsV6.ROOT)).toBe('Full control (root)')
    expect(permissionLabel(9999)).toBe('Permission #9999')
  })
})

describe('setPermissionsFor replace semantics (merge-with-existing)', () => {
  const EXISTING = [JBPermissionIdsV6.SET_PROJECT_URI, JBPermissionIdsV6.SET_SPLIT_GROUPS]

  it('preloads the operator existing ids so a new grant carries them forward', () => {
    const selection = preloadPermissionSelection(EXISTING)
    // Adding one permission must NOT drop the existing set — the tx REPLACES everything.
    selection[JBPermissionIdsV6.MINT_TOKENS] = true
    expect(selectedPermissionIds(selection)).toEqual(
      [...EXISTING, JBPermissionIdsV6.MINT_TOKENS].sort((a, b) => a - b),
    )
  })

  it('unchecking one id revokes exactly that id', () => {
    const selection = preloadPermissionSelection(EXISTING)
    selection[JBPermissionIdsV6.SET_SPLIT_GROUPS] = false
    expect(selectedPermissionIds(selection)).toEqual([JBPermissionIdsV6.SET_PROJECT_URI])
  })

  it('clearing every box removes the operator (empty replacement set)', () => {
    const selection = preloadPermissionSelection(EXISTING)
    for (const info of PERMISSIONS) selection[info.id] = false
    expect(selectedPermissionIds(selection)).toEqual([])
  })

  it('ignores ids outside the catalog when preloading', () => {
    const selection = preloadPermissionSelection([...EXISTING, 250])
    expect(selectedPermissionIds(selection)).toEqual(EXISTING.sort((a, b) => a - b))
  })

  it('encodes the full selection into setPermissionsFor — the args ARE the entire new set', () => {
    const selection = preloadPermissionSelection(EXISTING)
    selection[JBPermissionIdsV6.MINT_TOKENS] = true
    const ids = selectedPermissionIds(selection)
    const request = buildSetPermissionsRequest({
      chainId: 1,
      account: OWNER,
      operator: OPERATOR,
      projectId: 7n,
      permissionIds: ids,
    })
    expect(request.to).toBe(v6ContractAddress('JBPermissions', 1))
    const decoded = decodeFunctionData({ abi: jbPermissionsAbi, data: request.data })
    expect(decoded.functionName).toBe('setPermissionsFor')
    const [account, permissionsData] = decoded.args as [Address, { operator: Address; projectId: bigint; permissionIds: readonly number[] }]
    expect(account).toBe(OWNER)
    expect(permissionsData.operator).toBe(OPERATOR)
    expect(permissionsData.projectId).toBe(7n)
    expect([...permissionsData.permissionIds]).toEqual(ids)
  })

  it('detects drift between the reviewed snapshot and the live set', () => {
    expect(permissionSetsDiffer([1, 7], [7, 1])).toBe(false)
    expect(permissionSetsDiffer([1, 7], [1, 7, 10])).toBe(true)
    expect(permissionSetsDiffer([1, 7], [1, 8])).toBe(true)
    expect(permissionSetsDiffer([], [])).toBe(false)
  })

  it('decodes a permissionsOf bitmap back to sorted ids', () => {
    expect(decodePermissionBitmap(0n)).toEqual([])
    const bitmap =
      (1n << BigInt(JBPermissionIdsV6.ROOT)) |
      (1n << BigInt(JBPermissionIdsV6.MINT_TOKENS)) |
      (1n << BigInt(JBPermissionIdsV6.SET_BUYBACK_HOOK))
    expect(decodePermissionBitmap(bitmap)).toEqual([
      JBPermissionIdsV6.ROOT,
      JBPermissionIdsV6.MINT_TOKENS,
      JBPermissionIdsV6.SET_BUYBACK_HOOK,
    ])
  })
})

describe('revnet read-only rule', () => {
  it('revnet permissions are read-only; custom projects are editable', () => {
    expect(canEditPermissions(true)).toBe(false)
    expect(canEditPermissions(false)).toBe(true)
  })
})

describe('aggregatePermissionHolders', () => {
  it('drops stale grants with no permissions', () => {
    expect(
      aggregatePermissionHolders([
        { chainId: 1, account: OWNER, operator: OPERATOR, permissions: [] },
        { chainId: 1, account: OWNER, operator: OTHER, permissions: null },
      ]),
    ).toEqual([])
  })

  it('unions permissions across chains and dedupes the operator case-insensitively', () => {
    const result = aggregatePermissionHolders([
      { chainId: 8453, account: OWNER, operator: OPERATOR, permissions: [7, 19] },
      { chainId: 1, account: OWNER, operator: OPERATOR.toUpperCase().replace('0X', '0x'), permissions: [19, 30], isRevnetOperator: true },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].chains).toEqual([1, 8453])
    expect(result[0].permissionIds).toEqual([7, 19, 30])
    expect(result[0].isRevnetOperator).toBe(true)
  })

  it('keeps distinct operators separate and filters junk ids', () => {
    const result = aggregatePermissionHolders([
      { chainId: 1, account: OWNER, operator: OPERATOR, permissions: [10, 0, -3, 'x' as unknown as number] },
      { chainId: 1, account: OWNER, operator: OTHER, permissions: [19] },
    ])
    expect(result).toHaveLength(2)
    expect(result[0].permissionIds).toEqual([10])
    expect(result[1].permissionIds).toEqual([19])
  })
})

describe('owner power flag gating', () => {
  it('maps every ruleset flag to its power', () => {
    const flagByKey = Object.fromEntries(OWNER_POWERS.map(p => [p.key, p.flag]))
    expect(flagByKey).toEqual({
      mintTokens: 'allowOwnerMinting',
      setController: 'allowSetController',
      setTerminals: 'allowSetTerminals',
      migrateBalance: 'allowTerminalMigration',
      addPriceFeed: 'allowAddPriceFeed',
      setToken: 'allowSetCustomToken',
    })
  })

  it('enables exactly the powers whose flag is on, disabling the rest with the flag named', () => {
    const availability = powerAvailability({ allowOwnerMinting: true, allowAddPriceFeed: true })
    expect(availability.mintTokens).toEqual({ enabled: true })
    expect(availability.addPriceFeed).toEqual({ enabled: true })
    for (const key of ['setController', 'setTerminals', 'migrateBalance', 'setToken'] as const) {
      expect(availability[key].enabled).toBe(false)
      const flag = OWNER_POWERS.find(p => p.key === key)!.flag
      expect(availability[key].reason).toContain(flag)
    }
  })

  it('treats missing flags as off', () => {
    const availability = powerAvailability({})
    for (const power of OWNER_POWERS) expect(availability[power.key].enabled).toBe(false)
  })
})

describe('owner power calldata builders', () => {
  const MINT = OWNER_POWERS.find(p => p.key === 'mintTokens')!
  const SET_TERMINALS = OWNER_POWERS.find(p => p.key === 'setTerminals')!
  const SET_CONTROLLER = OWNER_POWERS.find(p => p.key === 'setController')!

  it('mintTokensOf: parses the 18-decimal amount and passes the reserved toggle', () => {
    const request = buildOwnerPowerRequest(MINT, {
      chainId: 1,
      projectId: 7n,
      values: { tokenCount: '1.5', beneficiary: OTHER, useReservedPercent: true },
    })
    expect(request.to).toBe(v6ContractAddress('JBController', 1))
    expect(request.data.startsWith(toFunctionSelector('mintTokensOf(uint256,uint256,address,string,bool)'))).toBe(true)
  })

  it('mintTokensOf: rejects a zero or missing amount', () => {
    expect(() =>
      buildOwnerPowerRequest(MINT, { chainId: 1, projectId: 7n, values: { tokenCount: '0', beneficiary: OTHER } }),
    ).toThrow(/amount/i)
  })

  it('setTerminalsOf: blank input falls back to the chain JBMultiTerminal', () => {
    const request = buildOwnerPowerRequest(SET_TERMINALS, { chainId: 1, projectId: 7n, values: { terminals: '' } })
    expect(request.data.toLowerCase()).toContain(v6ContractAddress('JBMultiTerminal', 1).slice(2).toLowerCase())
  })

  it('setControllerOf: blank input falls back to the chain JBController', () => {
    const request = buildOwnerPowerRequest(SET_CONTROLLER, { chainId: 1, projectId: 7n, values: { controller: '' } })
    expect(request.data.toLowerCase()).toContain(v6ContractAddress('JBController', 1).slice(2).toLowerCase())
  })

  it('rejects malformed addresses', () => {
    expect(() =>
      buildOwnerPowerRequest(SET_CONTROLLER, { chainId: 1, projectId: 7n, values: { controller: 'not-an-address' } }),
    ).toThrow(/valid address/i)
  })
})

describe('authority transfer builders', () => {
  it('custom project → JBProjects.transferFrom(owner, to, projectId)', () => {
    const request = buildTransferOwnershipRequest({ chainId: 1, owner: OWNER, to: OTHER, projectId: 7n })
    expect(request.to).toBe(v6ContractAddress('JBProjects', 1))
    const decoded = decodeFunctionData({ abi: jbProjectsAbi, data: request.data })
    expect(decoded.functionName).toBe('transferFrom')
    expect(decoded.args).toEqual([OWNER, OTHER, 7n])
  })

  it('revnet → REVOwner.setOperatorOf(projectId, to)', () => {
    const request = buildSetOperatorRequest({ chainId: 1, to: OTHER, projectId: 7n })
    expect(request.to).toBe(v6ContractAddress('REVOwner', 1))
    const decoded = decodeFunctionData({ abi: revOwnerAbi, data: request.data })
    expect(decoded.functionName).toBe('setOperatorOf')
    expect(decoded.args).toEqual([7n, OTHER])
  })
})

describe('buyback/router registry builders', () => {
  it('setHookFor / setTerminalFor / initializePoolFor target the registries with the right selectors', () => {
    const hook = buildSetBuybackHookRequest({ chainId: 1, projectId: 7n, hook: OTHER })
    expect(hook.to).toBe(v6ContractAddress('JBBuybackHookRegistry', 1))
    expect(hook.data.startsWith(toFunctionSelector('setHookFor(uint256,address)'))).toBe(true)

    const terminal = buildSetRouterTerminalRequest({ chainId: 1, projectId: 7n, terminal: OTHER })
    expect(terminal.to).toBe(v6ContractAddress('JBRouterTerminalRegistry', 1))
    expect(terminal.data.startsWith(toFunctionSelector('setTerminalFor(uint256,address)'))).toBe(true)

    const pool = buildInitializeBuybackPoolRequest({
      chainId: 1,
      projectId: 7n,
      fee: 10000,
      tickSpacing: 200,
      twapWindow: 1800n,
      terminalToken: OTHER,
      sqrtPriceX96: 2n ** 96n,
    })
    expect(pool.to).toBe(v6ContractAddress('JBBuybackHookRegistry', 1))
    expect(
      pool.data.startsWith(toFunctionSelector('initializePoolFor(uint256,uint24,int24,uint256,address,uint160)')),
    ).toBe(true)
  })
})
