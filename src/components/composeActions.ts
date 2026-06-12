import * as Haptics from 'expo-haptics';
import { ActionSheet } from './ActionSheet';

/**
 * Отваря compose листа („Сподели улов" / „Напиши пост"). Извиква се от
 * централния „+" в AppTabBar; вика се само при логнат потребител — гостите
 * изобщо не виждат бутона.
 */
export function openComposeSheet(navigation: unknown) {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  ActionSheet.show({
    title: 'Какво искаш да споделиш?',
    options: [
      {
        label: 'Сподели улов',
        icon: 'fish-outline',
        onPress: () =>
          (navigation as any).navigate('LogbookTab', { screen: 'AddCatch', params: {} }),
      },
      {
        label: 'Напиши пост',
        icon: 'create-outline',
        onPress: () =>
          (navigation as any).navigate('FeedTab', { screen: 'CreatePost' }),
      },
    ],
  });
}
