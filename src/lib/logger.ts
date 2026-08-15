/**
 * logger.ts — the only logging surface for the wallet's key, signing and
 * network layers.
 *
 * React Native writes console output to the device log, where `adb logcat` and
 * Xcode can read it — including on a user's phone. Anything printed there is
 * effectively public to whoever holds the device, so this exists to make the
 * safe thing the easy thing.
 *
 * `debug` and `info` are additionally guarded on `__DEV__`, so they stay out of
 * the way even in a development build that has logging turned up.
 *
 * Note that Metro's minifier drops every `console.*` call from release bundles
 * (`drop_console` in metro.config.js), so none of these levels reach a
 * production build — including `warn` and `error`. Production error reporting
 * is Sentry's job, not this module's. Do not reach for `console` directly on
 * the assumption that errors will survive; they will not.
 *
 * Never pass key material to any of these — not a private key, a mnemonic, a
 * seed, a signature, or a derived digest, and not a truncated prefix or a
 * length either. A prefix narrows a search space and a length identifies a key
 * format. Log the *verdict* instead: "keys match", not the keys.
 */

type LogArgs = unknown[];

function prefix(namespace: string): string {
  return `[${namespace}]`;
}

export interface Logger {
  /** Dev-only. Stripped from release builds. */
  debug: (...args: LogArgs) => void;
  /** Dev-only. Stripped from release builds. */
  info: (...args: LogArgs) => void;
  /** Always logged. */
  warn: (...args: LogArgs) => void;
  /** Always logged. */
  error: (...args: LogArgs) => void;
}

/**
 * A namespaced logger, e.g. `createLogger('passkey')` prints `[passkey] …`.
 * The namespace makes output filterable in Metro and Reactotron.
 */
export function createLogger(namespace: string): Logger {
  const tag = prefix(namespace);
  return {
    debug: (...args) => {
      if (__DEV__) console.log(tag, ...args);
    },
    info: (...args) => {
      if (__DEV__) console.info(tag, ...args);
    },
    warn: (...args) => console.warn(tag, ...args),
    error: (...args) => console.error(tag, ...args),
  };
}
