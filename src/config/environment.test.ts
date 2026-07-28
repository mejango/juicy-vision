/**
 * Environment-mode chain defaults and the write-path environment guard.
 *
 * The vitest setup stubs VITE_TESTNET_MODE=true, so the ambient module build
 * is TESTNET mode: CHAIN_IDS map to the Sepolia flavors. Mainnet-mode
 * behavior is exercised by re-importing the module with the persisted
 * 'jb-network' choice set to mainnet.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  CHAIN_IDS,
  IS_TESTNET,
  defaultChainId,
  chainMatchesEnvironment,
  assertChainMatchesEnvironment,
} from './environment'

describe('defaultChainId', () => {
  it('is testnet mode under the test setup', () => {
    expect(IS_TESTNET).toBe(true)
  })

  it('returns Sepolia (never mainnet 1) in testnet mode', () => {
    expect(defaultChainId()).toBe('11155111')
    expect(defaultChainId()).toBe(String(CHAIN_IDS.ethereum))
  })

  it('returns Ethereum mainnet when the user chose mainnet mode', async () => {
    localStorage.setItem('jb-network', 'mainnet')
    vi.resetModules()
    const mainnetEnv = await import('./environment')
    expect(mainnetEnv.IS_TESTNET).toBe(false)
    expect(mainnetEnv.defaultChainId()).toBe('1')
    localStorage.removeItem('jb-network')
    vi.resetModules()
  })
})

describe('chainMatchesEnvironment (testnet mode)', () => {
  beforeEach(() => {
    localStorage.removeItem('jb-network')
  })

  it('accepts every supported testnet chain', () => {
    for (const id of [11155111, 11155420, 84532, 421614]) {
      expect(chainMatchesEnvironment(id)).toBe(true)
      expect(chainMatchesEnvironment(String(id))).toBe(true)
    }
  })

  it('rejects every mainnet chain', () => {
    for (const id of [1, 10, 8453, 42161]) {
      expect(chainMatchesEnvironment(id)).toBe(false)
      expect(chainMatchesEnvironment(String(id))).toBe(false)
    }
  })

  it('rejects garbage', () => {
    expect(chainMatchesEnvironment('not-a-chain')).toBe(false)
    expect(chainMatchesEnvironment(Number.NaN)).toBe(false)
  })
})

describe('assertChainMatchesEnvironment', () => {
  it('passes for in-environment chains', () => {
    expect(() => assertChainMatchesEnvironment(11155111)).not.toThrow()
  })

  it('blocks a mainnet write in testnet mode with a clear error', () => {
    expect(() => assertChainMatchesEnvironment(1)).toThrow(
      /mainnet chain \(1\).*testnet mode/,
    )
  })

  it('blocks a testnet write when the user chose mainnet mode', async () => {
    localStorage.setItem('jb-network', 'mainnet')
    vi.resetModules()
    const mainnetEnv = await import('./environment')
    expect(() => mainnetEnv.assertChainMatchesEnvironment(11155111)).toThrow(
      /testnet chain \(11155111\).*mainnet mode/,
    )
    localStorage.removeItem('jb-network')
    vi.resetModules()
  })
})

describe('no component hardcodes the mainnet default chain', () => {
  it('dynamic components carry no chainId = 1 defaults', async () => {
    // Source-level regression net for the chainId-defaults-to-'1' class: the
    // dynamic component tree must default through defaultChainId() so testnet
    // mode can never silently target mainnet.
    const sources = import.meta.glob('../components/dynamic/**/*.tsx', {
      query: '?raw',
      import: 'default',
    })
    const offenders: string[] = []
    for (const [path, load] of Object.entries(sources)) {
      if (path.includes('.test.')) continue
      const source = (await load()) as string
      if (/chainId(?::\s*\w+)?\s*=\s*['"]?1['"]?\s*[,)\n]/.test(source)) {
        offenders.push(path)
      }
    }
    expect(offenders).toEqual([])
  })
})
