import { Platform, ViewStyle } from 'react-native';

/** Лека „височина” за карти и плаващи панели */
export function shadowCard(mode: 'light' | 'dark'): ViewStyle {
  return Platform.select<ViewStyle>({
    ios: {
      shadowColor: mode === 'dark' ? '#000000' : '#0E2235',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: mode === 'dark' ? 0.35 : 0.06,
      shadowRadius: 8,
    },
    android: { elevation: 3 },
    default: {},
  })!;
}

/** По-силна сянка за основни бутони */
export function shadowButton(mode: 'light' | 'dark'): ViewStyle {
  return Platform.select<ViewStyle>({
    ios: {
      shadowColor: mode === 'dark' ? '#000000' : '#0E2235',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: mode === 'dark' ? 0.3 : 0.1,
      shadowRadius: 5,
    },
    android: { elevation: 3 },
    default: {},
  })!;
}
