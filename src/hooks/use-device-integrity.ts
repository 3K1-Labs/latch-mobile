import * as Device from 'expo-device';
import { useEffect, useRef } from 'react';
import Toast from 'react-native-toast-message';
import JailMonkey from 'jail-monkey';

import { createLogger } from '@/src/lib/logger';

const log = createLogger('device-integrity');

/**
 * Warn — never block — on a compromised device.
 *
 * A jailbroken/rooted device, or one with an instrumentation hook (Frida and
 * similar) attached, has a security boundary the OS keychain/Keystore relies
 * on already broken: SecureStore's guarantees are weaker there, and a
 * WebAuthn assertion or a signature produced on-device is less trustworthy
 * evidence of "the user's own key approved this."
 *
 * This warns rather than blocks because false positives exist (some
 * legitimate MDM/dev tooling trips these checks) and a wallet that locks
 * someone out of their own funds on a false positive is worse than one that
 * signs on a device it should have warned about. Blocking is a product
 * decision for later, made deliberately, not a side effect of adding this
 * check.
 */
export function useDeviceIntegrity(): void {
  const warned = useRef(false);

  useEffect(() => {
    if (warned.current) return;
    if (!Device.isDevice) return; // simulators/emulators trip these checks meaninglessly

    try {
      const compromised = JailMonkey.isJailBroken() || JailMonkey.hookDetected();
      if (!compromised) return;
      warned.current = true;
      Toast.show({
        type: 'error',
        text1: 'This device may be compromised',
        text2: 'Jailbreak/root or an instrumentation hook was detected. Signing here is riskier.',
        visibilityTime: 0,
        autoHide: false,
      });
    } catch (e) {
      // Detection itself failing is not a signal either way — never block on it.
      log.warn('device integrity check failed:', e);
    }
  }, []);
}
