/**
 * Context API Routes
 *
 * Serves knowledge bases and tool definitions to the frontend
 */

import { Hono } from 'hono';
import { OMNICHAIN_CONTEXT, OMNICHAIN_TOOLS, SUPPORTED_CHAINS } from '../context/omnichain.ts';

export const contextRouter = new Hono();

/**
 * GET /context/omnichain - Get omnichain knowledge base
 */
contextRouter.get('/omnichain', (c) => {
  return c.json({
    success: true,
    data: {
      context: OMNICHAIN_CONTEXT,
      tools: OMNICHAIN_TOOLS,
      supportedChains: SUPPORTED_CHAINS,
    },
  });
});

/**
 * GET /context/tools - Get all available tools
 */
contextRouter.get('/tools', (c) => {
  return c.json({
    success: true,
    data: {
      omnichain: OMNICHAIN_TOOLS,
      // Add other tool categories here as they're created
    },
  });
});

/**
 * GET /context/chains - Get supported chain information
 */
contextRouter.get('/chains', (c) => {
  return c.json({
    success: true,
    data: SUPPORTED_CHAINS,
  });
});
