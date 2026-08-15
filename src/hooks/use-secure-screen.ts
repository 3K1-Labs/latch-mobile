import { useEffect } from 'react';
import * as ScreenCapture from 'expo-screen-capture';

import { createLogger } from '@/src/lib/logger';

const log = createLogger('secure-screen');

/**
 * Block screenshots and screen recording while a screen is mounted.
 *
 * A recovery phrase on screen is the whole wallet. Screenshots land in the
 * photo library — routinely synced to a cloud account and, on Android, readable
 * by any app the user has granted media access. Screen recording is worse,
 * because a recording in progress captures the phrase without the deliberate
 * act of taking a shot.
 *
 * Use this on any screen that displays a recovery phrase or a PIN entry pad.
 *
 * Platform behaviour differs and neither is absolute: Android sets FLAG_SECURE,
 * which blocks capture outright; iOS cannot prevent a screenshot, so
 * expo-screen-capture blanks the screen during recording and mirroring instead.
 * Someone photographing the screen with another device defeats both, which is
 * why the phrase screens still tell the user to write it down.
 */
export function useSecureScreen(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    let released = false;
    ScreenCapture.preventScreenCaptureAsync().catch((e) => {
      // Not fatal: the screen still works, it is just capturable. Better to
      // show the user their phrase than to block them on a permissions quirk.
      log.warn('could not block screen capture:', e);
    });

    return () => {
      if (released) return;
      released = true;
      ScreenCapture.allowScreenCaptureAsync().catch((e) => {
        log.warn('could not re-allow screen capture:', e);
      });
    };
  }, [enabled]);
}
