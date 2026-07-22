// IPFS gateway resolution and pinning utilities

import {
  decodeEncodedIpfsUriCandidates as decodeSdkIpfsCandidates,
  encodeIpfsUri as encodeSdkIpfsUri,
  ipfsAssetPath,
  isIpfsCid,
} from '@bananapus/nana-sdk-core'

const IPFS_PATH_GATEWAYS = [
  'https://gateway.pinata.cloud/ipfs/',
  'https://dweb.link/ipfs/',
  'https://ipfs.io/ipfs/',
] as const
const PINATA_API_URL = 'https://api.pinata.cloud'

/**
 * Project location metadata - Juicebox Ecosystem Standard
 *
 * PRIVACY NOTE: All location data is PUBLIC and stored on IPFS.
 * Projects should only include information they're comfortable sharing publicly.
 *
 * Use cases:
 * - Physical businesses: city/region/country
 * - Online-only projects: { type: 'online' }
 * - Global communities: { type: 'global', name: 'Worldwide' }
 * - Events: specific venue or city
 * - Privacy-conscious: country only, or omit entirely
 */
interface ProjectLocation {
  /**
   * Human-readable location description
   * Examples: "San Francisco, CA", "Berlin", "Online", "Global", "Southeast Asia"
   * Keep as general or specific as you're comfortable with
   */
  name?: string

  /**
   * Location type indicator
   * - 'physical': Has a specific physical location
   * - 'online': Fully online/digital project
   * - 'hybrid': Both physical presence and online
   * - 'global': Operates worldwide, no specific location
   * - 'multiple': Multiple distinct locations
   */
  type?: 'physical' | 'online' | 'hybrid' | 'global' | 'multiple'

  /**
   * ISO 3166-1 alpha-2 country code (e.g., "US", "DE", "JP")
   * Useful for filtering/search without revealing exact location
   */
  countryCode?: string

  /**
   * Country name (human-readable)
   */
  country?: string

  /**
   * City name (optional - only if comfortable sharing)
   */
  city?: string

  /**
   * State, province, or region (optional)
   */
  region?: string

  /**
   * Geographic coordinates for mapping (optional)
   * Only include if you want to appear on maps
   * Consider using approximate coordinates (city center) rather than exact address
   */
  coordinates?: {
    lat: number
    lng: number
  }
}

/**
 * NFT category name mapping
 * Maps category integers (0-199) to human-readable names
 * Example: { "0": "Rewards", "1": "Merchandise", "2": "Digital Goods" }
 */
type Jb721CategoryMapping = Record<string, string>

// Full project metadata structure from IPFS
export interface IpfsProjectMetadata {
  name: string
  description?: string
  tagline?: string  // Short tagline/summary
  projectTagline?: string  // Alternative field name
  logoUri?: string
  infoUri?: string
  twitter?: string
  discord?: string
  telegram?: string
  // Token symbol (may be stored in metadata)
  tokenSymbol?: string
  /**
   * Project location - PUBLIC DATA
   * Only include information you're comfortable sharing publicly.
   * Omit this field entirely if you prefer not to share location.
   */
  location?: ProjectLocation
  /**
   * NFT tier category names
   * Maps category integers to human-readable names for organizing items
   * Use categories 0-199 for custom groupings (e.g., "Rewards", "Merchandise", "Services")
   */
  '721Categories'?: Jb721CategoryMapping
  // Additional fields that may be present
  [key: string]: unknown
}

// Fetch and parse project metadata from IPFS
export async function fetchIpfsMetadata(metadataUri: string): Promise<IpfsProjectMetadata | null> {
  return fetchIpfsJson<IpfsProjectMetadata>(metadataUri)
}

// Accept pinned CIDv0/CIDv1 URIs. Paths are optional for read-only metadata
// references, while transaction forms can require the CID root explicitly.
export function isIpfsUri(uri: string, allowPath = true): boolean {
  if (!uri.startsWith('ipfs://')) return false
  const path = ipfsAssetPath(uri)
  return Boolean(path && (allowPath || !path.includes('/')))
}

function ipfsLocation(uri: string): { cid: string; path: string } | null {
  const value = uri.trim()
  if (!value) return null
  const candidate =
    ipfsAssetPath(value) ??
    (isIpfsCid(value.split('/')[0]) ? value : null)
  if (!candidate) return null
  const slash = candidate.indexOf('/')
  return slash === -1
    ? { cid: candidate, path: '' }
    : { cid: candidate.slice(0, slash), path: candidate.slice(slash + 1) }
}

/**
 * Encode an IPFS CID to a hex bytes32 for on-chain storage
 *
 * This matches juice-interface's encodeIpfsUri function.
 * Input: a DAG-PB CIDv0/CIDv1 string or ipfs:// URI
 * Output: 0x + 32-byte hex (the raw SHA-256 hash, without the multihash prefix)
 *
 * @param cid - DAG-PB IPFS CID or ipfs:// URI
 * @returns bytes32 hex string (0x...) or null if invalid
 */
export function encodeIpfsUri(cid: string | undefined | null): string | null {
  if (!cid) return null
  const location = ipfsLocation(cid)
  if (!location) throw new Error('Metadata URI is not an IPFS CID')
  if (location.path) throw new Error('Tier metadata must use an IPFS root CID without a path')

  return encodeSdkIpfsUri(location.cid)
}

/**
 * Decode Juicebox's bytes32 encodedIPFSUri to IPFS CID candidates
 *
 * Format: 0x01 + 32-byte SHA-256 hash
 * Output: base58btc(0x1220 + hash) = Qm...
 */
export function decodeEncodedIPFSUriCandidates(
  encodedUri: string | undefined | null,
): [string, string] | null {
  const candidates = decodeSdkIpfsCandidates(encodedUri)
  return candidates ? [...candidates] : null
}

// Extract CID from IPFS URI
export function cidFromIpfsUri(uri: string): string | null {
  return ipfsLocation(uri)?.cid ?? null
}

// Check if URL is a legacy Pinata URL that needs migration
function isLegacyPinataUrl(url: string): boolean {
  return url?.includes('jbx.mypinata.cloud')
}

// Convert any logo URI to a working HTTP URL
export function resolveIpfsUri(uri: string | undefined | null): string | null {
  if (!uri) return null

  // Already an HTTP URL (but not legacy Pinata)
  if (uri.startsWith('http') && !isLegacyPinataUrl(uri)) {
    return uri
  }

  // IPFS URI or legacy URL - extract CID and use gateway
  const urls = ipfsGatewayUrls(uri)
  if (urls.length > 0) return urls[0]

  // Fallback - return as-is if it's a URL
  if (uri.startsWith('http')) {
    return uri
  }

  return null
}

export function ipfsGatewayUrls(uri: string | undefined | null): string[] {
  if (!uri) return []
  const location = ipfsLocation(uri)
  if (!location) return /^https?:\/\//i.test(uri) ? [uri] : []
  const suffix = location.path ? `/${location.path}` : ''
  const urls = IPFS_PATH_GATEWAYS.map(gateway => `${gateway}${location.cid}${suffix}`)
  if (location.cid.toLowerCase().startsWith('b')) {
    urls.splice(1, 0, `https://${location.cid}.eth.sucks${suffix}`)
  }
  return [...new Set(urls)]
}

export async function fetchIpfsJson<T>(uri: string): Promise<T | null> {
  for (const url of ipfsGatewayUrls(uri)) {
    try {
      const response = await fetch(url)
      if (!response.ok) continue
      return await response.json() as T
    } catch {
      // Try the next immutable gateway candidate.
    }
  }
  return null
}

// ============================================
// IPFS Pinning Functions (requires Pinata API key)
// ============================================

interface PinataResponse {
  IpfsHash: string
  PinSize: number
  Timestamp: string
}

interface PinataError {
  error: {
    reason: string
    details: string
  }
}

/**
 * Pin JSON data to IPFS via Pinata
 * @param data - JSON-serializable object to pin
 * @param jwt - Pinata JWT token
 * @param name - Optional name for the pinned content
 * @returns IPFS CID (hash)
 */
export async function pinJson(
  data: object,
  jwt: string,
  name?: string
): Promise<string> {
  const body: {
    pinataContent: object
    pinataMetadata?: { name: string }
  } = {
    pinataContent: data,
  }

  if (name) {
    body.pinataMetadata = { name }
  }

  const response = await fetch(`${PINATA_API_URL}/pinning/pinJSONToIPFS`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jwt}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = (await response.json()) as PinataError
    throw new Error(error.error?.details || error.error?.reason || 'Failed to pin JSON')
  }

  const result = (await response.json()) as PinataResponse
  encodeIpfsUri(result.IpfsHash)
  return result.IpfsHash
}

/**
 * Pin a file to IPFS via Pinata
 * @param file - File or Blob to pin
 * @param jwt - Pinata JWT token
 * @param name - Optional name for the pinned content
 * @returns IPFS CID (hash)
 */
export async function pinFile(
  file: File | Blob,
  jwt: string,
  name?: string
): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)

  if (name) {
    formData.append('pinataMetadata', JSON.stringify({ name }))
  }

  const response = await fetch(`${PINATA_API_URL}/pinning/pinFileToIPFS`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
    },
    body: formData,
  })

  if (!response.ok) {
    const error = (await response.json()) as PinataError
    throw new Error(error.error?.details || error.error?.reason || 'Failed to pin file')
  }

  const result = (await response.json()) as PinataResponse
  return result.IpfsHash
}

/**
 * Fetch an image and convert to a base64 data URI
 * @param url - Image URL to fetch
 * @returns base64 data URI or null if failed
 */
async function fetchImageAsDataUri(url: string): Promise<string | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null

    const blob = await response.blob()

    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

/**
 * Process an SVG data URI to inline all external image references
 *
 * Browsers don't load external <image> elements in SVGs when loaded as data URIs.
 * This function fetches all referenced images and embeds them as base64 data URIs.
 *
 * @param svgDataUri - SVG data URI (data:image/svg+xml;base64,... or data:image/svg+xml,...)
 * @returns Processed SVG data URI with inlined images, or original if no changes needed
 */
export async function inlineSvgImages(svgDataUri: string): Promise<string> {
  if (!svgDataUri.startsWith('data:image/svg+xml')) {
    return svgDataUri
  }

  try {
    // Decode the SVG content
    let svgContent: string
    if (svgDataUri.includes(';base64,')) {
      const base64 = svgDataUri.split(',')[1]
      svgContent = atob(base64)
    } else {
      svgContent = decodeURIComponent(svgDataUri.split(',')[1])
    }

    // Find all image hrefs (both href and xlink:href attributes)
    // Match patterns like: href="https://..." or xlink:href="ipfs://..."
    const imageUrlRegex = /(xlink:href|href)=["']([^"']+)["']/g
    const matches = [...svgContent.matchAll(imageUrlRegex)]

    if (matches.length === 0) {
      return svgDataUri
    }

    // Collect unique URLs that need to be fetched
    const urlsToFetch = new Map<string, string>()
    for (const match of matches) {
      const url = match[2]
      // Skip if already a data URI
      if (url.startsWith('data:')) continue

      // Resolve the URL to HTTP
      let httpUrl = url
      if (url.includes('bannyverse.infura-ipfs.io')) {
        httpUrl = url.replace('https://bannyverse.infura-ipfs.io/ipfs/', 'https://ipfs.io/ipfs/')
      } else if (url.startsWith('ipfs://')) {
        httpUrl = url.replace('ipfs://', 'https://ipfs.io/ipfs/')
      }

      urlsToFetch.set(url, httpUrl)
    }

    if (urlsToFetch.size === 0) {
      return svgDataUri
    }

    // Fetch all images in parallel
    const fetchedImages = new Map<string, string>()
    await Promise.all(
      Array.from(urlsToFetch.entries()).map(async ([originalUrl, httpUrl]) => {
        const dataUri = await fetchImageAsDataUri(httpUrl)
        if (dataUri) {
          fetchedImages.set(originalUrl, dataUri)
        }
      })
    )

    if (fetchedImages.size === 0) {
      // No images could be fetched, return original
      return svgDataUri
    }

    // Replace URLs in SVG content with data URIs
    let modifiedSvg = svgContent
    for (const [originalUrl, dataUri] of fetchedImages) {
      // Escape special regex characters in the URL
      const escapedUrl = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      modifiedSvg = modifiedSvg.replace(new RegExp(escapedUrl, 'g'), dataUri)
    }

    // Re-encode as base64 data URI
    const utf8Bytes = new TextEncoder().encode(modifiedSvg)
    const binaryStr = Array.from(utf8Bytes, byte => String.fromCharCode(byte)).join('')
    return 'data:image/svg+xml;base64,' + btoa(binaryStr)
  } catch (e) {
    console.error('[SVG] Failed to inline images:', e)
    return svgDataUri
  }
}
