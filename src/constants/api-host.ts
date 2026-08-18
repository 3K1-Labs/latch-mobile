import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * The latch-api base URL, with the development host resolved per platform.
 *
 * `EXPO_PUBLIC_API_BASE_URL=http://localhost:8080` works on the iOS simulator,
 * which shares the Mac's network stack, and fails everywhere else:
 *
 *   - on an Android emulator `localhost` is the emulator itself, and the host
 *     machine is reachable at 10.0.2.2
 *   - on a physical device of either platform `localhost` is the phone, and the
 *     Mac is only reachable at its LAN address
 *
 * Rather than ask every developer to keep a machine-specific IP in `.env` — and
 * to remember to change it when they swap between emulator and device, or when
 * their DHCP lease moves — this derives the host at runtime.
 *
 * The LAN address comes from Metro: Expo puts the host serving the bundle in
 * `hostUri`, which is by definition an address the device can already reach,
 * since it just downloaded the app from it.
 *
 * This only ever rewrites loopback, and only in development. A configured
 * remote URL is returned untouched, and a release build never takes this path
 * at all — so a production build cannot be redirected by anything here.
 */
function resolveApiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

  // Release builds use exactly what was configured. No rewriting, no fallback.
  if (!__DEV__) return configured;

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    // env.js validates this at build time, so a parse failure here means the
    // value was overridden at runtime. Hand it back rather than guessing.
    return configured;
  }

  const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (!isLoopback) return configured;

  // The iOS simulator reaches the Mac on loopback already.
  if (Platform.OS === 'ios' && !Constants.isDevice) return configured;

  const lanHost = metroHost();
  if (lanHost) {
    url.hostname = lanHost;
    return url.toString().replace(/\/$/, '');
  }

  // No Metro host to learn from — on an Android emulator the Mac is always at
  // this address, so it is a safe last resort. A physical device has no such
  // convention and keeps the configured value, failing loudly rather than
  // silently talking to the wrong machine.
  if (Platform.OS === 'android' && !Constants.isDevice) {
    url.hostname = '10.0.2.2';
    return url.toString().replace(/\/$/, '');
  }

  return configured;
}

/** The host part of Metro's address, e.g. "192.168.1.5" from "192.168.1.5:8081". */
function metroHost(): string | null {
  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost ?? '';
  const host = hostUri.split(':')[0]?.trim();
  if (!host || host === 'localhost' || host === '127.0.0.1') return null;
  return host;
}

/**
 * Base URL for latch-api. Resolved once — Metro's host does not change within
 * a session, and re-deriving it per request would only add work.
 */
export const API_BASE_URL = resolveApiBaseUrl();
