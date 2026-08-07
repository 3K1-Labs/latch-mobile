import { type WalletKitTypes } from '@reown/walletkit';
import * as Sentry from '@sentry/react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import {
  getActiveSessions,
  initWalletKit,
  restoreRelayConnection,
  walletKit,
} from '@/src/lib/walletconnect';
import { useWalletConnectStore } from '@/src/store/walletconnect';

// The Explore tab opens dApps in an in-app browser (SFSafariViewController /
// Custom Tab), which is a native view presented *above* the React Native root.
// A proposal/request route pushed while it's open renders underneath it and the
// user never sees the sheet, so the browser has to come down first. Rejects
// when no browser is open — that's the common case and is not an error.
function dismissInAppBrowser() {
  WebBrowser.dismissBrowser().catch(() => {});
}

// Bounds the handled-id sets. Ids only need to outlive the redelivery window of
// the message that produced them, so a small ring is plenty.
const MAX_HANDLED_IDS = 50;

function rememberId(handled: Set<number>, id: number): boolean {
  if (handled.has(id)) return false;
  handled.add(id);
  if (handled.size > MAX_HANDLED_IDS) {
    handled.delete(handled.values().next().value as number);
  }
  return true;
}

export function useWalletConnect() {
  const storeRef = useRef(useWalletConnectStore.getState());

  useEffect(() => {
    const unsub = useWalletConnectStore.subscribe((s) => {
      storeRef.current = s;
    });
    return unsub;
  }, []);

  useEffect(() => {
    let mounted = true;
    let retryTimeout: ReturnType<typeof setTimeout> | undefined;
    let detachListeners: (() => void) | undefined;

    // The relay redelivers every queued message for a topic each time that topic
    // is re-subscribed (which a transport restart does for all of them), and a
    // dApp that retries its connect button sends a genuinely new proposal for
    // the same pairing. Either way one user action can fire these handlers
    // several times, and each firing used to push another modal onto the stack.
    const handledProposals = new Set<number>();
    const handledRequests = new Set<number>();

    const onSessionProposal = (proposal: WalletKitTypes.SessionProposal) => {
      if (!rememberId(handledProposals, proposal.id)) return;
      dismissInAppBrowser();
      // The screen renders from the store, so a proposal arriving while one is
      // already on screen replaces it in place instead of stacking a second
      // sheet the user has to dismiss twice.
      const alreadyShowing = storeRef.current.pendingProposal !== null;
      storeRef.current.setPendingProposal(proposal);
      if (!alreadyShowing) router.push('/wc-session-proposal');
    };

    const onSessionRequest = (request: WalletKitTypes.SessionRequest) => {
      if (!rememberId(handledRequests, request.id)) return;
      dismissInAppBrowser();
      const alreadyShowing = storeRef.current.pendingRequest !== null;
      storeRef.current.setPendingRequest(request);
      if (!alreadyShowing) router.push('/wc-session-request');
    };

    const onSessionDelete = () => {
      storeRef.current.setActiveSessions(getActiveSessions());
    };

    const init = async () => {
      try {
        await initWalletKit();
      } catch (err) {
        console.error('[WalletConnect] init failed, retrying in 5s', err);
        Sentry.captureException(err, {
          tags: { scope: 'walletconnect-init' },
          extra: { willRetryInMs: 5000 },
        });
        if (mounted) retryTimeout = setTimeout(init, 5000);
        return;
      }

      if (!mounted || !walletKit) return;

      const kit = walletKit;
      storeRef.current.setActiveSessions(getActiveSessions());

      kit.on('session_proposal', onSessionProposal);
      kit.on('session_request', onSessionRequest);
      kit.on('session_delete', onSessionDelete);
      detachListeners = () => {
        kit.off('session_proposal', onSessionProposal);
        kit.off('session_request', onSessionRequest);
        kit.off('session_delete', onSessionDelete);
      };
    };

    init();
    return () => {
      mounted = false;
      clearTimeout(retryTimeout);
      detachListeners?.();
    };
  }, []);

  // iOS/Android tear down the relay WebSocket while the app is suspended, and
  // the socket that comes back can be a half-dead one that never delivers the
  // dApp's proposal. Coming back to the foreground is the moment the user is
  // about to pair, so rebuild the transport then.
  useEffect(() => {
    let previous: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      if (previous !== 'active' && next === 'active') restoreRelayConnection();
      previous = next;
    });
    return () => sub.remove();
  }, []);
}
