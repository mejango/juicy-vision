// Mobile wallet-app handoff helpers. Wallet in-app browsers lack the service
// worker that subdomain IPFS gateways like ipfs.inbrowser.link rely on, so
// handoff URLs are rewritten to a path-style public gateway first.

const WALLET_SAFE_GATEWAY = 'https://ipfs.io'

// Subdomain gateways the app is deployed to or reachable through (see deploy-ipfs.sh).
const SUBDOMAIN_IPFS_SUFFIXES = ['.ipfs.inbrowser.link', '.ipfs.w3s.link', '.ipfs.dweb.link'] as const

// Path-style gateway hosts that still depend on an in-page service worker.
const PATH_IPFS_HOSTS = ['ipfs.inbrowser.link'] as const

function ipfsPathUrl(cid: string, pathname: string, search: string, hash: string): string {
  return `${WALLET_SAFE_GATEWAY}/ipfs/${cid}${pathname || '/'}${search}${hash}`
}

/**
 * Rewrite an IPFS-gateway URL into a wallet-browser-safe path-style URL.
 * Non-IPFS URLs (and URLs already on ipfs.io) are returned unchanged.
 */
export function walletDappUrl(href: string): string {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return href
  }

  const hostname = url.hostname.toLowerCase()

  for (const suffix of SUBDOMAIN_IPFS_SUFFIXES) {
    if (hostname.endsWith(suffix) && hostname.length > suffix.length) {
      const cid = hostname.slice(0, -suffix.length)
      return ipfsPathUrl(cid, url.pathname, url.search, url.hash)
    }
  }

  if ((PATH_IPFS_HOSTS as readonly string[]).includes(hostname)) {
    const match = /^\/ipfs\/([^/]+)(\/.*)?$/.exec(url.pathname)
    if (match) return ipfsPathUrl(match[1], match[2] || '/', url.search, url.hash)
  }

  return href
}

interface MobileWalletLink {
  name: string
  url: string
}

/**
 * Deep links that open the given page inside popular mobile wallet apps.
 */
export function mobileWalletLinks(href: string): MobileWalletLink[] {
  const full = walletDappUrl(href)
  const dapp = encodeURIComponent(full.replace(/^https?:\/\//i, ''))
  const encoded = encodeURIComponent(full)
  return [
    { name: 'MetaMask', url: `https://metamask.app.link/dapp/${dapp}` },
    { name: 'Coinbase Wallet', url: `https://go.cb-w.com/dapp?cb_url=${encoded}` },
    { name: 'Trust Wallet', url: `https://link.trustwallet.com/open_url?coin_id=60&url=${encoded}` },
  ]
}

/**
 * Detect mobile devices, including iPads that report a MacIntel platform.
 */
export function isMobileDevice(nav: { userAgent?: string; platform?: string; maxTouchPoints?: number }): boolean {
  if (!nav) return false
  return (
    /Android|iPhone|iPad|iPod/i.test(nav.userAgent || '') ||
    (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1)
  )
}
