import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ChainLogo from './ChainLogo'
import { ALL_CHAINS, CHAIN_LOGOS, MAINNET_CHAINS, TESTNET_CHAINS } from '../../constants'

describe('ChainLogo', () => {
  describe('the logo map', () => {
    it('covers every mainnet and testnet chain the app knows about', () => {
      const known = Object.keys(ALL_CHAINS).map(Number)
      expect(known).toHaveLength(8)
      for (const chainId of known) {
        expect(CHAIN_LOGOS[chainId]).toMatch(/^\/assets\/img\/logo\/\w+\.svg$/)
      }
    })

    it('reuses the mainnet brand mark for each testnet', () => {
      // Same brand color = same chain family in the app's own tables.
      for (const [testnetId, testnet] of Object.entries(TESTNET_CHAINS)) {
        const mainnetId = Object.keys(MAINNET_CHAINS).find(
          id => MAINNET_CHAINS[Number(id)].color === testnet.color,
        )
        expect(mainnetId).toBeDefined()
        expect(CHAIN_LOGOS[Number(testnetId)]).toBe(CHAIN_LOGOS[Number(mainnetId)])
      }
    })

    it('gives each chain family a distinct mark', () => {
      const marks = Object.keys(MAINNET_CHAINS).map(id => CHAIN_LOGOS[Number(id)])
      expect(new Set(marks).size).toBe(4)
    })
  })

  describe('rendering', () => {
    const logoOf = (container: HTMLElement) =>
      container.querySelector('img') as HTMLImageElement

    it('renders the chain mark as decorative, not as a second copy of the name', () => {
      // The chain name is always visible beside the mark; naming the mark too
      // would make a link announce as "Base LogoBase · #42".
      const { container } = render(<ChainLogo chainId={8453} />)
      const img = logoOf(container)
      expect(img).toHaveAttribute('src', '/assets/img/logo/base.svg')
      expect(img).toHaveAttribute('alt', '')
      expect(img).toHaveAttribute('aria-hidden', 'true')
      expect(img).not.toHaveAttribute('title')
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
    })

    it('stays decorative for same-family testnets', () => {
      const { container } = render(<ChainLogo chainId={84532} />)
      const img = logoOf(container)
      expect(img).toHaveAttribute('src', '/assets/img/logo/base.svg')
      expect(img).toHaveAttribute('alt', '')
      expect(img).not.toHaveAttribute('title')
    })

    it('sizes to 20px wide with auto height and never shrinks', () => {
      const { container } = render(<ChainLogo chainId={1} />)
      const img = logoOf(container)
      expect(img.style.width).toBe('20px')
      expect(img.style.height).toBe('auto')
      expect(img.style.flexShrink).toBe('0')
    })

    it('accepts a custom size', () => {
      const { container } = render(<ChainLogo chainId={10} size={14} />)
      const img = logoOf(container)
      expect(img.style.width).toBe('14px')
      expect(img.style.minWidth).toBe('14px')
    })

    it('forwards a className', () => {
      const { container } = render(<ChainLogo chainId={42161} className="mr-1" />)
      expect(logoOf(container).className).toContain('mr-1')
    })

    it('renders nothing for an unknown chain rather than a broken image', () => {
      const { container } = render(<ChainLogo chainId={999999} />)
      expect(container).toBeEmptyDOMElement()
    })

    it('renders no image element for an unknown chain', () => {
      const { container } = render(<ChainLogo chainId={31337} />)
      expect(container.querySelector('img')).toBeNull()
    })
  })
})
