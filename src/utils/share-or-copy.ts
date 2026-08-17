/**
 * share-or-copy.ts — hand a string to the person it has to reach.
 *
 * Guardian invites, their replies, and recovery requests all have to travel
 * between two people who are not in the same app. Copying to the clipboard
 * leaves the user to remember what they are holding and find somewhere to paste
 * it; the OS share sheet puts their messaging apps one tap away, which is where
 * these actually go.
 *
 * Falls back to the clipboard when sharing is unavailable or the user dismisses
 * the sheet, so the value is never lost either way.
 */

import { Share } from 'react-native';

import { copyToClipboard } from '@/src/utils/copy-to-clipboard';

export interface ShareOrCopyOptions {
  /** A line of context above the payload, so the recipient knows what it is. */
  message: string;
  /** The payload itself. */
  payload: string;
  /** Android dialog title. */
  title?: string;
  /**
   * Send as a `latch://` link the recipient can tap, rather than a blob they
   * must copy and paste into the right field. The raw payload is included
   * underneath as a fallback for anyone whose messenger mangles the link or who
   * does not have the app installed yet.
   */
  asLink?: boolean;
}

/** Deep link that opens the guardian screen with the payload already loaded. */
function guardianLink(payload: string): string {
  return `latch://guardian?c=${encodeURIComponent(payload)}`;
}

export async function shareOrCopy(options: ShareOrCopyOptions): Promise<void> {
  const body = options.asLink
    ? `${options.message}\n\n${guardianLink(options.payload)}\n\nOr paste this into Latch:\n${options.payload}`
    : `${options.message}\n\n${options.payload}`;
  try {
    const result = await Share.share({ message: body }, { dialogTitle: options.title });
    // `dismissedAction` means they backed out without choosing anywhere to send
    // it — leave it on the clipboard rather than silently doing nothing.
    if (result.action === Share.dismissedAction) {
      await copyToClipboard(options.payload);
    }
  } catch {
    await copyToClipboard(options.payload);
  }
}
