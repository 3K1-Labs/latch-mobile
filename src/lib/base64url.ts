/**
 * base64url.ts — base64url without Buffer.
 *
 * Split out of passkey-webauthn.ts so that modules needing only the encoding do
 * not inherit its dependencies: that module reaches SecureStore and the wallet
 * store, which pulls React Native in behind it, and pairing-payload.ts needs
 * these two functions for signature *verification*, which is pure.
 *
 * The explicit character loop is not a style choice. React Native's Buffer
 * polyfill mis-encodes `toString('base64')` on some inputs, emitting a decimal
 * byte list instead of base64 — see the note at the top of passkey-webauthn.ts.
 */

export function b64uEncode(data: Uint8Array | string): string {
  const bytes =
    typeof data === 'string'
      ? new TextEncoder().encode(data)
      : new Uint8Array(data instanceof Uint8Array ? data : new Uint8Array(data));
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function b64uDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
