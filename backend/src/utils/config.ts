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

    // Encryption (for E2E keypair storage - MUST be different from JWT secret)
    encryptionMasterKey: getEnv('ENCRYPTION_MASTER_KEY', 'dev-encryption-key-change-in-production'),

    // Cron jobs
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

    // IPFS (Pinata)
    ipfsApiUrl: getEnv('IPFS_API_URL', 'https://api.pinata.cloud'),
    ipfsApiKey: getEnv('IPFS_API_KEY', ''),
    ipfsApiSecret: getEnv('IPFS_API_SECRET', ''),
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

export function validateConfigForEncryption(config: EnvConfig): void {
  if (config.env === 'production') {
    if (config.encryptionMasterKey === 'dev-encryption-key-change-in-production') {
      throw new Error('ENCRYPTION_MASTER_KEY must be set in production');
    }
    // Ensure encryption key is different from JWT secret
    if (config.encryptionMasterKey === config.jwtSecret) {
      throw new Error('ENCRYPTION_MASTER_KEY must be different from JWT_SECRET');
    }
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

export function validateConfigForReserves(config: EnvConfig): void {
  if (!config.reservesPrivateKey) {
    throw new Error('RESERVES_PRIVATE_KEY is required for wallet operations');
  }

  // Basic format validation
  if (!config.reservesPrivateKey.startsWith('0x') || config.reservesPrivateKey.length !== 66) {
    throw new Error('RESERVES_PRIVATE_KEY must be a valid 32-byte hex string starting with 0x');
  }

  // Warn if using test key in production
  if (config.env === 'production') {
    // Check for known test keys
    const testKeys = [
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // Hardhat #0
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', // Hardhat #1
      '0xbc7633f748cb696bd42c031308235e89f985c787e909aca73cb5606a0ae01bfd', // Dev key from .env
    ];

    if (testKeys.includes(config.reservesPrivateKey.toLowerCase())) {
      throw new Error('RESERVES_PRIVATE_KEY appears to be a test key - do not use in production');
    }
  }
}
