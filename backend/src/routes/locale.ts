/**
 * Locale Routes
 *
 * IP-based language detection and region analytics
 */

import { Hono } from 'hono';
import { detectGeoFromIP, getRegionStats, recordUserRegion } from '../services/geo.ts';
import { requireAdmin, requireAuth } from '../middleware/auth.ts';
import { getClientIdentifier } from '../services/rateLimit.ts';

export const localeRouter = new Hono();

/**
 * GET /detect
 * Detect user's region from IP and suggest a language
 */
localeRouter.get('/detect', async (c) => {
  // Get client IP from headers (handles proxies) or connection
  const ip = getClientIdentifier(c);

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
  const ip = getClientIdentifier(c);

  const geoInfo = await detectGeoFromIP(ip);

  if (geoInfo) {
    await recordUserRegion(ip, geoInfo, userId, languageUsed);
  }

  return c.json({ success: true });
});

/**
 * GET /stats
 * Get region statistics (admin only)
 */
localeRouter.get('/stats', requireAuth, requireAdmin, async (c) => {
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
