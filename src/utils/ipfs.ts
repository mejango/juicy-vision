// IPFS gateway resolution and pinning utilities

// Use ipfs.io gateway for reads (better CORS support)
const IPFS_GATEWAY = 'https://ipfs.io/ipfs/'
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
export interface ProjectLocation {
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
  // Additional fields that may be present
  [key: string]: unknown
}

// Fetch and parse project metadata from IPFS
export async function fetchIpfsMetadata(metadataUri: string): Promise<IpfsProjectMetadata | null> {
  const url = resolveIpfsUri(metadataUri)
  if (!url) return null

  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const data = await response.json()
    return data as IpfsProjectMetadata
  } catch {
    return null
  }
}

// Check if string is an IPFS URI (ipfs://...)
export function isIpfsUri(uri: string): boolean {
  return uri?.startsWith('ipfs://')
}

// Base58 alphabet (Bitcoin/IPFS style)
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/**
 * Decode base58 string to bytes
 */
function base58Decode(str: string): Uint8Array {
  const bytes: number[] = []
  for (let i = 0; i < str.length; i++) {
    const char = str[i]
    const value = BASE58_ALPHABET.indexOf(char)
    if (value === -1) {
      throw new Error(`Invalid base58 character: ${char}`)
    }

    let carry = value
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58
      bytes[j] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }

  // Handle leading zeros (1's in base58)
  for (let i = 0; i < str.length && str[i] === '1'; i++) {
    bytes.push(0)
  }

  return new Uint8Array(bytes.reverse())
}

/**
 * Encode bytes to base58
 */
function base58Encode(bytes: Uint8Array): string {
  const digits = [0]
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i]
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8
      digits[j] = carry % 58
      carry = Math.floor(carry / 58)
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = Math.floor(carry / 58)
    }
  }
  // Handle leading zeros
  let result = ''
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    result += BASE58_ALPHABET[0]
  }
  // Convert digits to string (reversed)
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]]
  }
  return result
}

/**
 * Encode an IPFS CID to a hex bytes32 for on-chain storage
 *
 * This matches juice-interface's encodeIpfsUri function.
 * Input: CIDv0 string (Qm...)
 * Output: 0x + 32-byte hex (the raw SHA-256 hash, without the multihash prefix)
 *
 * @param cid - IPFS CID (Qm... format) or ipfs:// URI
 * @returns bytes32 hex string (0x...) or null if invalid
 */
export function encodeIpfsUri(cid: string | undefined | null): string | null {
  if (!cid) return null

  // Extract CID if it's an ipfs:// URI
  let cleanCid = cid
  if (cid.startsWith('ipfs://')) {
    cleanCid = cid.slice(7) // Remove 'ipfs://'
  }

  // Should be a CIDv0 starting with Qm
  if (!cleanCid.startsWith('Qm')) {
    return null
  }

  try {
    // Decode base58 to get the multihash bytes
    const decoded = base58Decode(cleanCid)

    // CIDv0 multihash: 0x12 (sha2-256) + 0x20 (32 bytes) + 32-byte hash
    // We need to skip the first 2 bytes (0x1220) and get the 32-byte hash
    if (decoded.length !== 34) {
      return null
    }

    // Extract the 32-byte hash (skip first 2 bytes)
    const hash = decoded.slice(2)

    // Convert to hex
    const hex = Array.from(hash)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    return `0x${hex}`
  } catch {
    return null
  }
}

/**
 * Decode Juicebox's bytes32 encodedIPFSUri to an IPFS CIDv0 (Qm...)
 *
 * Format: 0x01 + 32-byte SHA-256 hash
 * Output: base58btc(0x1220 + hash) = Qm...
 *
 * @param encodedUri - bytes32 hex string (with or without 0x prefix)
 * @returns IPFS URI (ipfs://Qm...) or null if invalid
 */
export function decodeEncodedIPFSUri(encodedUri: string | undefined | null): string | null {
  if (!encodedUri) return null

  // Remove 0x prefix if present
  let hex = encodedUri.startsWith('0x') ? encodedUri.slice(2) : encodedUri

  // Must be 64 or 66 hex chars (32 or 33 bytes)
  if (hex.length !== 64 && hex.length !== 66) return null

  // If 66 chars, skip the first byte (version marker 01)
  if (hex.length === 66) {
    hex = hex.slice(2)
  }

  // Check for zero hash (no IPFS content)
  if (hex === '0'.repeat(64)) return null

  // Build the multihash: 0x1220 (sha2-256, 32 bytes) + hash
  const multihashHex = '1220' + hex

  // Convert hex to bytes
  const bytes = new Uint8Array(multihashHex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(multihashHex.slice(i * 2, i * 2 + 2), 16)
  }

  // Base58 encode to get CIDv0 (Qm...)
  const cid = base58Encode(bytes)

  // CIDv0 should start with Qm
  if (!cid.startsWith('Qm')) return null

  return `ipfs://${cid}`
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

// ============================================
// IPFS Pinning Functions (requires Pinata API key)
// ============================================

export interface PinataResponse {
  IpfsHash: string
  PinSize: number
  Timestamp: string
}

export interface PinataError {
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
 * Project metadata format for Juicebox projects
 */
export interface JBProjectMetadata {
  name: string
  description?: string
  logoUri?: string
  infoUri?: string
  twitter?: string
  discord?: string
  telegram?: string
  /**
   * Project location - PUBLIC DATA
   * Only include information you're comfortable sharing publicly.
   * This data will be stored on IPFS and visible to anyone.
   * Omit this field entirely if you prefer not to share location.
   */
  location?: ProjectLocation
  // payButton and payDisclosure for custom pay UI
  payButton?: string
  payDisclosure?: string
}

/**
 * Pin project metadata to IPFS and return the URI
 * @param metadata - Project metadata object
 * @param jwt - Pinata JWT token
 * @returns IPFS URI (ipfs://CID)
 */
export async function pinProjectMetadata(
  metadata: JBProjectMetadata,
  jwt: string
): Promise<string> {
  const cid = await pinJson(metadata, jwt, `project-${metadata.name}`)
  return `ipfs://${cid}`
}

/**
 * Pin a logo image and return the IPFS URI
 * @param file - Image file
 * @param jwt - Pinata JWT token
 * @param projectName - Project name for labeling
 * @returns IPFS URI (ipfs://CID)
 */
export async function pinLogo(
  file: File,
  jwt: string,
  projectName?: string
): Promise<string> {
  const cid = await pinFile(file, jwt, projectName ? `logo-${projectName}` : 'project-logo')
  return `ipfs://${cid}`
}

/**
 * Test if Pinata JWT is valid
 * @param jwt - Pinata JWT token
 * @returns true if valid
 */
export async function testPinataConnection(jwt: string): Promise<boolean> {
  try {
    const response = await fetch(`${PINATA_API_URL}/data/testAuthentication`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${jwt}`,
      },
    })
    return response.ok
  } catch {
    return false
  }
}
