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
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Environment variable ${key} must be a number`);
  }
  return num;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = getEnv(key, String(defaultValue));
  if (value !== 'true' && value !== 'false') {
    throw new Error(`Environment variable ${key} must be either true or false`);
  }
  return value === 'true';
}

function getEnvironment(): 'development' | 'production' {
  const value = getEnv('DENO_ENV', 'development');
  if (value !== 'development' && value !== 'production') {
    throw new Error('DENO_ENV must be either development or production');
  }
  return value;
}

function getAiProvider(): 'anthropic' | 'moonshot' {
  const value = getEnv('AI_PROVIDER', 'anthropic');
  if (value !== 'anthropic' && value !== 'moonshot') {
    throw new Error('AI_PROVIDER must be either anthropic or moonshot');
  }
  return value;
}

function getEnvList(key: string, defaultValue: string[] = []): string[] {
  const value = Deno.env.get(key);
  if (value === undefined) return defaultValue;
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function loadConfig(): EnvConfig {
  return {
    // Server
    port: getEnvNumber('PORT', 3004),
    env: getEnvironment(),
    isTestnet: getEnvBoolean('TESTNET_MODE', false),
    trustProxy: getEnvBoolean('TRUST_PROXY', false),
    allowedOrigins: getEnvList('ALLOWED_ORIGINS', [
      'http://localhost:3003',
      'http://127.0.0.1:3003',
    ]),

    // Database
    databaseUrl: getEnv(
      'DATABASE_URL',
      'postgresql://localhost:5432/juicyvision',
    ),

    // Auth
    jwtSecret: getEnv('JWT_SECRET', 'dev-secret-change-in-production'),
    sessionDurationMs: getEnvNumber(
      'SESSION_DURATION_MS',
      7 * 24 * 60 * 60 * 1000,
    ), // 7 days

    // Encryption (for E2E keypair storage - MUST be different from JWT secret)
    encryptionMasterKey: getEnv(
      'ENCRYPTION_MASTER_KEY',
      'dev-encryption-key-change-in-production',
    ),

    // Cron jobs
    cronSecret: getEnv('CRON_SECRET', 'dev-cron-secret'),

    // Stripe
    stripeSecretKey: getEnv('STRIPE_SECRET_KEY', ''),
    stripePublishableKey: getEnv('STRIPE_PUBLISHABLE_KEY', ''),
    stripeWebhookSecret: getEnv('STRIPE_WEBHOOK_SECRET', ''),

    // AI Provider
    aiProvider: getAiProvider(),
    aiFreeMode: getEnv('AI_FREE_MODE', 'true') === 'true', // Beta: AI is free by default
    aiBillingProjectId: getEnvNumber('AI_BILLING_PROJECT_ID', 0),

    // Anthropic
    anthropicApiKey: getEnv('ANTHROPIC_API_KEY', ''),

    // Moonshot (Kimi)
    moonshotApiKey: getEnv('MOONSHOT_API_KEY', ''),
    moonshotModel: getEnv('MOONSHOT_MODEL', 'moonshot-v1-32k'),

    // Reserves wallet
    reservesPrivateKey: getEnv('RESERVES_PRIVATE_KEY', ''),

    // External API keys (for proxy endpoints)
    bendystrawApiKey: getEnv('BENDYSTRAW_API_KEY', ''),
    theGraphApiKey: getEnv('THEGRAPH_API_KEY', ''),
    ankrApiKey: getEnv('ANKR_API_KEY', ''),

    // Redundant IPFS pinning (Filebase canonical upload + Pinata replication)
    ipfsPinningEnabled: getEnvBoolean('IPFS_PINNING_ENABLED', false),
    filebaseIpfsRpcToken: getEnv('FILEBASE_IPFS_RPC_TOKEN', ''),
    pinataJwt: getEnv('PINATA_JWT', ''),

    // Forge (Hook Development)
    forgeDockerEnabled: getEnv('FORGE_DOCKER_ENABLED', 'false') === 'true',
    forgeSandboxImage: getEnv('FORGE_SANDBOX_IMAGE', ''),
    semgrepEnabled: getEnv('SEMGREP_ENABLED', 'false') === 'true',

    // Replicate (Image Generation)
    replicateApiToken: getEnv('REPLICATE_API_TOKEN', ''),

    // Voyage AI (Embeddings for semantic intent detection)
    voyageApiKey: getEnv('VOYAGE_API_KEY', ''),
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
  if (config.env === 'production') {
    if (
      config.jwtSecret === 'dev-secret-change-in-production' ||
      config.jwtSecret.length < 32
    ) {
      throw new Error(
        'JWT_SECRET must be an unpredictable value of at least 32 characters',
      );
    }
  }
}

export function validateConfigForEncryption(config: EnvConfig): void {
  if (config.env === 'production') {
    if (
      config.encryptionMasterKey ===
        'dev-encryption-key-change-in-production' ||
      config.encryptionMasterKey.length < 32
    ) {
      throw new Error(
        'ENCRYPTION_MASTER_KEY must be an unpredictable value of at least 32 characters',
      );
    }
    // Ensure encryption key is different from JWT secret
    if (config.encryptionMasterKey === config.jwtSecret) {
      throw new Error(
        'ENCRYPTION_MASTER_KEY must be different from JWT_SECRET',
      );
    }
  }
}

export function validateConfigForStripe(config: EnvConfig): void {
  if (!config.stripeSecretKey || !config.stripeWebhookSecret) {
    throw new Error('Stripe configuration is incomplete');
  }
}

export function validateConfigForReserves(config: EnvConfig): void {
  if (!config.reservesPrivateKey) {
    throw new Error('RESERVES_PRIVATE_KEY is required for wallet operations');
  }

  // Basic format validation
  if (!/^0x[a-fA-F0-9]{64}$/.test(config.reservesPrivateKey)) {
    throw new Error(
      'RESERVES_PRIVATE_KEY must be a valid 32-byte hex string starting with 0x',
    );
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
      throw new Error(
        'RESERVES_PRIVATE_KEY appears to be a test key - do not use in production',
      );
    }
  }
}

export function validateConfigForDatabase(config: EnvConfig): void {
  if (config.env !== 'production') return;

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(config.databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }

  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    throw new Error(
      'DATABASE_URL must use the postgres or postgresql protocol',
    );
  }
  if (['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname)) {
    throw new Error('DATABASE_URL must not target localhost in production');
  }
}

export function validateConfigForCron(config: EnvConfig): void {
  if (
    config.env === 'production' &&
    (config.cronSecret === 'dev-cron-secret' || config.cronSecret.length < 32)
  ) {
    throw new Error(
      'CRON_SECRET must be an unpredictable value of at least 32 characters',
    );
  }
}

export function validateConfigForCors(config: EnvConfig): void {
  if (config.env !== 'production') return;
  if (config.allowedOrigins.length === 0) {
    throw new Error(
      'ALLOWED_ORIGINS must contain at least one production frontend origin',
    );
  }

  for (const origin of config.allowedOrigins) {
    if (origin.includes('*')) {
      throw new Error(
        `Production origin must not contain a wildcard: ${origin}`,
      );
    }
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`ALLOWED_ORIGINS contains an invalid origin: ${origin}`);
    }
    if (parsed.origin !== origin || parsed.protocol !== 'https:') {
      throw new Error(
        `Production origin must be an exact HTTPS origin: ${origin}`,
      );
    }
  }
}

export function validateConfigForIpfs(config: EnvConfig): void {
  if (!config.ipfsPinningEnabled) return;
  if (config.filebaseIpfsRpcToken.trim().length < 8) {
    throw new Error(
      'FILEBASE_IPFS_RPC_TOKEN is required when IPFS pinning is enabled',
    );
  }
  if (config.pinataJwt.trim().length < 8) {
    throw new Error('PINATA_JWT is required when IPFS pinning is enabled');
  }
}

export function isAllowedOrigin(config: EnvConfig, origin: string): boolean {
  return config.allowedOrigins.includes(origin);
}

export function validateProductionConfig(config: EnvConfig): void {
  if (config.env !== 'production') return;
  if (
    !Number.isInteger(config.port) ||
    config.port < 1 ||
    config.port > 65_535
  ) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  validateConfigForAuth(config);
  validateConfigForEncryption(config);
  validateConfigForReserves(config);
  validateConfigForDatabase(config);
  validateConfigForCron(config);
  validateConfigForCors(config);
  validateConfigForIpfs(config);
  if (config.forgeDockerEnabled) {
    throw new Error(
      'FORGE_DOCKER_ENABLED is not supported in the production API process',
    );
  }
}

export function validateForgeDevelopmentConfig(config: EnvConfig): void {
  if (!config.forgeDockerEnabled) return;
  if (config.env !== 'development') {
    throw new Error(
      'Forge execution is restricted to an isolated development worker',
    );
  }
  if (
    !/^ghcr\.io\/foundry-rs\/foundry@sha256:[a-f0-9]{64}$/.test(
      config.forgeSandboxImage || '',
    )
  ) {
    throw new Error(
      'FORGE_SANDBOX_IMAGE must pin the Foundry image by sha256 digest',
    );
  }
}
