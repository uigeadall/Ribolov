import React, { useMemo, useState } from 'react';
import { Text, ScrollView, StyleSheet, View, Pressable, Linking, ActivityIndicator } from 'react-native';
import { useAppNavigation } from '../navigation/useAppNavigation';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { handleError } from '../utils/handleError';
import { useAuth } from '../services/authContext';
import { exportMyDataAndShare } from '../services/gdprExport';
import { notifyError } from '../utils/notify';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';

/**
 * Public-facing legal documents are hosted on GitHub Pages from /docs.
 * To enable: repo Settings → Pages → Source = main branch, /docs folder.
 * After enabling, the URLs below resolve to the static HTML.
 */
const PRIVACY_POLICY_URL = 'https://uigeadall.github.io/Ribolov/privacy.html';
const TERMS_URL = 'https://uigeadall.github.io/Ribolov/terms.html';
const CONTACT_EMAIL = 'support@ribolov.app';

const openUrl = (url: string) =>
  Linking.openURL(url).catch((e) => handleError(e));

export default function LegalInfoScreen() {
  const navigation = useAppNavigation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [exporting, setExporting] = useState(false);

  const onExportMyData = async () => {
    if (!user?.uid || exporting) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExporting(true);
    try {
      await exportMyDataAndShare(user.uid);
      Toast.show({ type: 'success', text1: 'Готово', text2: 'Данните са изпратени към избраното приложение.', visibilityTime: 2400 });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Опитай отново.';
      notifyError('Експортът не успя', msg);
    } finally {
      setExporting(false);
    }
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        header: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
        },
        headerTitle: { ...typography.h2, color: colors.text, flex: 1 },
        sectionTitle: { ...typography.bodyBold, color: colors.text, marginBottom: spacing.sm },
        body: { ...typography.body, color: colors.textMuted, lineHeight: 22, marginTop: spacing.xs },
        link: { ...typography.bodyBold, color: colors.primary, marginTop: spacing.md },
        bullet: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
        bulletDot: { ...typography.body, color: colors.textMuted },
        bulletText: { ...typography.body, color: colors.textMuted, lineHeight: 22, flex: 1 },
      }),
    [colors]
  );

  const Bullet = ({ text }: { text: string }) => (
    <View style={styles.bullet}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Назад">
          <Ionicons name="chevron-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Правна информация</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        {/* Privacy Policy */}
        <Card style={{ marginBottom: spacing.md }}>
          <Text style={styles.sectionTitle}>Политика за поверителност</Text>
          <Text style={styles.body}>
            Приложението „Риболов" събира и обработва следните лични данни за осигуряване на услугата:
          </Text>
          <Bullet text="Имейл адрес и парола — за идентификация в акаунта." />
          <Bullet text="Показвано ime, снимка на профил и град — публично видими в лентата." />
          <Bullet text="GPS координати — за отбелязване на спотове и прогноза. Записват се само при твое действие." />
          <Bullet text="Снимки и видеа — качвани доброволно към улови и Моменти." />
          <Bullet text="Социално съдържание — улови, харесвания, коментари, съобщения между потребители." />
          <Text style={[styles.body, { marginTop: spacing.md }]}>
            Данните се съхраняват в Firebase (Google Cloud Infrastructure) и се обработват съгласно условията на Google.
            Не продаваме и не споделяме лични данни с трети страни за рекламни цели.
          </Text>
          <Pressable onPress={() => openUrl(PRIVACY_POLICY_URL)} hitSlop={8}>
            <Text style={styles.link}>Пълна политика за поверителност →</Text>
          </Pressable>
        </Card>

        {/* GDPR Rights */}
        <Card style={{ marginBottom: spacing.md }}>
          <Text style={styles.sectionTitle}>Твоите права (GDPR)</Text>
          <Text style={styles.body}>Като потребител имаш право да:</Text>
          <Bullet text="Получиш копие на личните си данни." />
          <Bullet text="Коригираш неточни данни от Профил → Публични данни." />
          <Bullet text="Изтриеш акаунта и всички свързани данни (Профил → Изтриване на акаунта)." />
          <Bullet text="Ограничиш или възразиш срещу обработването — пиши ни на имейл по-долу." />
          {/* "Download my data" — fulfils the data-portability promise in
              the privacy policy. Bundles local logbook + cloud footprint
              (profile, public catches, posts, follows, etc.) into a JSON
              file and surfaces the system share sheet. */}
          {user?.uid ? (
            <Pressable
              onPress={onExportMyData}
              disabled={exporting}
              hitSlop={6}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                marginTop: spacing.md,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                borderRadius: radius.md,
                backgroundColor: colors.primarySurface,
                borderWidth: 1,
                borderColor: colors.border,
                alignSelf: 'flex-start',
                opacity: exporting ? 0.6 : 1,
              }}
              accessibilityRole="button"
              accessibilityLabel="Изтегли моите данни"
            >
              {exporting ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons name="download-outline" size={18} color={colors.primary} />
              )}
              <Text style={{ ...typography.bodyBold, color: colors.primary }}>
                {exporting ? 'Подготвяме файла…' : 'Изтегли моите данни'}
              </Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => openUrl(`mailto:${CONTACT_EMAIL}?subject=GDPR запитване`)} hitSlop={8}>
            <Text style={styles.link}>{CONTACT_EMAIL}</Text>
          </Pressable>
        </Card>

        {/* Terms */}
        <Card style={{ marginBottom: spacing.md }}>
          <Text style={styles.sectionTitle}>Условия за ползване</Text>
          <Text style={styles.body}>
            Приложението е с информационна цел. Авторите не носят отговорност за решения, взети на база прогнози,
            данни за видове, забранени периоди или социално публикувано съдържание.
          </Text>
          <Text style={[styles.body, { marginTop: spacing.sm }]}>
            Данните за забранените периоди са ориентировъчни — проверявай актуалните заповеди на ИАРА преди излет.
          </Text>
          <Text style={[styles.body, { marginTop: spacing.sm }]}>
            Забранено е публикуването на незаконно съдържание, тормоз, фалшиви данни или нарушаване правата на трети лица.
            Нарушителите могат да бъдат блокирани и докладвани на администрацията.
          </Text>
          <Pressable onPress={() => openUrl(TERMS_URL)} hitSlop={8}>
            <Text style={styles.link}>Пълни условия за ползване →</Text>
          </Pressable>
        </Card>

        {/* Contact */}
        <Card>
          <Text style={styles.sectionTitle}>Контакт и поддръжка</Text>
          <Text style={styles.body}>
            Въпроси, сигнали за злоупотреба или искания за лични данни:
          </Text>
          <Pressable onPress={() => openUrl(`mailto:${CONTACT_EMAIL}`)} hitSlop={8}>
            <Text style={styles.link}>{CONTACT_EMAIL}</Text>
          </Pressable>
        </Card>
      </ScrollView>
    </Screen>
  );
}
