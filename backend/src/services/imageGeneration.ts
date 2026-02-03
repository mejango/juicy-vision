/**
 * Image Generation Service
 *
 * Generates AI images via Replicate API and uploads to IPFS via Pinata.
 * Used for auto-generating NFT tier images and project logos.
 */

import { getConfig } from '../utils/config.ts';
import { pinFileToIpfs } from './ipfs.ts';

// ============================================================================
// Types
// ============================================================================

export interface ImageGenerationContext {
  name: string;
  description?: string;
  projectTheme?: string;
  style?: 'digital-art' | 'illustration' | 'photo' | 'abstract';
}

export interface GeneratedImage {
  ipfsUri: string;
  httpUrl: string;
}

// ============================================================================
// Prompt Engineering
// ============================================================================

/**
 * Build an optimized prompt for NFT artwork generation
 */
export function buildImagePrompt(context: ImageGenerationContext): string {
  const style = context.style || 'digital-art';

  const parts = [
    `Create a unique NFT artwork for "${context.name}".`,
  ];

  if (context.description) {
    parts.push(`Theme: ${context.description}.`);
  }

  if (context.projectTheme) {
    parts.push(`Project context: ${context.projectTheme}.`);
  }

  parts.push(`Style: ${style}, vibrant colors, detailed, suitable for NFT collection.`);
  parts.push('Square format, centered composition.');

  return parts.join(' ');
}

// ============================================================================
// Replicate API
// ============================================================================

const REPLICATE_API_URL = 'https://api.replicate.com/v1';

// Using Flux Schnell - fast and high quality
const FLUX_MODEL = 'black-forest-labs/flux-schnell';

interface ReplicatePrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output: string[] | null;
  error: string | null;
  urls: {
    get: string;
    cancel: string;
  };
}

/**
 * Start a prediction on Replicate
 */
async function createPrediction(
  prompt: string,
  apiToken: string
): Promise<ReplicatePrediction> {
  const response = await fetch(`${REPLICATE_API_URL}/models/${FLUX_MODEL}/predictions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      'Prefer': 'wait', // Wait for prediction to complete (up to 60s)
    },
    body: JSON.stringify({
      input: {
        prompt,
        num_outputs: 1,
        aspect_ratio: '1:1', // Square for NFTs
        output_format: 'webp',
        output_quality: 90,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Replicate API error: ${response.status} - ${error}`);
  }

  return response.json();
}

/**
 * Poll prediction status until complete
 */
async function waitForPrediction(
  predictionUrl: string,
  apiToken: string,
  maxWaitMs: number = 120000 // 2 minutes max
): Promise<ReplicatePrediction> {
  const startTime = Date.now();
  const pollIntervalMs = 1000;

  while (Date.now() - startTime < maxWaitMs) {
    const response = await fetch(predictionUrl, {
      headers: {
        'Authorization': `Bearer ${apiToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get prediction status: ${response.status}`);
    }

    const prediction: ReplicatePrediction = await response.json();

    if (prediction.status === 'succeeded') {
      return prediction;
    }

    if (prediction.status === 'failed') {
      throw new Error(`Image generation failed: ${prediction.error || 'Unknown error'}`);
    }

    if (prediction.status === 'canceled') {
      throw new Error('Image generation was canceled');
    }

    // Wait before polling again
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error('Image generation timed out');
}

/**
 * Download image from URL and return as bytes
 */
async function downloadImage(url: string): Promise<Uint8Array> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

// ============================================================================
// IPFS Upload
// ============================================================================

/**
 * Convert Uint8Array to base64 string
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Upload image bytes to Pinata IPFS
 */
async function uploadToIpfs(
  imageBytes: Uint8Array,
  fileName: string
): Promise<string> {
  // Convert to base64 and use the existing IPFS service
  const base64Data = uint8ArrayToBase64(imageBytes);
  return pinFileToIpfs(base64Data, fileName, 'image/webp');
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Generate an image from a prompt and upload to IPFS
 *
 * @param prompt - The image generation prompt
 * @returns IPFS URI and HTTP gateway URL
 */
export async function generateImage(prompt: string): Promise<GeneratedImage> {
  const config = getConfig();

  if (!config.replicateApiToken) {
    throw new Error('Replicate API token not configured');
  }

  console.log(`[ImageGen] Generating image for prompt: ${prompt.substring(0, 100)}...`);

  // Create prediction on Replicate
  let prediction = await createPrediction(prompt, config.replicateApiToken);

  // If not completed synchronously, poll for completion
  if (prediction.status !== 'succeeded') {
    prediction = await waitForPrediction(
      prediction.urls.get,
      config.replicateApiToken
    );
  }

  if (!prediction.output || prediction.output.length === 0) {
    throw new Error('No image output from generation');
  }

  const imageUrl = prediction.output[0];
  console.log(`[ImageGen] Image generated: ${imageUrl}`);

  // Download the image
  const imageBytes = await downloadImage(imageUrl);
  console.log(`[ImageGen] Downloaded ${imageBytes.length} bytes`);

  // Upload to IPFS
  const fileName = `ai-generated-${Date.now()}.webp`;
  const cid = await uploadToIpfs(imageBytes, fileName);
  console.log(`[ImageGen] Uploaded to IPFS: ${cid}`);

  return {
    ipfsUri: `ipfs://${cid}`,
    httpUrl: `https://gateway.pinata.cloud/ipfs/${cid}`,
  };
}

/**
 * Generate an image from context (name, description, etc.)
 * Builds an optimized prompt automatically.
 */
export async function generateImageFromContext(
  context: ImageGenerationContext
): Promise<GeneratedImage> {
  const prompt = buildImagePrompt(context);
  return generateImage(prompt);
}
