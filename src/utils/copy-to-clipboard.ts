import * as Clipboard from 'expo-clipboard';
import Toast from 'react-native-toast-message';

/**
 * Copy a value and confirm it with a toast. A copy leaves no visible trace on
 * its own, so without the toast the user can't tell a tap registered.
 *
 * @param value the exact string placed on the clipboard — pass the full value,
 *              never a truncated display form
 * @param label what was copied, e.g. 'Address' → "Address copied to clipboard"
 */
export async function copyToClipboard(value: string, label = 'Address'): Promise<void> {
  if (!value) return;
  await Clipboard.setStringAsync(value);
  Toast.show({
    type: 'success',
    text1: 'Copied',
    text2: `${label} copied to clipboard`,
  });
}

/** How long a secret is allowed to sit on the clipboard before it is cleared. */
const SECRET_CLIPBOARD_TTL_MS = 60_000;

/**
 * Copy a secret — a recovery phrase, a private key — that must not be left on
 * the clipboard.
 *
 * The system clipboard is shared: other apps can read it, Android may show its
 * contents in a preview, and on Apple devices Universal Clipboard syncs it to
 * every machine signed into the same account. A recovery phrase left there is
 * a recovery phrase handed to whatever reads it next.
 *
 * This copies, tells the user it is temporary, and clears it a minute later.
 * The clear is conditional: if the user has copied something else since, their
 * clipboard is left alone rather than wiped.
 *
 * Note this is a mitigation, not a guarantee. A clipboard reader running while
 * the value is live still sees it, and the timer dies with the process. Pasting
 * straight into a password manager remains the safer path, which is why the
 * toast says the copy is temporary rather than implying it is safe.
 */
export async function copySecretToClipboard(value: string, label = 'Recovery phrase'): Promise<void> {
  if (!value) return;
  await Clipboard.setStringAsync(value);

  Toast.show({
    type: 'success',
    text1: 'Copied — clears in 1 minute',
    text2: `${label} copied. Paste it somewhere safe now.`,
  });

  setTimeout(async () => {
    try {
      // Only clear what we put there. The user may have copied something of
      // their own in the meantime, and wiping that would be worse than the
      // exposure we are trying to shorten.
      const current = await Clipboard.getStringAsync();
      if (current === value) await Clipboard.setStringAsync('');
    } catch {
      // A clipboard read can fail (permissions, backgrounding). Nothing useful
      // to do — the value simply stays until the user copies something else.
    }
  }, SECRET_CLIPBOARD_TTL_MS);
}
