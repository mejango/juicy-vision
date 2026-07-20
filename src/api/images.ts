/**
 * Images API Service
 *
 * Communicates with the backend image generation endpoints.
 * Used for AI-generated NFT tier images and project logos.
 */

import { apiRequest as sharedApiRequest } from '../services/apiClient'

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

function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  // These endpoints historically only sent the managed auth token.
  return sharedApiRequest<T>(endpoint, options, { includeSiweAuth: false })
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

