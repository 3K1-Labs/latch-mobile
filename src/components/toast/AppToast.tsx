import Toast from 'react-native-toast-message';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toastConfig } from './toastConfig';

/**
 * The app's Toast host. Mount this instead of `<Toast/>` directly.
 *
 * A React Native Modal is its own native window above the root view, so the
 * instance in app/_layout.tsx can never paint over one — every Modal that needs
 * toasts mounts its own. The library keeps a stack of refs and shows on the most
 * recently mounted, restoring the previous on unmount, so multiple instances are
 * safe as long as each is gated on its container being visible.
 */
export default function AppToast() {
  const insets = useSafeAreaInsets();
  // The library's default topOffset is a flat 40, which sits under the notch /
  // Dynamic Island. Clear the inset instead, and never drop below the old
  // default on devices with a small (or zero) top inset.
  const topOffset = Math.max(insets.top + 8, 40);
  return <Toast config={toastConfig} topOffset={topOffset} />;
}
