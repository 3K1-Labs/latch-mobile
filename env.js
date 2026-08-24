// @ts-check Type-check this file
const { z } = require('zod');

/**
 * Environment schema.
 *
 * Required vs optional is drawn around *running the app on testnet*: a fresh
 * clone with the testnet values from `.env.example` must build. Everything
 * beyond that — mainnet counterparts, third-party API keys, OTA config — is
 * optional and fails at the point of use with a message naming the variable,
 * rather than blocking the build for a contributor who will never touch it.
 *
 * Note the whole schema was previously wrapped in `.partial()`, which made
 * every field optional and turned this file into a no-op: a missing variable
 * became `undefined` and surfaced much later as a confusing runtime error.
 */
/**
 * A URL that React Native can actually issue a request against.
 *
 * `z.string().url()` is not enough: `new URL('localhost:8080')` parses happily,
 * treating `localhost:` as the scheme, so a schemeless value passes validation
 * and then fails at runtime with RN's opaque "No suitable URL request handler
 * found". Requiring http/https up front turns that into a build error naming
 * the variable.
 */
const httpUrl = () =>
  z
    .string()
    .url()
    .refine((v) => /^https?:\/\//i.test(v), {
      message: 'must start with http:// or https://',
    });

const requiredEnv = {
  // ─── Core ───────────────────────────────────────────────────────────────────
  EXPO_PUBLIC_APP_ENV: z.string(),
  EXPO_PUBLIC_API_BASE_URL: httpUrl(),

  // ─── Stellar / Soroban (testnet — the default network for a fresh clone) ────
  EXPO_PUBLIC_NETWORK: z.string(),
  EXPO_PUBLIC_NETWORK_PASSPHRASE: z.string(),
  EXPO_PUBLIC_HORIZON_TESTNET_URL: httpUrl(),
  EXPO_PUBLIC_SOROBAN_RPC_URL: httpUrl(),
  EXPO_PUBLIC_FACTORY_ADDRESS: z.string(),

  // Relying party ID for passkey signing. Must match the backend's
  // WEBAUTHN_ALLOWED_ORIGINS entry exactly, scheme included, or passkey
  // sign-in and deployment both fail signature verification.
  EXPO_PUBLIC_PASSKEY_RP_ID: z.string(),
};

const optionalEnv = {
  EXPO_PUBLIC_APP_PROFILE: z.string().default('staging'),

  // ─── Mainnet counterparts ───────────────────────────────────────────────────
  // Selected at runtime by ACTIVE_NETWORK (src/constants/config.ts). Absent
  // values surface as a named error when switching to mainnet, which is the
  // right failure for a contributor working on testnet only.
  EXPO_PUBLIC_SOROBAN_RPC_URL_MAINNET: httpUrl().optional(),
  EXPO_PUBLIC_FACTORY_ADDRESS_MAINNET: z.string().optional(),

  // ─── Policy contracts ───────────────────────────────────────────────────────
  // Policies enforce rules on an account (admin quorum, recovery); the
  // VERIFIER_* addresses validate signatures. Optional because an account
  // works without them installed — they are opt-in per account.
  EXPO_PUBLIC_ADMIN_GUARD_POLICY: z.string().optional(),
  EXPO_PUBLIC_RECOVERY_POLICY: z.string().optional(),
  EXPO_PUBLIC_RECOVERY_POLICY_MAINNET: z.string().optional(),

  // ─── Contracts used by demo / admin paths ───────────────────────────────────
  EXPO_PUBLIC_COUNTER_ADDRESS: z.string().optional(),
  EXPO_PUBLIC_SMART_ACCOUNT_WASM_HASH: z.string().optional(),

  // ─── Wallet backend ─────────────────────────────────────────────────────────
  EXPO_PUBLIC_WALLET_BACKEND_URL: z.string().optional(),
  EXPO_PUBLIC_USE_WALLET_BACKEND_BALANCES: z.string().optional(),
  EXPO_PUBLIC_MULTISIG_BACKEND_ENABLED: z.string().optional(),
  EXPO_PUBLIC_RELAYER_NETWORKS: z.string().optional(),
  // Which network the deposit relayer (latch-relayer) is deployed against —
  // its pool address only exists on that one network.
  EXPO_PUBLIC_RELAYER_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),

  // ─── Swap / liquidity ───────────────────────────────────────────────────────
  EXPO_PUBLIC_SOROSWAP_API_URL: z.string().default('https://api.soroswap.finance'),
  EXPO_PUBLIC_SOROSWAP_API_KEY: z.string().optional(),
  EXPO_PUBLIC_SWAP_USE_MOCK: z.string().optional(),
  EXPO_PUBLIC_AQUARIUS_API_URL: z.string().optional(),
  EXPO_PUBLIC_AQUARIUS_API_URL_MAINNET: z.string().optional(),
  EXPO_PUBLIC_AQUARIUS_ROUTER: z.string().optional(),
  EXPO_PUBLIC_AQUARIUS_ROUTER_MAINNET: z.string().optional(),

  // ─── Third-party ────────────────────────────────────────────────────────────
  EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID: z.string().optional(),
  EXPO_PUBLIC_MOONPAY_API_KEY: z.string().optional(),
  EXPO_PUBLIC_SENTRY_DSN: z.string().optional(),
};

const runtimeEnv = z.object({ ...requiredEnv, ...optionalEnv });

// Build-time only (never inlined into the bundle).
const buildtimeEnv = z.object({
  APP_NAME: z.string().default('Latch'),
  SENTRY_AUTH_TOKEN: z.string().optional(),
});

const envSchema = runtimeEnv.and(buildtimeEnv);

/**
 * Expo resolves `app.config.js` in a subprocess that deliberately skips `.env`:
 * eas-cli spawns `expo config` with EXPO_NO_DOTENV=1, and it does so before it
 * knows which EAS environment to read server-side variables from, so nothing
 * can supply them at that point. Throwing there fails `eas update` on a machine
 * whose `.env` is complete, so that pass validates whatever is present and
 * leaves the rest undefined — `app.config.js` reads only APP_NAME,
 * SENTRY_AUTH_TOKEN and EXPO_PUBLIC_PASSKEY_RP_ID, each with its own fallback.
 *
 * Bundling (`export`, `start`, `run:*`) still fails naming the variable, which
 * is where a missing value would actually reach a shipped bundle.
 */
const configResolutionSchema = z
  .object({
    ...Object.fromEntries(
      Object.entries(requiredEnv).map(([key, schema]) => [key, schema.optional()]),
    ),
    ...optionalEnv,
  })
  .and(buildtimeEnv);

const isConfigResolutionPass = process.argv[2] === 'config';

/**
 * `EXPO_PUBLIC` values must be referenced directly (e.g.
 * `process.env.EXPO_PUBLIC_API_BASE_URL`), never dynamically, for the
 * transpiler to inline them. Every key in the schema above needs a line here
 * or it will be `undefined` at runtime regardless of what `.env` contains.
 *
 * @type {Record<keyof z.TypeOf<typeof runtimeEnv>, string | undefined>}
 */
const envObject = {
  EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
  EXPO_PUBLIC_APP_PROFILE: process.env.EXPO_PUBLIC_APP_PROFILE,
  EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,

  EXPO_PUBLIC_NETWORK: process.env.EXPO_PUBLIC_NETWORK,
  EXPO_PUBLIC_NETWORK_PASSPHRASE: process.env.EXPO_PUBLIC_NETWORK_PASSPHRASE,
  EXPO_PUBLIC_HORIZON_TESTNET_URL: process.env.EXPO_PUBLIC_HORIZON_TESTNET_URL,
  EXPO_PUBLIC_SOROBAN_RPC_URL: process.env.EXPO_PUBLIC_SOROBAN_RPC_URL,
  EXPO_PUBLIC_FACTORY_ADDRESS: process.env.EXPO_PUBLIC_FACTORY_ADDRESS,
  EXPO_PUBLIC_PASSKEY_RP_ID: process.env.EXPO_PUBLIC_PASSKEY_RP_ID,

  EXPO_PUBLIC_SOROBAN_RPC_URL_MAINNET: process.env.EXPO_PUBLIC_SOROBAN_RPC_URL_MAINNET,
  EXPO_PUBLIC_FACTORY_ADDRESS_MAINNET: process.env.EXPO_PUBLIC_FACTORY_ADDRESS_MAINNET,

  EXPO_PUBLIC_ADMIN_GUARD_POLICY: process.env.EXPO_PUBLIC_ADMIN_GUARD_POLICY,
  EXPO_PUBLIC_RECOVERY_POLICY: process.env.EXPO_PUBLIC_RECOVERY_POLICY,
  EXPO_PUBLIC_RECOVERY_POLICY_MAINNET: process.env.EXPO_PUBLIC_RECOVERY_POLICY_MAINNET,

  EXPO_PUBLIC_COUNTER_ADDRESS: process.env.EXPO_PUBLIC_COUNTER_ADDRESS,
  EXPO_PUBLIC_SMART_ACCOUNT_WASM_HASH: process.env.EXPO_PUBLIC_SMART_ACCOUNT_WASM_HASH,

  EXPO_PUBLIC_WALLET_BACKEND_URL: process.env.EXPO_PUBLIC_WALLET_BACKEND_URL,
  EXPO_PUBLIC_USE_WALLET_BACKEND_BALANCES: process.env.EXPO_PUBLIC_USE_WALLET_BACKEND_BALANCES,
  EXPO_PUBLIC_MULTISIG_BACKEND_ENABLED: process.env.EXPO_PUBLIC_MULTISIG_BACKEND_ENABLED,
  EXPO_PUBLIC_RELAYER_NETWORKS: process.env.EXPO_PUBLIC_RELAYER_NETWORKS,
  EXPO_PUBLIC_RELAYER_NETWORK: process.env.EXPO_PUBLIC_RELAYER_NETWORK,

  EXPO_PUBLIC_SOROSWAP_API_URL: process.env.EXPO_PUBLIC_SOROSWAP_API_URL,
  EXPO_PUBLIC_SOROSWAP_API_KEY: process.env.EXPO_PUBLIC_SOROSWAP_API_KEY,
  EXPO_PUBLIC_SWAP_USE_MOCK: process.env.EXPO_PUBLIC_SWAP_USE_MOCK,
  EXPO_PUBLIC_AQUARIUS_API_URL: process.env.EXPO_PUBLIC_AQUARIUS_API_URL,
  EXPO_PUBLIC_AQUARIUS_API_URL_MAINNET: process.env.EXPO_PUBLIC_AQUARIUS_API_URL_MAINNET,
  EXPO_PUBLIC_AQUARIUS_ROUTER: process.env.EXPO_PUBLIC_AQUARIUS_ROUTER,
  EXPO_PUBLIC_AQUARIUS_ROUTER_MAINNET: process.env.EXPO_PUBLIC_AQUARIUS_ROUTER_MAINNET,

  EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID: process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID,
  EXPO_PUBLIC_MOONPAY_API_KEY: process.env.EXPO_PUBLIC_MOONPAY_API_KEY,
  EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN,
};

// Trim every value before validating. `KEY= value` in a .env file yields a
// leading space, which survives into the bundle and breaks URL parsing and
// address comparison in ways that are painful to trace back to whitespace.
const trimmed = Object.fromEntries(
  Object.entries({ ...process.env, ...envObject }).map(([k, v]) => [
    k,
    typeof v === 'string' ? v.trim() : v,
  ]),
);

const parsed = envSchema.safeParse(trimmed);

const result =
  parsed.success || !isConfigResolutionPass ? parsed : configResolutionSchema.safeParse(trimmed);

if (!result.success) {
  const missing = result.error.issues
    .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(
    `Invalid environment configuration:\n${missing}\n\n` +
      `Copy .env.example to .env and fill in the required values.`,
  );
}

module.exports = result.data;
