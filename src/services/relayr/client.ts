import { useSettingsStore } from '../../stores'

export interface QuoteRequest {
  fromChainId: number
  toChainId: number
  fromToken: string
  toToken: string
  amount: string
  recipient: string
}

export interface Quote {
  quoteId: string
  fromChainId: number
  toChainId: number
  fromToken: string
  toToken: string
  fromAmount: string
  toAmount: string
  estimatedGas: string
  fee: string
  expiresAt: number
}

export interface SendRequest {
  quoteId: string
  signature: string
}

export interface SendResponse {
  txHash: string
  status: 'pending' | 'submitted' | 'confirmed' | 'failed'
}

export interface TransactionStatusResponse {
  txHash: string
  status: 'pending' | 'submitted' | 'confirmed' | 'failed'
  fromTxHash?: string
  toTxHash?: string
  error?: string
}

function getEndpoint(): string {
  return useSettingsStore.getState().relayrEndpoint
}

async function fetchApi<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const endpoint = getEndpoint()
  const response = await fetch(`${endpoint}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }))
    throw new Error(error.message || `HTTP ${response.status}`)
  }

  return response.json()
}

export async function getQuote(request: QuoteRequest): Promise<Quote> {
  return fetchApi<Quote>('/v1/quote', {
    method: 'POST',
    body: JSON.stringify(request),
  })
}

export async function sendTransaction(request: SendRequest): Promise<SendResponse> {
  return fetchApi<SendResponse>('/v1/send', {
    method: 'POST',
    body: JSON.stringify(request),
  })
}

export async function getTransactionStatus(txHash: string): Promise<TransactionStatusResponse> {
  return fetchApi<TransactionStatusResponse>(`/v1/status/${txHash}`)
}

export async function getSupportedChains(): Promise<number[]> {
  const response = await fetchApi<{ chains: number[] }>('/v1/chains')
  return response.chains
}

export async function getSupportedTokens(chainId: number): Promise<string[]> {
  const response = await fetchApi<{ tokens: string[] }>(`/v1/tokens/${chainId}`)
  return response.tokens
}
