import { useAuthStore } from '../stores/authStore'
import { getSessionId } from './session'
import { getWalletSessionToken } from './siwe'
import { isIpfsUri } from '../utils/ipfs'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

export async function pinMetadata(
  metadata: object,
  name: string,
): Promise<string> {
  const token = useAuthStore.getState().token || getWalletSessionToken()
  const response = await fetch(`${API_BASE_URL}/projects/pin-metadata`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': getSessionId(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ metadata, name }),
  })
  const result = await response.json() as {
    success: boolean
    data?: { uri?: string }
    error?: string
  }
  if (!response.ok || !result.success || !result.data?.uri || !isIpfsUri(result.data.uri, false)) {
    throw new Error(result.error || 'Failed to pin metadata')
  }
  return result.data.uri
}

/** Pin a media file (logo, cover image, item media) through the backend. */
export async function pinFileToBackend(file: File, name: string): Promise<string> {
  const token = useAuthStore.getState().token || getWalletSessionToken()
  const formData = new FormData()
  formData.append('file', file)
  formData.append('name', name)
  const response = await fetch(`${API_BASE_URL}/projects/pin-file`, {
    method: 'POST',
    headers: {
      'X-Session-ID': getSessionId(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  })
  const result = await response.json() as {
    success: boolean
    data?: { uri?: string }
    error?: string
  }
  if (!response.ok || !result.success || !result.data?.uri || !isIpfsUri(result.data.uri, false)) {
    throw new Error(result.error || 'Failed to pin file')
  }
  return result.data.uri
}
