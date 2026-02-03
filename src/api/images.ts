/**
 * Images API Service
 *
 * Communicates with the backend image generation endpoints.
 * Used for AI-generated NFT tier images and project logos.
 */

import { useAuthStore } from '../stores/authStore'
import { getSessionId } from '../services/session'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

// =============================================================================
// Types
// =============================================================================

export interface GeneratedImage {
  ipfsUri: string
  httpUrl: string
}

export interface ImageGenerationContext {
  name: string
  description?: string
  projectTheme?: string
  style?: 'digital-art' | 'illustration' | 'photo' | 'abstract'
}

// =============================================================================
// API Client
// =============================================================================

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = useAuthStore.getState().token
  const sessionId = getSessionId()

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Session-ID': sessionId,
    ...(options.headers as Record<string, string>),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  })

  const data: ApiResponse<T> = await response.json()

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Request failed')
  }

  return data.data as T
}

// =============================================================================
// Image Generation Functions
// =============================================================================

/**
 * Generate an AI image for an NFT tier.
 * Automatically builds an optimized prompt from the tier context.
 *
 * @param tierName - Name of the NFT tier
 * @param tierDescription - Optional description of the tier
 * @param projectContext - Optional context about the project (theme, purpose)
 * @param style - Optional style preference
 * @returns Generated image with IPFS URI and HTTP URL
 */
export async function generateTierImage(
  tierName: string,
  tierDescription?: string,
  projectContext?: string,
  style?: ImageGenerationContext['style']
): Promise<GeneratedImage> {
  return apiRequest<GeneratedImage>('/images/generate', {
    method: 'POST',
    body: JSON.stringify({
      context: {
        name: tierName,
        description: tierDescription,
        projectTheme: projectContext,
        style,
      },
    }),
  })
}

/**
 * Generate an AI image from a direct prompt.
 * Use this when you want full control over the image prompt.
 *
 * @param prompt - Full prompt for image generation
 * @returns Generated image with IPFS URI and HTTP URL
 */
export async function generateImageFromPrompt(prompt: string): Promise<GeneratedImage> {
  return apiRequest<GeneratedImage>('/images/generate', {
    method: 'POST',
    body: JSON.stringify({ prompt }),
  })
}

/**
 * Generate a project logo image.
 *
 * @param projectName - Name of the project
 * @param projectDescription - Optional description of the project
 * @returns Generated image with IPFS URI and HTTP URL
 */
export async function generateProjectLogo(
  projectName: string,
  projectDescription?: string
): Promise<GeneratedImage> {
  return apiRequest<GeneratedImage>('/images/generate', {
    method: 'POST',
    body: JSON.stringify({
      context: {
        name: `${projectName} Logo`,
        description: projectDescription,
        style: 'digital-art',
      },
    }),
  })
}
