/**
 * walletconnect.ts — WalletKit singleton and approve/reject helpers.
 *
 * Supports stellar_signXDR (sign only) and stellar_signAndSubmitXDR (sign +
 * submit). Only mnemonic accounts are supported in v1 — passkey accounts have
 * no G-address for the WC namespace.
 *
 * Signing uses deriveWalletAtIndex so the keypair is never stored. XDR
 * serialisation uses txToBase64 (avoids the .toXDR('base64') Hermes bug).
 */

import { WalletKit, type IWalletKit, type WalletKitTypes } from '@reown/walletkit';
import * as Sentry from '@sentry/react-native';
import { Core } from '@walletconnect/core';
import { buildApprovedNamespaces, getSdkError } from '@walletconnect/utils';

import { txToBase64 } from '@/src/api/smart-account';
import { ACTIVE_NETWORK, HORIZON_URL } from '@/src/constants/config';
import { deriveWalletAtIndex } from '@/src/lib/seed-wallet';
import { reviewSessionRequest } from '@/src/lib/wc-request-review';

// A function, not a frozen const — a live network switch (network-switch.ts)
// must be reflected on the next call, not just after a fresh app launch.
export function getWcChain(): string {
  return ACTIVE_NETWORK.network === 'TESTNET' ? 'stellar:testnet' : 'stellar:pubnet';
}

const WC_METHODS = ['stellar_signXDR', 'stellar_signAndSubmitXDR'];
const WC_EVENTS = ['accountsChanged'];

const PROJECT_ID = process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '5f9dfc3d26a8876949217421446ed931';

const METADATA = {
  name: 'Latch',
  description: 'Stellar Smart Account Wallet',
  url: 'https://getlatch.co',
  icons: ['https://getlatch.co/icon.png'],
  redirect: { native: 'latch://' },
};

export let walletKit: IWalletKit | null = null;

// The relay identifies the app by the bundle id (iOS) / package name (Android)
// that @walletconnect/react-native-compat reads from expo-application, and
// rejects the socket when it isn't on the Reown project's allowlist. Reporting
// what the relay actually saw is the only way to tell that apart from a plain
// network failure — a release build's bundle id differs from the dev one
// (app.config.js switches on APP_NAME), so this fails on TestFlight only.
export function getRelayAppId(): string | undefined {
  const relayer = walletKit?.core.relayer as
    | { bundleId?: string; packageName?: string }
    | undefined;
  return relayer?.bundleId ?? relayer?.packageName;
}

// console.* is stripped from release bundles (metro.config.js drop_console), so
// anything logged here is invisible in TestFlight. Sentry is the only channel
// that survives; it's a no-op when Sentry.init was skipped (see app/_layout.tsx).
function reportRelay(
  message: string,
  level: Sentry.SeverityLevel,
  extra?: Record<string, unknown>,
): void {
  Sentry.captureMessage(`[WalletConnect] ${message}`, {
    level,
    extra: { appId: getRelayAppId(), projectId: PROJECT_ID, ...extra },
  });
}

// Tracked as a promise (not just the walletKit null-check) so concurrent callers
// share one in-flight init instead of racing separate Core/WalletKit instances,
// and a failed attempt (e.g. WalletKit.init's AsyncStorage read/write failing
// under low device storage) is retried on the next call rather than wedging
// walletKit as permanently null for the rest of the app session.
let initPromise: Promise<void> | null = null;

export function initWalletKit(): Promise<void> {
  if (walletKit) return Promise.resolve();
  if (!initPromise) {
    initPromise = (async () => {
      const core = new Core({ projectId: PROJECT_ID });
      walletKit = await WalletKit.init({ core, metadata: METADATA });

      // Relay subscribe failures ("Subscribing to X failed") are opaque on their own —
      // these events tell us whether the relay socket ever connected at all vs.
      // connected fine but the subscribe RPC itself stalled.
      const relayer = walletKit.core.relayer;
      relayer.on('relayer_connect', () => {
        console.log('[WalletConnect] relayer connected');
        Sentry.addBreadcrumb({
          category: 'walletconnect',
          message: 'relayer connected',
          level: 'info',
          data: { appId: getRelayAppId() },
        });
      });
      relayer.on('relayer_disconnect', () => {
        console.warn('[WalletConnect] relayer disconnected');
        Sentry.addBreadcrumb({
          category: 'walletconnect',
          message: 'relayer disconnected',
          level: 'warning',
        });
      });
      relayer.on('relayer_error', (err: unknown) => {
        console.warn('[WalletConnect] relayer error', err);
        reportRelay('relayer error', 'error', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
      relayer.on('relayer_connection_stalled', () => {
        console.warn('[WalletConnect] relayer connection stalled');
        reportRelay('relayer connection stalled', 'warning');
      });

      // One-time cleanup for duplicate sessions created before approveProposal
      // started disconnecting the old one on reconnect (see approveProposal).
      // Best-effort: walletKit is already assigned and usable at this point, so
      // letting a failed disconnect reject the init promise would clear
      // initPromise while leaving walletKit set — and the next initWalletKit()
      // would short-circuit on the walletKit check and register a second copy of
      // every relayer and session listener.
      await dedupeSessions().catch(() => {});
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

// Collapses multiple live sessions for the same dApp (same peer url) down to
// the most recently established one. Guards against duplicate rows in the
// Connected Apps list left over from before approveProposal disconnected the
// old session on reconnect.
async function dedupeSessions(): Promise<void> {
  if (!walletKit) return;
  const sessions = Object.values(walletKit.getActiveSessions());
  const byUrl = new Map<string, typeof sessions>();
  for (const session of sessions) {
    const url = session.peer.metadata.url;
    byUrl.set(url, [...(byUrl.get(url) ?? []), session]);
  }

  const staleTopics = [...byUrl.values()]
    .filter((group) => group.length > 1)
    .flatMap((group) => group.sort((a, b) => b.expiry - a.expiry).slice(1))
    .map((session) => session.topic);

  await Promise.all(staleTopics.map((topic) => disconnectSession(topic).catch(() => {})));
}

// `relayer.connected` reads the raw WebSocket readyState, which stays 1 on a
// socket the network silently black-holed — the OS suspending the app, or a
// wifi→cellular switch, leaves one behind routinely. Pairing over a zombie
// socket subscribes "successfully" and then never receives the dApp's proposal,
// which is exactly the "connected to the relay but the request never arrived"
// failure. Only a transport restart can tell the two apart, so callers do it on
// every foreground transition (use-walletconnect.ts) rather than guessing.
let relayRestart: Promise<void> | null = null;

export function restoreRelayConnection(): Promise<void> {
  if (!walletKit) return Promise.resolve();
  if (relayRestart) return relayRestart;
  relayRestart = walletKit.core.relayer
    .restartTransport()
    .catch((err: unknown) => {
      console.warn('[WalletConnect] transport restart failed', err);
      reportRelay('transport restart failed', 'warning', {
        error: err instanceof Error ? err.message : String(err),
      });
    })
    .finally(() => {
      relayRestart = null;
    });
  return relayRestart;
}

export async function pairWithUri(uri: string): Promise<void> {
  if (!walletKit) await initWalletKit();
  if (!walletKit) throw new Error('WalletKit not initialised');
  // Pairing almost always happens seconds after the user switched back from the
  // dApp or their browser, so the foreground restart is typically still in
  // flight here. Pairing on the socket it is replacing is the failure this whole
  // path exists to prevent, so wait it out (a no-op when nothing is pending).
  await relayRestart;
  console.log('[WalletConnect] pairing, relayer.connected =', walletKit.core.relayer.connected);
  return walletKit.pair({ uri });
}

export async function approveProposal(
  proposal: WalletKitTypes.SessionProposal,
  gAddress: string,
): Promise<void> {
  if (!walletKit) throw new Error('WalletKit not initialised');
  const { id, params } = proposal;

  // Prevent duplicate rows in the Connected Apps list: without this, scanning
  // the same dApp's QR twice creates two live sessions with different topics
  // but identical peer metadata, since WalletConnect itself doesn't dedupe.
  const proposerUrl = params.proposer.metadata.url;
  const existingSessions = Object.values(walletKit.getActiveSessions());
  await Promise.all(
    existingSessions
      .filter((session) => session.peer.metadata.url === proposerUrl)
      .map((session) => disconnectSession(session.topic).catch(() => {})),
  );

  const chain = getWcChain();
  const namespaces = buildApprovedNamespaces({
    proposal: params,
    supportedNamespaces: {
      stellar: {
        chains: [chain],
        accounts: [`${chain}:${gAddress}`],
        methods: WC_METHODS,
        events: WC_EVENTS,
      },
    },
  });
  await walletKit.approveSession({ id, namespaces });
}

export async function rejectProposal(id: number): Promise<void> {
  if (!walletKit) throw new Error('WalletKit not initialised');
  await walletKit.rejectSession({ id, reason: getSdkError('USER_REJECTED') });
}

export async function approveSignRequest(
  request: WalletKitTypes.SessionRequest,
  mnemonic: string,
  accountIndex: number,
): Promise<void> {
  if (!walletKit) throw new Error('WalletKit not initialised');
  const { id, topic, params } = request;
  const {
    request: { method, params: reqParams },
    chainId,
  } = params;

  const { keypair } = deriveWalletAtIndex(mnemonic, accountIndex);

  // Re-validated here and not only where the sheet is built: this is the last
  // point before a signature exists, and it must not be reachable by any path
  // that skipped the review screen.
  const result = reviewSessionRequest({
    method,
    chainId,
    activeChain: getWcChain(),
    requestParams: reqParams,
    accountAddress: keypair.publicKey(),
  });

  if (!result.ok) {
    const { code } = result.rejection;
    await walletKit.respondSessionRequest({
      topic,
      response: {
        id,
        jsonrpc: '2.0',
        error:
          code === 'UNSUPPORTED_CHAINS'
            ? getSdkError('UNSUPPORTED_CHAINS')
            : code === 'UNSUPPORTED_METHOD'
              ? getSdkError('UNSUPPORTED_METHODS')
              : { code: -32602, message: result.rejection.message },
      },
    });
    return;
  }

  const { tx } = result;
  tx.sign(keypair);
  const signedXdr = txToBase64(tx);

  if (method === 'stellar_signXDR') {
    await walletKit.respondSessionRequest({
      topic,
      response: { id, jsonrpc: '2.0', result: { signedXDR: signedXdr } },
    });
    return;
  }

  // stellar_signAndSubmitXDR — sign + submit to Horizon
  await submitToHorizon(signedXdr);
  await walletKit.respondSessionRequest({
    topic,
    response: { id, jsonrpc: '2.0', result: { status: 'success' } },
  });
}

export async function rejectSignRequest(request: WalletKitTypes.SessionRequest): Promise<void> {
  if (!walletKit) throw new Error('WalletKit not initialised');
  const { id, topic } = request;
  await walletKit.respondSessionRequest({
    topic,
    response: { id, jsonrpc: '2.0', error: getSdkError('USER_REJECTED') },
  });
}

function submitToHorizon(signedXdr: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${HORIZON_URL}/transactions`, true);
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    xhr.timeout = 30_000;
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      try {
        const body = JSON.parse(xhr.responseText);
        reject(new Error(body?.extras?.result_codes?.transaction ?? `HTTP ${xhr.status}`));
      } catch {
        reject(new Error(`HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.ontimeout = () => reject(new Error('Request timed out'));
    xhr.send(`tx=${encodeURIComponent(signedXdr)}`);
  });
}

export function getActiveSessions() {
  if (!walletKit) return {};
  return walletKit.getActiveSessions();
}

export async function disconnectSession(topic: string): Promise<void> {
  if (!walletKit) return;
  await walletKit.disconnectSession({ topic, reason: getSdkError('USER_DISCONNECTED') });
}

// A session approved under one chain (e.g. stellar:testnet:G...) is invalid
// once the active network changes — used by network-switch.ts so a dApp can't
// keep sending requests against a chain the wallet no longer has active.
export async function disconnectAllSessions(): Promise<void> {
  if (!walletKit) return;
  const sessions = walletKit.getActiveSessions();
  await Promise.all(
    Object.keys(sessions).map((topic) =>
      disconnectSession(topic).catch(() => {
        /* best-effort — a session already gone counts as disconnected */
      }),
    ),
  );
}
