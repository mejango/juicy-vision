/**
 * Shared backend API request helper.
 *
 * All backend endpoints speak the same `{ success, data, error }` envelope and
 * expect the anonymous session ID plus (when available) a bearer token.
 * `apiRequest` unwraps `data`; `apiRequestEnvelope` returns the whole parsed
 * body for endpoints that put extra fields (e.g. `total`) beside `data`.
 */

import { useAuthStore } from '../stores/authStore'
import { getSessionId } from './session'
import { getWalletSessionToken } from './siwe'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

export interface ApiEnvelope<T> {
  success: boolean
  data?: T
  error?: string
  total?: number
}

export interface ApiRequestConfig {
  /**
   * Fall back to the SIWE wallet-session token for the Authorization header
   * when no managed auth token is present (chat endpoints). Endpoints that
   * historically only sent the managed token pass `false`.
   */
  includeSiweAuth?: boolean
}

async function requestEnvelope<T>(
  endpoint: string,
  options: RequestInit,
  config: ApiRequestConfig
): Promise<ApiEnvelope<T>> {
  const token = useAuthStore.getState().token
  const siweToken = config.includeSiweAuth !== false ? getWalletSessionToken() : null
  const sessionId = getSessionId()

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Session-ID': sessionId, // Always include session ID
    ...(options.headers as Record<string, string>),
  }

  // Include auth token if available (managed wallets or SIWE self-custody wallets)
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  } else if (siweToken) {
    headers['Authorization'] = `Bearer ${siweToken}`
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  })

  const body: ApiEnvelope<T> = await response.json()

  if (!response.ok || !body.success) {
    throw new Error(body.error || 'Request failed')
  }

  return body
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
  config: ApiRequestConfig = {}
): Promise<T> {
  const body = await requestEnvelope<T>(endpoint, options, config)
  return body.data as T
}

export async function apiRequestEnvelope<T>(
  endpoint: string,
  options: RequestInit = {},
  config: ApiRequestConfig = {}
): Promise<ApiEnvelope<T>> {
  return requestEnvelope<T>(endpoint, options, config)
}
