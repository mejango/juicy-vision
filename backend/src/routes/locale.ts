/**
 * Locale Routes
 *
 * IP-based language detection and region analytics
 */

import { Hono } from 'hono';
import { detectGeoFromIP, recordUserRegion, getRegionStats } from '../services/geo.ts';
import { authMiddleware } from '../middleware/auth.ts';

export const localeRouter = new Hono();

/**
 * GET /detect
 * Detect user's region from IP and suggest a language
 */
localeRouter.get('/detect', async (c) => {
  // Get client IP from headers (handles proxies) or connection
  const forwardedFor = c.req.header('x-forwarded-for');
  const realIP = c.req.header('x-real-ip');
  const cfConnectingIP = c.req.header('cf-connecting-ip'); // Cloudflare

  let ip = cfConnectingIP || realIP || forwardedFor?.split(',')[0]?.trim();

  // Fallback to connection info if available
  if (!ip) {
    const connInfo = c.env?.remoteAddr;
    if (connInfo && typeof connInfo === 'object' && 'hostname' in connInfo) {
      ip = connInfo.hostname;
    }
  }

  // Default for development
  if (!ip) {
    ip = '127.0.0.1';
  }

  const geoInfo = await detectGeoFromIP(ip);

  if (!geoInfo) {
    return c.json({
      success: true,
      data: {
        countryCode: 'US',
        country: 'Unknown',
        suggestedLanguage: 'en',
      },
    });
  }

  return c.json({
    success: true,
    data: {
      countryCode: geoInfo.countryCode,
      country: geoInfo.country,
      region: geoInfo.region,
      city: geoInfo.city,
      suggestedLanguage: geoInfo.suggestedLanguage,
    },
  });
});

/**
 * POST /record
 * Record a user visit with their actual language choice (for analytics)
 */
localeRouter.post('/record', async (c) => {
  const body = await c.req.json();
  const { languageUsed, userId } = body;

  // Get client IP
  const forwardedFor = c.req.header('x-forwarded-for');
  const realIP = c.req.header('x-real-ip');
  const cfConnectingIP = c.req.header('cf-connecting-ip');

  let ip = cfConnectingIP || realIP || forwardedFor?.split(',')[0]?.trim() || '127.0.0.1';

  const geoInfo = await detectGeoFromIP(ip);

  if (geoInfo) {
    await recordUserRegion(ip, geoInfo, userId, languageUsed);
  }

  return c.json({ success: true });
});

/**
 * GET /stats
 * Get region statistics (admin only - add auth check in production)
 */
localeRouter.get('/stats', async (c) => {
  try {
    const stats = await getRegionStats();

    return c.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('[Locale] Failed to get stats:', error);
    return c.json({
      success: false,
      error: 'Failed to get region stats',
    }, 500);
  }
});
