// @ts-check Type-check this file
const { z } = require('zod');

const runtimeEnv = z
  .object({
    // EXPO_PUBLIC_API_BASE_URL: z.string().url(),
    // EXPO_PUBLIC_LOGIN_EMAIL: z.string(),
    // EXPO_PUBLIC_LOGIN_PASSWORD: z.string(),
    // EXPO_PUBLIC_DOJAH_KEY: z.string(),
    // EXPO_PUBLIC_DOJAH_APP_ID: z.string(),
    // EXPO_PUBLIC_DOJAH_WIDGET_ID: z.string(),
    EXPO_PUBLIC_HOT_UPDATER_SUPABASE_ANON_KEY: z.string(),
    EXPO_PUBLIC_HOT_UPDATER_SUPABASE_BUCKET_NAME: z.string(),
    EXPO_PUBLIC_HOT_UPDATER_SUPABASE_URL: z.string().url(),
    EXPO_PUBLIC_APP_ENV: z.string(),
    // EXPO_PUBLIC_META_APPLICATION_ID: z.string(),
    // EXPO_PUBLIC_META_CLIENT_TOKEN: z.string(),
    EXPO_PUBLIC_APP_PROFILE: z.string().default('staging'),
    // EXPO_PUBLIC_CLOUDFLARE_WORKER_URL: z.string().url(),
    EXPO_PUBLIC_HORIZON_TESTNET_URL: z.string(),

    ///////
    EXPO_PUBLIC_NETWORK: z.string(),
    EXPO_PUBLIC_RPC_URL: z.string(),
    EXPO_PUBLIC_NETWORK_PASSPHRASE: z.string(),
    EXPO_PUBLIC_VERIFIER_ADDRESS: z.string(),
    EXPO_PUBLIC_COUNTER_ADDRESS: z.string(),
    EXPO_PUBLIC_SMART_ACCOUNT_WASM_HASH: z.string(),
    EXPO_PUBLIC_FACTORY_ADDRESS: z.string(),
    EXPO_PUBLIC_BUNDLER_SECRET: z.string(),
    // Mainnet counterparts — selected at runtime by ACTIVE_NETWORK in
    // src/constants/config.ts, not by build-time branching.
    EXPO_PUBLIC_SOROBAN_RPC_URL_MAINNET: z.string(),
    EXPO_PUBLIC_VERIFIER_ADDRESS_MAINNET: z.string(),
    EXPO_PUBLIC_FACTORY_ADDRESS_MAINNET: z.string(),
    EXPO_PUBLIC_BUNDLER_SECRET_MAINNET: z.string(),
    EXPO_PUBLIC_SOROSWAP_API_URL: z.string().default('https://api.soroswap.finance'),
    EXPO_PUBLIC_SOROSWAP_API_KEY: z.string().optional(),
    EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID: z.string().optional(),
    EXPO_PUBLIC_SENTRY_DSN: z.string().optional(),
    EXPO_PUBLIC_MOONPAY_API_KEY: z.string().optional(),
    // Which Stellar network the deposit relayer (latch-relayer) is deployed
    // against. Its pool address only exists on that one network.
    EXPO_PUBLIC_RELAYER_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
    SENTRY_AUTH_TOKEN: z.string(),
  })
  .partial();

const buildtimeEnv = runtimeEnv.partial().and(
  z.object({
    APP_NAME: z.string().default('Latch'),
    SENTRY_AUTH_TOKEN: z.string().optional(),
  }),
);

const envSchema =
  process.env.NODE_ENV === 'production'
    ? // @ts-expect-error
      /** @type {typeof buildtimeEnv} */ (runtimeEnv)
    : buildtimeEnv;

/**
 * `EXPO_PUBLIC` values need to be referenced directly e.g process.env.EXPO_PUBLIC_ID (not dynamically)
 * for the cli/transpiler to be able to inline this value, every other env is discarded in the build output
 * so only `EXPO_PUBLIC_*` are available to use at runtime while the rest are build time variables.
 *
 * @type {Record<keyof z.TypeOf<typeof runtimeEnv>, string | undefined>}
 */
const envObject = {
  // EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
  //   EXPO_PUBLIC_LOGIN_EMAIL: process.env.EXPO_PUBLIC_LOGIN_EMAIL,
  //   EXPO_PUBLIC_LOGIN_PASSWORD: process.env.EXPO_PUBLIC_LOGIN_PASSWORD,
  //   EXPO_PUBLIC_DOJAH_KEY: process.env.EXPO_PUBLIC_DOJAH_KEY,
  //   EXPO_PUBLIC_DOJAH_APP_ID: process.env.EXPO_PUBLIC_DOJAH_APP_ID,
  //   EXPO_PUBLIC_DOJAH_WIDGET_ID: process.env.EXPO_PUBLIC_DOJAH_WIDGET_ID,
  EXPO_PUBLIC_HOT_UPDATER_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_HOT_UPDATER_SUPABASE_ANON_KEY,
  EXPO_PUBLIC_HOT_UPDATER_SUPABASE_BUCKET_NAME:
    process.env.EXPO_PUBLIC_HOT_UPDATER_SUPABASE_BUCKET_NAME,
  EXPO_PUBLIC_HOT_UPDATER_SUPABASE_URL: process.env.EXPO_PUBLIC_HOT_UPDATER_SUPABASE_URL,
  EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
  //   EXPO_PUBLIC_META_APPLICATION_ID: process.env.EXPO_PUBLIC_META_APPLICATION_ID,
  //   EXPO_PUBLIC_META_CLIENT_TOKEN: process.env.EXPO_PUBLIC_META_CLIENT_TOKEN,
  EXPO_PUBLIC_APP_PROFILE: process.env.EXPO_PUBLIC_APP_PROFILE,
  //   EXPO_PUBLIC_CLOUDFLARE_WORKER_URL: process.env.EXPO_PUBLIC_CLOUDFLARE_WORKER_URL,
  EXPO_PUBLIC_HORIZON_TESTNET_URL: process.env.EXPO_PUBLIC_HORIZON_TESTNET_URL,
  //
  EXPO_PUBLIC_NETWORK: process.env.EXPO_PUBLIC_NETWORK,
  EXPO_PUBLIC_RPC_URL: process.env.EXPO_PUBLIC_RPC_URL,
  EXPO_PUBLIC_NETWORK_PASSPHRASE: process.env.EXPO_PUBLIC_NETWORK_PASSPHRASE,
  EXPO_PUBLIC_VERIFIER_ADDRESS: process.env.EXPO_PUBLIC_VERIFIER_ADDRESS,
  EXPO_PUBLIC_COUNTER_ADDRESS: process.env.EXPO_PUBLIC_COUNTER_ADDRESS,
  EXPO_PUBLIC_SMART_ACCOUNT_WASM_HASH: process.env.EXPO_PUBLIC_SMART_ACCOUNT_WASM_HASH,
  EXPO_PUBLIC_FACTORY_ADDRESS: process.env.EXPO_PUBLIC_FACTORY_ADDRESS,
  EXPO_PUBLIC_BUNDLER_SECRET: process.env.EXPO_PUBLIC_BUNDLER_SECRET,
  EXPO_PUBLIC_SOROBAN_RPC_URL_MAINNET: process.env.EXPO_PUBLIC_SOROBAN_RPC_URL_MAINNET,
  EXPO_PUBLIC_VERIFIER_ADDRESS_MAINNET: process.env.EXPO_PUBLIC_VERIFIER_ADDRESS_MAINNET,
  EXPO_PUBLIC_FACTORY_ADDRESS_MAINNET: process.env.EXPO_PUBLIC_FACTORY_ADDRESS_MAINNET,
  EXPO_PUBLIC_BUNDLER_SECRET_MAINNET: process.env.EXPO_PUBLIC_BUNDLER_SECRET_MAINNET,
  EXPO_PUBLIC_SOROSWAP_API_URL: process.env.EXPO_PUBLIC_SOROSWAP_API_URL,
  EXPO_PUBLIC_SOROSWAP_API_KEY: process.env.EXPO_PUBLIC_SOROSWAP_API_KEY,
  EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID: process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID,
  EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN,
  EXPO_PUBLIC_MOONPAY_API_KEY: process.env.EXPO_PUBLIC_MOONPAY_API_KEY,
  EXPO_PUBLIC_RELAYER_NETWORK: process.env.EXPO_PUBLIC_RELAYER_NETWORK,
  SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN,
};

module.exports = envSchema.parse({ ...process.env, ...envObject });
