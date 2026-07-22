import { getConfig, validateProductionConfig } from '../src/utils/config.ts';

const config = getConfig();
validateProductionConfig(config);

console.log(
  JSON.stringify({
    environment: config.env,
    testnet: config.isTestnet,
    allowedOriginCount: config.allowedOrigins.length,
    databaseHost: new URL(config.databaseUrl).hostname,
    status: 'valid',
  }),
);
