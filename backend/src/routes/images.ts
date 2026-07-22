/**
 * Image Generation Routes
 *
 * Endpoints for AI image generation and IPFS upload.
 */

import { Hono, type MiddlewareHandler } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { generateImage, generateImageFromContext } from '../services/imageGeneration.ts';
import { requireAuth } from '../middleware/auth.ts';
import { rateLimitByUser } from '../services/rateLimit.ts';
import { costBodyLimit } from '../middleware/bodyLimit.ts';

// =============================================================================
// Validation Schemas
// =============================================================================

export const GenerateImageSchema = z.object({
  prompt: z.string().min(1).max(2000).optional(),
  context: z.object({
    name: z.string().min(1).max(255),
    description: z.string().max(1000).optional(),
    projectTheme: z.string().max(500).optional(),
    style: z.enum(['digital-art', 'illustration', 'photo', 'abstract']).optional(),
  }).optional(),
}).refine(
  (data) => data.prompt || data.context,
  { message: 'Either prompt or context is required' },
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
interface ImagesRouterDependencies {
  authenticate: MiddlewareHandler;
  rateLimit: MiddlewareHandler;
  generateFromPrompt: typeof generateImage;
  generateFromContext: typeof generateImageFromContext;
}

export function createImagesRouter(
  dependencies: ImagesRouterDependencies = {
    authenticate: requireAuth,
    rateLimit: rateLimitByUser('imageGenerate'),
    generateFromPrompt: generateImage,
    generateFromContext: generateImageFromContext,
  },
): Hono {
  const router = new Hono();

  router.post(
    '/generate',
    dependencies.authenticate,
    dependencies.rateLimit,
    costBodyLimit,
    zValidator('json', GenerateImageSchema),
    async (c) => {
      const data = c.req.valid('json');

      try {
        let result;

        if (data.prompt) {
          result = await dependencies.generateFromPrompt(data.prompt);
        } else if (data.context) {
          result = await dependencies.generateFromContext(data.context);
        } else {
          return c.json({ success: false, error: 'Either prompt or context is required' }, 400);
        }

        return c.json({ success: true, data: result });
      } catch (error) {
        console.error('[Images] Generation failed:', error);
        const message = error instanceof Error ? error.message : 'Image generation failed';

        if (message.includes('not configured')) {
          return c.json({ success: false, error: 'Image generation service not configured' }, 503);
        }
        if (message.includes('timed out')) {
          return c.json(
            { success: false, error: 'Image generation timed out, please try again' },
            504,
          );
        }

        return c.json({ success: false, error: message }, 500);
      }
    },
  );

  return router;
}

export const imagesRouter = createImagesRouter();
