import * as Updates from 'expo-updates';
import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import Toast from 'react-native-toast-message';

// Reads `extra.otaCritical` from the incoming update's manifest. Set it on a
// publish (via `extra` in app.config.js) only when a fix must reach users
// immediately — e.g. `eas update` after flipping the flag on.
function isCriticalUpdate(manifest: unknown): boolean {
  const extra = (manifest as { extra?: { expoClient?: { extra?: Record<string, unknown> } } })?.extra
    ?.expoClient?.extra;
  return extra?.otaCritical === true;
}

// OTA policy: normal updates download silently and apply on the next cold
// launch (no UI — matches every major consumer app). Only updates explicitly
// flagged critical surface a non-blocking "Restart" prompt so the user can
// apply the fix without waiting for a natural relaunch.
//
// The prompt is offered again on every foreground until it's acted on. It used
// to be once per session, latched at show time, so dismissing the toast — or
// missing it — left no way to apply the update short of the user killing the
// app themselves. Re-offering is free: by the time the prompt appears the new
// bundle is already downloaded, and `isUpdatePending` says so without touching
// the network.
export function useOtaUpdate() {
  const { isUpdatePending, downloadedUpdate } = Updates.useUpdates();
  // Suppresses duplicate toasts only while one is on screen — cleared on hide,
  // so the next foreground offers the restart again.
  const promptVisible = useRef(false);

  const promptRestart = useCallback(() => {
    if (promptVisible.current) {
      return;
    }
    promptVisible.current = true;
    Toast.show({
      type: 'update',
      text1: 'Update available',
      text2: 'An important update is ready to install.',
      autoHide: false,
      onHide: () => {
        promptVisible.current = false;
      },
      props: {
        actionLabel: 'Restart',
        onAction: () => {
          Toast.hide();
          void Updates.reloadAsync();
        },
      },
    });
  }, []);

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) {
      return;
    }

    let checking = false;

    const offerOrCheck = async () => {
      // A downloaded update needs no network round-trip, and must not be
      // fetched twice: checkForUpdateAsync keeps reporting `isAvailable` until
      // the new bundle actually launches, since the running one is still old.
      if (isUpdatePending) {
        if (isCriticalUpdate(downloadedUpdate?.manifest)) {
          promptRestart();
        }
        return;
      }
      if (checking) {
        return;
      }
      checking = true;
      try {
        const result = await Updates.checkForUpdateAsync();
        if (!result.isAvailable) {
          return;
        }
        // Non-critical updates are left to expo-updates' automatic
        // background fetch — they apply silently on the next cold launch.
        if (!isCriticalUpdate(result.manifest)) {
          return;
        }
        await Updates.fetchUpdateAsync();
        promptRestart();
      } catch {
        // Non-fatal — the default background fetch still applies the update
        // on the next cold launch.
      } finally {
        checking = false;
      }
    };

    void offerOrCheck();

    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        void offerOrCheck();
      }
    });

    return () => sub.remove();
  }, [isUpdatePending, downloadedUpdate, promptRestart]);
}
