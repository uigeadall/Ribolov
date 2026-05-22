import React from 'react';
import Toast from 'react-native-toast-message';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// react-native-toast-message defaults to topOffset=30, which clips behind
// the dynamic island on iPhone 14+ and behind the notch on iPhone X-13.
// Wrap it once at the root and feed in the real safe-area top so toasts
// always land just below the system UI, on every device size.
export function SafeToast() {
  const insets = useSafeAreaInsets();
  return <Toast topOffset={insets.top + 8} />;
}
