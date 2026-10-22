/**
 * WebAuthn's relying party ID is a bare domain, never a URL — the spec derives
 * it from an origin's effective domain, and every consumer here assumes that:
 * rpIdHash is SHA256 of the domain, clientDataJSON.origin is the domain with an
 * https:// scheme in front, and iOS's associated domain is `webcredentials:` +
 * the domain.
 *
 * EXPO_PUBLIC_PASSKEY_RP_ID has been set to a URL ("https://uselatch.app")
 * more than once, which produced a wrong rpIdHash, an origin with two schemes,
 * and an unparsable associated domain — all silently, because nothing rejects a
 * scheme until latch-api rejects the assertion. Normalising once at the edge is
 * what keeps those three in agreement.
 */
export function normalizePasskeyRpId(value: string): string {
  return value
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '') // scheme
    .replace(/\/.*$/, ''); // path, including a bare trailing slash
}
