import * as Linking from 'expo-linking';
import { useEffect } from 'react';

import { useWalletConnectPairing } from '@/src/hooks/use-walletconnect-pairing';

// Matches a WalletConnect URI passed either as the whole deep link (the "wc"
// scheme registered in app.config.js) or as a ?uri= param on a latch:// /
// universal link, e.g. latch://wc?uri=wc%3A...%402%3Frelay-protocol%3Dirn...
function extractWcUri(url: string): string | null {
  if (url.startsWith('wc:')) return url;

  const match = url.match(/[?&]uri=([^&]+)/);
  if (!match) return null;

  try {
    const decoded = decodeURIComponent(match[1]);
    return decoded.startsWith('wc:') ? decoded : null;
  } catch {
    return null;
  }
}

// Lets a dApp's "Connect Wallet" button (or a shared wc: link) open Latch
// directly and start pairing, instead of requiring a manual QR scan/paste.
export function useWalletConnectDeepLink() {
  const { pair } = useWalletConnectPairing();

  useEffect(() => {
    const handleUrl = (url: string) => {
      const uri = extractWcUri(url);
      if (uri) pair(uri);
    };

    Linking.getInitialURL().then((url) => {
      if (url) handleUrl(url);
    });

    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => sub.remove();
  }, [pair]);
}
