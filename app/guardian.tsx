/**
 * latch://guardian?c=<payload> — deep-link entry for anything a guardian is
 * sent: an invitation to the role, or a recovery to approve.
 *
 * One route for both, because the payload identifies itself
 * (classifyGuardianPayload) and the person receiving it should not have to know
 * which kind they were sent. Tapping the link is what replaces finding the app,
 * finding the right screen, and pasting into the right box.
 *
 * Thin redirect, mirroring latch://cosign: it forwards into the profile tab and
 * lets the guardian sheet do the work, so the public link path stays stable
 * while the implementation can move.
 */

import { Redirect, useLocalSearchParams } from 'expo-router';

export default function GuardianDeepLink() {
  const { c, code } = useLocalSearchParams<{ c?: string; code?: string }>();
  const payload = c ?? code;
  return (
    <Redirect href={{ pathname: '/(tabs)/profile', params: payload ? { guardian: payload } : {} }} />
  );
}
