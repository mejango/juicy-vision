// IPFS gateway resolution utilities

const IPFS_GATEWAY = 'https://gateway.pinata.cloud/ipfs/'

// Check if string is an IPFS URI (ipfs://...)
export function isIpfsUri(uri: string): boolean {
  return uri?.startsWith('ipfs://')
}

// Extract CID from IPFS URI
export function cidFromIpfsUri(uri: string): string | null {
  if (!isIpfsUri(uri)) return null
  return uri.replace('ipfs://', '')
}

// Check if URL is a legacy Pinata URL that needs migration
function isLegacyPinataUrl(url: string): boolean {
  return url?.includes('jbx.mypinata.cloud')
}

// Extract CID from various URL formats
function extractCid(url: string): string | null {
  // ipfs://CID
  if (isIpfsUri(url)) {
    return cidFromIpfsUri(url)
  }

  // https://gateway.../ipfs/CID or https://gateway.../ipfs/CID/...
  const ipfsMatch = url.match(/\/ipfs\/([a-zA-Z0-9]+)/)
  if (ipfsMatch) {
    return ipfsMatch[1]
  }

  return null
}

// Convert any logo URI to a working HTTP URL
export function resolveIpfsUri(uri: string | undefined | null): string | null {
  if (!uri) return null

  // Already an HTTP URL (but not legacy Pinata)
  if (uri.startsWith('http') && !isLegacyPinataUrl(uri)) {
    return uri
  }

  // IPFS URI or legacy URL - extract CID and use gateway
  const cid = extractCid(uri)
  if (cid) {
    return `${IPFS_GATEWAY}${cid}`
  }

  // If it starts with Qm or baf, it might be a raw CID
  if (uri.match(/^(Qm[a-zA-Z0-9]{44}|baf[a-zA-Z0-9]+)$/)) {
    return `${IPFS_GATEWAY}${uri}`
  }

  // Fallback - return as-is if it's a URL
  if (uri.startsWith('http')) {
    return uri
  }

  return null
}
