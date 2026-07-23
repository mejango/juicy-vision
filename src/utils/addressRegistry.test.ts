import { describe, expect, it, vi } from 'vitest'
import { zeroAddress, type Address, type PublicClient } from 'viem'
import {
  requireRecognizedClone,
  requireRecognized721CloneIdentity,
  requireRecognizedLpSplitHookClone,
} from './addressRegistry'

// Exercise the generic clone-recognition path with the 721 kinds the app uses.
const requireRecognized721Clone = (
  client: Pick<PublicClient, 'readContract'>,
  hook: Address,
) => requireRecognizedClone({
  client,
  instance: hook,
  allowedKinds: ['721-hook', 'defifa-hook'],
  label: '721 hook',
})

const INSTANCE = '0x1111111111111111111111111111111111111111' as Address
const REGISTRY = '0x581bfd1ead279e0a27b736e49494db3a7d85993c' as Address
const TIERS_DEPLOYER = '0xb7b8ec35e2dd84afff04ee769c6189e7a4d44a78' as Address
const DEFIFA_TESTNET_DEPLOYER = '0xbfa54a97099485c134f06c9a08a4909c26fd7318' as Address
const DEFIFA_MAINNET_DEPLOYER = '0x375afb2a4b1cadae99f8863f96fc1aebcbaf8bde' as Address
const LP_SPLIT_DEPLOYER = '0x1b79a25ee77a79469f20c98fa410f85f6027f4cf' as Address
const UNKNOWN = '0x9999999999999999999999999999999999999999' as Address
const STORE = '0x2222222222222222222222222222222222222222' as Address
const IMPLEMENTATION = '0x3333333333333333333333333333333333333333' as Address

function reader(
  deployer: Address,
  options: {
    registryByDeployer?: Record<string, Address>
    deployerByRegistry?: Record<string, Address>
    chainId?: number
  } = {},
) {
  return {
    chain: options.chainId === undefined ? undefined : { id: options.chainId },
    readContract: vi.fn(async ({ address, functionName }: { address: Address, functionName: string }) => {
      if (functionName === 'deployerOf') {
        return options.deployerByRegistry?.[address.toLowerCase()]
          ?? (address.toLowerCase() === REGISTRY.toLowerCase() ? deployer : UNKNOWN)
      }
      if (functionName === 'ADDRESS_REGISTRY' || functionName === 'REGISTRY') {
        return options.registryByDeployer?.[address.toLowerCase()] ?? REGISTRY
      }
      throw new Error(`Unexpected read: ${functionName}`)
    }),
  } as unknown as Pick<PublicClient, 'readContract'>
}

function identityReader(params: {
  deployer?: Address
  kind?: '721-hook' | 'defifa-hook'
  store?: Address
  expectedStore?: Address
  metadataIdTarget?: Address
  expectedMetadataIdTarget?: Address
  projectId?: bigint
}) {
  const deployer = params.deployer ?? TIERS_DEPLOYER
  const kind = params.kind ?? '721-hook'
  return {
    readContract: vi.fn(async ({ address, functionName }: { address: Address, functionName: string }) => {
      if (functionName === 'deployerOf') return deployer
      if (functionName === 'ADDRESS_REGISTRY' || functionName === 'REGISTRY') return REGISTRY
      if (functionName === 'HOOK' || functionName === 'HOOK_CODE_ORIGIN') {
        return params.expectedMetadataIdTarget ?? IMPLEMENTATION
      }
      if (functionName === 'HOOK_STORE') return params.expectedStore ?? STORE
      if (functionName === 'STORE') {
        return address.toLowerCase() === INSTANCE.toLowerCase()
          ? params.store ?? STORE
          : params.expectedStore ?? STORE
      }
      if (functionName === 'store') {
        if (kind !== 'defifa-hook') throw new Error('Unexpected lowercase store getter')
        return params.store ?? STORE
      }
      if (functionName === 'METADATA_ID_TARGET') {
        return params.metadataIdTarget ?? IMPLEMENTATION
      }
      if (functionName === 'projectId') return params.projectId ?? 7n
      throw new Error(`Unexpected read: ${functionName}`)
    }),
  } as unknown as Pick<PublicClient, 'readContract'>
}

describe('address registry clone recognition', () => {
  it('recognizes tier-hook clones from the canonical deployer', async () => {
    await expect(requireRecognized721Clone(reader(TIERS_DEPLOYER), INSTANCE))
      .resolves.toBe('721-hook')
  })

  it('recognizes Defifa clones from the testnet deployer', async () => {
    await expect(requireRecognized721Clone(reader(DEFIFA_TESTNET_DEPLOYER, { chainId: 11155111 }), INSTANCE))
      .resolves.toBe('defifa-hook')
  })

  it('enforces chain-specific canonical deployers', async () => {
    await expect(requireRecognized721Clone(
      reader(DEFIFA_TESTNET_DEPLOYER, { chainId: 1 }),
      INSTANCE,
    )).rejects.toThrow(/not recognized/i)
    await expect(requireRecognized721Clone(
      reader(DEFIFA_MAINNET_DEPLOYER, { chainId: 1 }),
      INSTANCE,
    )).resolves.toBe('defifa-hook')
    await expect(requireRecognizedLpSplitHookClone(
      reader(LP_SPLIT_DEPLOYER, { chainId: 11155420 }),
      INSTANCE,
    )).rejects.toThrow(/not recognized/i)
  })

  it('recognizes LP split-hook clones only in the split-hook path', async () => {
    await expect(requireRecognizedLpSplitHookClone(reader(LP_SPLIT_DEPLOYER), INSTANCE))
      .resolves.toBe('lp-split-hook')
    await expect(requireRecognized721Clone(reader(LP_SPLIT_DEPLOYER), INSTANCE))
      .rejects.toThrow(/not recognized/i)
  })

  it('blocks instances from unknown deployers', async () => {
    await expect(requireRecognized721Clone(reader(UNKNOWN), INSTANCE))
      .rejects.toThrow(/not recognized/i)
  })

  it('rejects a missing clone address before reading a registry', async () => {
    const client = reader(TIERS_DEPLOYER)
    await expect(requireRecognized721Clone(client, zeroAddress))
      .rejects.toThrow(/721 hook is missing/i)
    expect(client.readContract).not.toHaveBeenCalled()
  })

  it('derives the registry from a known deployer', async () => {
    await expect(requireRecognized721Clone(reader(TIERS_DEPLOYER, {
      registryByDeployer: {
        [TIERS_DEPLOYER.toLowerCase()]: UNKNOWN,
      },
      deployerByRegistry: {
        [UNKNOWN.toLowerCase()]: TIERS_DEPLOYER,
      },
    }), INSTANCE)).resolves.toBe('721-hook')
  })

  it('blocks inconsistent registry provenance', async () => {
    await expect(requireRecognized721Clone(reader(DEFIFA_TESTNET_DEPLOYER, {
      registryByDeployer: {
        [DEFIFA_TESTNET_DEPLOYER.toLowerCase()]: UNKNOWN,
      },
    }), INSTANCE)).rejects.toThrow(/not recognized/i)
  })

  it('verifies a standard 721 clone store, implementation target, and project ID', async () => {
    await expect(requireRecognized721CloneIdentity({
      client: identityReader({}),
      hook: INSTANCE,
      expectedProjectId: 7n,
    })).resolves.toMatchObject({
      kind: '721-hook',
      store: STORE,
      metadataIdTarget: IMPLEMENTATION,
      projectId: 7n,
    })
  })

  it('uses Defifa family getters and verifies the same identity invariants', async () => {
    const client = identityReader({ deployer: DEFIFA_TESTNET_DEPLOYER, kind: 'defifa-hook' })
    await expect(requireRecognized721CloneIdentity({
      client,
      hook: INSTANCE,
      expectedProjectId: 7n,
    })).resolves.toMatchObject({ kind: 'defifa-hook', store: STORE })
    expect(client.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'store' }))
  })

  it.each([
    [{ store: UNKNOWN }, /store not recognized/i],
    [{ metadataIdTarget: UNKNOWN }, /implementation target not recognized/i],
    [{ projectId: 8n }, /belongs to project 8, not project 7/i],
  ] as const)('blocks a clone which fails an identity invariant', async (overrides, message) => {
    await expect(requireRecognized721CloneIdentity({
      client: identityReader(overrides),
      hook: INSTANCE,
      expectedProjectId: 7n,
    })).rejects.toThrow(message)
  })
})
