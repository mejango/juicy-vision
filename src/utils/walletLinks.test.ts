import { describe, it, expect } from 'vitest'
import { walletDappUrl, mobileWalletLinks, isMobileDevice } from './walletLinks'

const CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'

describe('walletDappUrl', () => {
  it('rewrites subdomain inbrowser.link URLs to path-style ipfs.io', () => {
    expect(walletDappUrl(`https://${CID}.ipfs.inbrowser.link/`)).toBe(`https://ipfs.io/ipfs/${CID}/`)
  })

  it('rewrites path-style inbrowser.link URLs to ipfs.io', () => {
    expect(walletDappUrl(`https://ipfs.inbrowser.link/ipfs/${CID}/projects/1`)).toBe(
      `https://ipfs.io/ipfs/${CID}/projects/1`
    )
  })

  it('handles path-style URLs with no trailing path', () => {
    expect(walletDappUrl(`https://ipfs.inbrowser.link/ipfs/${CID}`)).toBe(`https://ipfs.io/ipfs/${CID}/`)
  })

  it('preserves path, query, and hash exactly', () => {
    expect(walletDappUrl(`https://${CID}.ipfs.inbrowser.link/p/42?chain=base&tab=pay#activity`)).toBe(
      `https://ipfs.io/ipfs/${CID}/p/42?chain=base&tab=pay#activity`
    )
  })

  it('rewrites the deploy gateways from deploy-ipfs.sh (w3s.link, dweb.link)', () => {
    expect(walletDappUrl(`https://${CID}.ipfs.w3s.link/p/1?x=1#h`)).toBe(`https://ipfs.io/ipfs/${CID}/p/1?x=1#h`)
    expect(walletDappUrl(`https://${CID}.ipfs.dweb.link/p/1`)).toBe(`https://ipfs.io/ipfs/${CID}/p/1`)
  })

  it('returns non-IPFS URLs unchanged', () => {
    expect(walletDappUrl('https://juicy.example.com/p/1?x=1#h')).toBe('https://juicy.example.com/p/1?x=1#h')
    expect(walletDappUrl('http://localhost:5173/projects')).toBe('http://localhost:5173/projects')
  })

  it('returns already-ipfs.io URLs unchanged', () => {
    expect(walletDappUrl(`https://ipfs.io/ipfs/${CID}/p/1`)).toBe(`https://ipfs.io/ipfs/${CID}/p/1`)
  })

  it('returns invalid URLs unchanged', () => {
    expect(walletDappUrl('not a url')).toBe('not a url')
  })
})

describe('mobileWalletLinks', () => {
  it('builds exact deep links on the rewritten wallet-safe URL', () => {
    const links = mobileWalletLinks(`https://${CID}.ipfs.inbrowser.link/p/1?x=1`)
    const full = `https://ipfs.io/ipfs/${CID}/p/1?x=1`
    const schemeless = `ipfs.io%2Fipfs%2F${CID}%2Fp%2F1%3Fx%3D1`
    const encoded = `https%3A%2F%2Fipfs.io%2Fipfs%2F${CID}%2Fp%2F1%3Fx%3D1`
    expect(links).toEqual([
      { name: 'MetaMask', url: `https://metamask.app.link/dapp/${schemeless}` },
      { name: 'Coinbase Wallet', url: `https://go.cb-w.com/dapp?cb_url=${encoded}` },
      { name: 'Trust Wallet', url: `https://link.trustwallet.com/open_url?coin_id=60&url=${encoded}` },
    ])
    expect(decodeURIComponent(encoded)).toBe(full)
  })
})

describe('isMobileDevice', () => {
  it('matches Android user agents', () => {
    expect(isMobileDevice({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari' })).toBe(true)
  })

  it('matches iPhone user agents', () => {
    expect(isMobileDevice({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' })).toBe(true)
  })

  it('matches iPads that report MacIntel with touch support', () => {
    expect(
      isMobileDevice({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari',
        platform: 'MacIntel',
        maxTouchPoints: 5,
      })
    ).toBe(true)
  })

  it('does not match desktop Macs', () => {
    expect(
      isMobileDevice({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari',
        platform: 'MacIntel',
        maxTouchPoints: 0,
      })
    ).toBe(false)
  })

  it('does not match Windows desktops', () => {
    expect(
      isMobileDevice({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32', maxTouchPoints: 0 })
    ).toBe(false)
  })

  it('returns false for empty navigator info', () => {
    expect(isMobileDevice({})).toBe(false)
  })
})
