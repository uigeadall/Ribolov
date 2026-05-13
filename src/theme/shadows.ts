import { Platform, ViewStyle } from 'react-native';

/** Лека „височина” за карти и плаващи панели */
export function shadowCard(mode: 'light' | 'dark'): ViewStyle {
  return Platform.select<ViewStyle>({
    ios: {
      shadowColor: mode === 'dark' ? '#000000' : '#1C1409',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: mode === 'dark' ? 0.45 : 0.09,
      shadowRadius: 14,
    },
    android: { elevation: 3 },
    default: {},
  })!;
}

/** По-силна сянка за основни бутони */
export function shadowButton(mode: 'light' | 'dark'): ViewStyle {
  return Platform.select<ViewStyle>({
    ios: {
      shadowColor: mode === 'dark' ? '#000000' : '#093545',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: mode === 'dark' ? 0.4 : 0.18,
      shadowRadius: 8,
    },
    android: { elevation: 3 },
    default: {},
  })!;
}
