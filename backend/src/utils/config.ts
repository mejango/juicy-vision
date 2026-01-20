import type { EnvConfig } from '../types/index.ts';

function getEnv(key: string, defaultValue?: string): string {
  const value = Deno.env.get(key);
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvNumber(key: string, defaultValue?: number): number {
  const value = Deno.env.get(key);
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  const num = parseInt(value, 10);
  if (isNaN(num)) {
    throw new Error(`Environment variable ${key} must be a number`);
  }
  return num;
}

export function loadConfig(): EnvConfig {
  return {
    // Server
    port: getEnvNumber('PORT', 3001),
    env: getEnv('DENO_ENV', 'development') as 'development' | 'production',

    // Database
    databaseUrl: getEnv('DATABASE_URL', 'postgresql://localhost:5432/juicyvision'),

    // Auth
    jwtSecret: getEnv('JWT_SECRET', 'dev-secret-change-in-production'),
    sessionDurationMs: getEnvNumber('SESSION_DURATION_MS', 7 * 24 * 60 * 60 * 1000), // 7 days

    // GCP KMS
    gcpProjectId: getEnv('GCP_PROJECT_ID', ''),
    gcpKeyRingId: getEnv('GCP_KEY_RING_ID', ''),
    gcpCryptoKeyId: getEnv('GCP_CRYPTO_KEY_ID', ''),
    gcpLocationId: getEnv('GCP_LOCATION_ID', 'us-east1'),

    // GCP Cloud Run
    gcpServiceAccount: getEnv('GCP_SERVICE_ACCOUNT', ''),
    cronSecret: getEnv('CRON_SECRET', 'dev-cron-secret'),

    // Stripe
    stripeSecretKey: getEnv('STRIPE_SECRET_KEY', ''),
    stripeWebhookSecret: getEnv('STRIPE_WEBHOOK_SECRET', ''),

    // Anthropic
    anthropicApiKey: getEnv('ANTHROPIC_API_KEY', ''),

    // Reserves wallet
    reservesPrivateKey: getEnv('RESERVES_PRIVATE_KEY', ''),

    // External API keys (for proxy endpoints)
    bendystrawApiKey: getEnv('BENDYSTRAW_API_KEY', ''),
    theGraphApiKey: getEnv('THEGRAPH_API_KEY', ''),
    ankrApiKey: getEnv('ANKR_API_KEY', ''),
  };
}

// Singleton config instance
let _config: EnvConfig | null = null;

export function getConfig(): EnvConfig {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

// Validate config has required values for specific features
export function validateConfigForAuth(config: EnvConfig): void {
  if (config.env === 'production' && config.jwtSecret === 'dev-secret-change-in-production') {
    throw new Error('JWT_SECRET must be set in production');
  }
}

export function validateConfigForKms(config: EnvConfig): void {
  if (!config.gcpProjectId || !config.gcpKeyRingId || !config.gcpCryptoKeyId) {
    throw new Error('GCP KMS configuration is incomplete');
  }
}

export function validateConfigForStripe(config: EnvConfig): void {
  if (!config.stripeSecretKey || !config.stripeWebhookSecret) {
    throw new Error('Stripe configuration is incomplete');
  }
}

export function validateConfigForClaude(config: EnvConfig): void {
  if (!config.anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY is required');
  }
}

export function validateConfigForCron(config: EnvConfig): void {
  if (config.env === 'production' && config.cronSecret === 'dev-cron-secret') {
    throw new Error('CRON_SECRET must be set in production');
  }
}
