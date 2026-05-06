import { Platform } from 'react-native';

export const keyboardAwareScrollProps = Platform.select({
  android: {
    keyboardShouldPersistTaps: 'handled' as const,
    nestedScrollEnabled: true,
  },
  ios: {
    keyboardShouldPersistTaps: 'handled' as const,
  },
  default: {
    keyboardShouldPersistTaps: 'handled' as const,
  },
});
