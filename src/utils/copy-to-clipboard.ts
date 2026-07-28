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
