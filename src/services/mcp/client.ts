// Juicebox MCP Server Client
// Base URL: https://docs.juicebox.money/api/mcp

const MCP_BASE_URL = 'https://docs.juicebox.money/api/mcp'

export interface SearchDocsParams {
  query: string
  category?: 'developer' | 'user' | 'dao' | 'ecosystem' | 'all'
  version?: 'v3' | 'v4' | 'v5' | 'all'
  limit?: number
}

export interface GetDocParams {
  path?: string
  title?: string
}

export interface SearchCodeParams {
  query: string
  language?: 'solidity' | 'typescript' | 'javascript' | 'all'
  limit?: number
}

export interface GetContractsParams {
  contract?: string
  chainId?: 1 | 10 | 8453 | 42161 | 'testnets' | 'all'
  category?: 'core' | 'revnet' | 'hooks' | 'suckers' | 'omnichain' | 'all'
}

export interface GetPatternsParams {
  projectType?: string
}

// Search documentation
export async function searchDocs(params: SearchDocsParams): Promise<unknown> {
  const response = await fetch(`${MCP_BASE_URL}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!response.ok) throw new Error(`MCP search failed: ${response.status}`)
  return response.json()
}

// Get a specific document
export async function getDoc(params: GetDocParams): Promise<unknown> {
  const response = await fetch(`${MCP_BASE_URL}/get-doc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!response.ok) throw new Error(`MCP get-doc failed: ${response.status}`)
  return response.json()
}

// List all documents in a category
export async function listDocs(category?: string): Promise<unknown> {
  const url = category
    ? `${MCP_BASE_URL}/list-docs?category=${category}`
    : `${MCP_BASE_URL}/list-docs`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`MCP list-docs failed: ${response.status}`)
  return response.json()
}

// Get documentation structure
export async function getStructure(): Promise<unknown> {
  const response = await fetch(`${MCP_BASE_URL}/structure`)
  if (!response.ok) throw new Error(`MCP structure failed: ${response.status}`)
  return response.json()
}

// Search code examples
export async function searchCode(params: SearchCodeParams): Promise<unknown> {
  const response = await fetch(`${MCP_BASE_URL}/search-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!response.ok) throw new Error(`MCP search-code failed: ${response.status}`)
  return response.json()
}

// Get contract addresses
export async function getContracts(params: GetContractsParams = {}): Promise<unknown> {
  const queryParams = new URLSearchParams()
  if (params.contract) queryParams.set('contract', params.contract)
  if (params.chainId) queryParams.set('chainId', String(params.chainId))
  if (params.category) queryParams.set('category', params.category)

  const url = queryParams.toString()
    ? `${MCP_BASE_URL}/contracts?${queryParams}`
    : `${MCP_BASE_URL}/contracts`

  const response = await fetch(url)
  if (!response.ok) throw new Error(`MCP contracts failed: ${response.status}`)
  return response.json()
}

// Get SDK reference
export async function getSdk(): Promise<unknown> {
  const response = await fetch(`${MCP_BASE_URL}/sdk`)
  if (!response.ok) throw new Error(`MCP sdk failed: ${response.status}`)
  return response.json()
}

// Get integration patterns
export async function getPatterns(params: GetPatternsParams = {}): Promise<unknown> {
  const url = params.projectType
    ? `${MCP_BASE_URL}/patterns?projectType=${params.projectType}`
    : `${MCP_BASE_URL}/patterns`

  const response = await fetch(url)
  if (!response.ok) throw new Error(`MCP patterns failed: ${response.status}`)
  return response.json()
}

// Execute MCP tool by name
export async function executeMcpTool(
  toolName: string,
  params: Record<string, unknown>
): Promise<unknown> {
  switch (toolName) {
    case 'search_docs':
      return searchDocs(params as unknown as SearchDocsParams)
    case 'get_doc':
      return getDoc(params as unknown as GetDocParams)
    case 'list_docs':
      return listDocs(params.category as string | undefined)
    case 'get_structure':
      return getStructure()
    case 'search_code':
      return searchCode(params as unknown as SearchCodeParams)
    case 'get_contracts':
      return getContracts(params as unknown as GetContractsParams)
    case 'get_sdk':
      return getSdk()
    case 'get_patterns':
      return getPatterns(params as unknown as GetPatternsParams)
    default:
      throw new Error(`Unknown MCP tool: ${toolName}`)
  }
}
