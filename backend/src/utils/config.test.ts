import { assertEquals, assertThrows } from 'std/assert/mod.ts';
import type { EnvConfig } from '../types/index.ts';
import { isAllowedOrigin, loadConfig, validateProductionConfig } from './config.ts';

function validProductionConfig(): EnvConfig {
  return {
    ...loadConfig(),
    env: 'production',
    allowedOrigins: ['https://juicy.vision'],
    databaseUrl: 'postgresql://juicy:secret@database.internal:5432/juicyvision',
    jwtSecret: 'jwt-secret-with-at-least-thirty-two-characters',
    encryptionMasterKey: 'different-encryption-secret-with-thirty-two-chars',
    cronSecret: 'cron-secret-with-at-least-thirty-two-characters',
    reservesPrivateKey: `0x${'11'.repeat(32)}`,
  };
}

Deno.test('production config accepts exact HTTPS origins and independent secrets', () => {
  validateProductionConfig(validProductionConfig());
});

Deno.test('production config rejects wildcard and insecure origins', async (t) => {
  for (
    const origin of [
      'https://*.ipfs.dweb.link',
      'http://juicy.vision',
    ]
  ) {
    await t.step(origin, () => {
      assertThrows(
        () => validateProductionConfig({ ...validProductionConfig(), allowedOrigins: [origin] }),
        Error,
      );
    });
  }
});

Deno.test('CORS origin matching does not trust look-alike domain substrings', () => {
  const config = validProductionConfig();
  assertEquals(isAllowedOrigin(config, 'https://juicy.vision'), true);
  assertEquals(isAllowedOrigin(config, 'https://juicy.vision.attacker.example'), false);
});

Deno.test('production config rejects defaults, localhost, and reused secrets', () => {
  const config = validProductionConfig();

  assertThrows(
    () => validateProductionConfig({ ...config, databaseUrl: 'postgres://localhost/app' }),
    Error,
    'localhost',
  );
  assertThrows(
    () => validateProductionConfig({ ...config, cronSecret: 'dev-cron-secret' }),
    Error,
    'CRON_SECRET',
  );
  assertThrows(
    () =>
      validateProductionConfig({
        ...config,
        encryptionMasterKey: config.jwtSecret,
      }),
    Error,
    'different',
  );
});

Deno.test('production config rejects in-process Forge execution', () => {
  assertThrows(
    () => validateProductionConfig({ ...validProductionConfig(), forgeDockerEnabled: true }),
    Error,
    'not supported',
  );
});

Deno.test('configuration rejects ambiguous boolean values', () => {
  const previous = Deno.env.get('TRUST_PROXY');
  try {
    Deno.env.set('TRUST_PROXY', '1');
    assertThrows(() => loadConfig(), Error, 'either true or false');
  } finally {
    if (previous === undefined) Deno.env.delete('TRUST_PROXY');
    else Deno.env.set('TRUST_PROXY', previous);
  }
});

Deno.test('enabled IPFS pinning requires both redundant provider credentials', () => {
  const config = {
    ...validProductionConfig(),
    ipfsPinningEnabled: true,
    filebaseIpfsRpcToken: '',
    pinataJwt: '',
  };
  assertThrows(
    () => validateProductionConfig(config),
    Error,
    'FILEBASE_IPFS_RPC_TOKEN',
  );
  assertThrows(
    () =>
      validateProductionConfig({
        ...config,
        filebaseIpfsRpcToken: 'filebase-token',
      }),
    Error,
    'PINATA_JWT',
  );
  validateProductionConfig({
    ...config,
    filebaseIpfsRpcToken: 'filebase-token',
    pinataJwt: 'pinata-jwt',
  });
});
