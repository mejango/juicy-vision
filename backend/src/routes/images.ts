/**
 * Image Generation Routes
 *
 * Endpoints for AI image generation and IPFS upload.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { generateImage, generateImageFromContext } from '../services/imageGeneration.ts';
import { optionalAuth } from '../middleware/auth.ts';

export const imagesRouter = new Hono();

// =============================================================================
// Validation Schemas
// =============================================================================

const GenerateImageSchema = z.object({
  prompt: z.string().min(1).max(2000).optional(),
  context: z.object({
    name: z.string().min(1).max(255),
    description: z.string().max(1000).optional(),
    projectTheme: z.string().max(500).optional(),
    style: z.enum(['digital-art', 'illustration', 'photo', 'abstract']).optional(),
  }).optional(),
}).refine(
  (data) => data.prompt || data.context,
  { message: 'Either prompt or context is required' }
);

// =============================================================================
// Routes
// =============================================================================

/**
 * POST /images/generate
 *
 * Generate an AI image and upload to IPFS.
 *
 * Request body:
 * - prompt: Direct prompt for image generation
 * - context: { name, description?, projectTheme?, style? } - Auto-builds prompt
 *
 * Response:
 * - ipfsUri: IPFS URI (ipfs://Qm...)
 * - httpUrl: HTTP gateway URL for preview
 */
imagesRouter.post(
  '/generate',
  optionalAuth,
  zValidator('json', GenerateImageSchema),
  async (c) => {
    const data = c.req.valid('json');

    try {
      let result;

      if (data.prompt) {
        // Direct prompt provided
        result = await generateImage(data.prompt);
      } else if (data.context) {
        // Build prompt from context
        result = await generateImageFromContext(data.context);
      } else {
        return c.json({ success: false, error: 'Either prompt or context is required' }, 400);
      }

      return c.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('[Images] Generation failed:', error);
      const message = error instanceof Error ? error.message : 'Image generation failed';

      // Return specific error codes for known issues
      if (message.includes('not configured')) {
        return c.json({ success: false, error: 'Image generation service not configured' }, 503);
      }
      if (message.includes('timed out')) {
        return c.json({ success: false, error: 'Image generation timed out, please try again' }, 504);
      }

      return c.json({ success: false, error: message }, 500);
    }
  }
);
