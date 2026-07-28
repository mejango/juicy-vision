/**
 * Router-acceptance guard for project links.
 *
 * The router (App.tsx) only accepts dash-free slugs (op-sep → opsep). Every
 * link emitter must go through projectPathFor/routeChainSlug so a chain added
 * to CHAINS can never emit a path the router rejects — that regression is
 * caught HERE, parameterized across every known mainnet + testnet chain.
 */

import { describe, expect, it } from 'vitest'
import { CHAINS, MAINNET_CHAINS, TESTNET_CHAINS } from '../constants'
import {
  CHAIN_SLUG_TO_ID,
  PROJECT_SLUG_REGEX,
  juiceboxProjectUrl,
  projectPathFor,
  routeChainSlug,
} from './projectLink'

const KNOWN_CHAINS: Record<number, { slug: string }> = {
  ...MAINNET_CHAINS,
  ...TESTNET_CHAINS,
}

describe('routeChainSlug', () => {
  it('strips dashes so CHAINS slugs match the router format', () => {
    expect(routeChainSlug('op-sep')).toBe('opsep')
    expect(routeChainSlug('base-sep')).toBe('basesep')
    expect(routeChainSlug('arb-sep')).toBe('arbsep')
    expect(routeChainSlug('eth')).toBe('eth')
  })
})

describe('projectPathFor', () => {
  it.each(Object.keys(KNOWN_CHAINS).map(Number))(
    'emits a PROJECT_SLUG_REGEX-accepted path for chain %d',
    (chainId) => {
      const path = projectPathFor(chainId, 42)
      expect(path).not.toBeNull()
      expect(path![0]).toBe('/')
      const slugPart = path!.slice(1)
      const match = slugPart.match(PROJECT_SLUG_REGEX)
      expect(match).not.toBeNull()
      expect(match![2]).toBe('42')
    },
  )

  it('returns null for unknown chains instead of emitting a broken link', () => {
    expect(projectPathFor(999999, 1)).toBeNull()
  })

  it('accepts string project ids', () => {
    expect(projectPathFor(1, '7')).toBe('/eth:7')
  })
})

describe('CHAIN_SLUG_TO_ID (router map)', () => {
  it('resolves every environment-active chain back to its chain id', () => {
    // The true regression guard: any chain in the active CHAINS table must be
    // routable, so links emitted for it never 404.
    for (const [chainId, config] of Object.entries(CHAINS)) {
      expect(CHAIN_SLUG_TO_ID[routeChainSlug(config.slug)]).toBe(Number(chainId))
    }
  })

  it('always resolves mainnet slugs, even in testnet mode', () => {
    for (const [chainId, config] of Object.entries(MAINNET_CHAINS)) {
      expect(CHAIN_SLUG_TO_ID[routeChainSlug(config.slug)]).toBe(Number(chainId))
    }
  })

  it('only contains slugs the router regex accepts', () => {
    for (const slug of Object.keys(CHAIN_SLUG_TO_ID)) {
      expect(`${slug}:1`).toMatch(PROJECT_SLUG_REGEX)
    }
  })
})

describe('juiceboxProjectUrl', () => {
  it('stays null until juicebox.money hosts V6 pages', () => {
    expect(juiceboxProjectUrl('eth', 1)).toBeNull()
  })
})
