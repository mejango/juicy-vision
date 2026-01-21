/**
 * Geo Location Service
 *
 * Detects user region from IP address and maps to suggested language
 */

import { query, execute } from '../db/index.ts';

// Country code to language mapping
const COUNTRY_TO_LANGUAGE: Record<string, string> = {
  // Portuguese
  BR: 'pt', PT: 'pt', AO: 'pt', MZ: 'pt',
  // Spanish
  ES: 'es', MX: 'es', AR: 'es', CO: 'es', PE: 'es', VE: 'es', CL: 'es', EC: 'es',
  GT: 'es', CU: 'es', BO: 'es', DO: 'es', HN: 'es', PY: 'es', SV: 'es', NI: 'es',
  CR: 'es', PA: 'es', UY: 'es', PR: 'es',
  // Chinese
  CN: 'zh', TW: 'zh', HK: 'zh', SG: 'zh',
  // Default to English for all others
};

// Supported languages (must match frontend locales)
const SUPPORTED_LANGUAGES = ['en', 'es', 'pt', 'zh'];

export interface GeoInfo {
  countryCode: string;
  country: string;
  region: string;
  city: string;
  suggestedLanguage: string;
}

/**
 * Detect geo location from IP address using ip-api.com (free tier)
 */
export async function detectGeoFromIP(ip: string): Promise<GeoInfo | null> {
  try {
    // Handle localhost/private IPs
    if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
      return {
        countryCode: 'US',
        country: 'United States',
        region: 'Development',
        city: 'Localhost',
        suggestedLanguage: 'en',
      };
    }

    // Use ip-api.com free tier (45 requests/minute, no API key needed)
    const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,region,city`);

    if (!response.ok) {
      console.error('[Geo] ip-api request failed:', response.status);
      return null;
    }

    const data = await response.json();

    if (data.status !== 'success') {
      console.error('[Geo] ip-api returned error for IP:', ip);
      return null;
    }

    const countryCode = data.countryCode || 'US';
    const suggestedLanguage = COUNTRY_TO_LANGUAGE[countryCode] || 'en';

    return {
      countryCode,
      country: data.country || 'Unknown',
      region: data.region || 'Unknown',
      city: data.city || 'Unknown',
      suggestedLanguage: SUPPORTED_LANGUAGES.includes(suggestedLanguage) ? suggestedLanguage : 'en',
    };
  } catch (error) {
    console.error('[Geo] Failed to detect location:', error);
    return null;
  }
}

/**
 * Record a user visit with their region (for analytics)
 */
export async function recordUserRegion(
  ip: string,
  geoInfo: GeoInfo,
  userId?: string,
  languageUsed?: string
): Promise<void> {
  try {
    await execute(
      `INSERT INTO user_regions (
        ip_hash, country_code, country, region, city,
        suggested_language, language_used, user_id, visited_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        hashIP(ip), // Store hashed IP for privacy
        geoInfo.countryCode,
        geoInfo.country,
        geoInfo.region,
        geoInfo.city,
        geoInfo.suggestedLanguage,
        languageUsed || geoInfo.suggestedLanguage,
        userId || null,
      ]
    );
  } catch (error) {
    // Non-critical - just log
    console.error('[Geo] Failed to record user region:', error);
  }
}

/**
 * Get region stats for analytics
 */
export async function getRegionStats(): Promise<{
  byCountry: { countryCode: string; country: string; count: number }[];
  byLanguage: { language: string; count: number }[];
  total: number;
}> {
  const [byCountry, byLanguage, totalResult] = await Promise.all([
    query<{ country_code: string; country: string; count: string }>(
      `SELECT country_code, country, COUNT(*) as count
       FROM user_regions
       GROUP BY country_code, country
       ORDER BY count DESC
       LIMIT 50`
    ),
    query<{ language: string; count: string }>(
      `SELECT language_used as language, COUNT(*) as count
       FROM user_regions
       GROUP BY language_used
       ORDER BY count DESC`
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) as count FROM user_regions`
    ),
  ]);

  return {
    byCountry: byCountry.map((r) => ({
      countryCode: r.country_code,
      country: r.country,
      count: parseInt(r.count, 10),
    })),
    byLanguage: byLanguage.map((r) => ({
      language: r.language,
      count: parseInt(r.count, 10),
    })),
    total: parseInt(totalResult[0]?.count || '0', 10),
  };
}

/**
 * Hash IP for privacy (we don't need to store raw IPs)
 */
function hashIP(ip: string): string {
  // Simple hash - in production you might use crypto.subtle
  let hash = 0;
  for (let i = 0; i < ip.length; i++) {
    const char = ip.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(16);
}
