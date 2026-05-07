import React, { useMemo } from 'react';
import { Text, ScrollView, StyleSheet, View, Pressable, Linking, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';

/**
 * ← Замени тези URL-и с реалните адреси на документите.
 * Можеш да ги публикуваш в Notion, GitHub Pages или друга статична страница.
 */
const PRIVACY_POLICY_URL = 'https://your-domain.com/privacy';
const TERMS_URL = 'https://your-domain.com/terms';
const CONTACT_EMAIL = 'support@ribolov.app';

const openUrl = (url: string) =>
  Linking.openURL(url).catch(() =>
    Alert.alert('Грешка', 'Неуспешно отваряне на страницата.')
  );

export default function LegalInfoScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

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
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
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
