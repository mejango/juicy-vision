// IPFS gateway resolution and pinning utilities

const IPFS_GATEWAY = 'https://gateway.pinata.cloud/ipfs/'
const PINATA_API_URL = 'https://api.pinata.cloud'

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
