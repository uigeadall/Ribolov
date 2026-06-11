import React, { useEffect, useState } from 'react';
import { View, Text, Switch, StyleSheet, Pressable, ActivityIndicator, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import Toast from 'react-native-toast-message';
import { Screen } from '../components/Screen';
import { useAuth } from '../services/authContext';
import { useTheme } from '../services/themeContext';
import { ensureFirebase } from '../services/firebase';
import { spacing } from '../theme/typography';
import { useAppNavigation } from '../navigation/useAppNavigation';

type Prefs = {
  likes: boolean;
  comments: boolean;
  follows: boolean;
  messages: boolean;
  storyReactions: boolean;
  mentions: boolean;
  tournamentReminders: boolean;
  // Quiet hours — mirrors the server-side NotifPrefs shape in
  // functions/src/index.ts. When enabled, push notifications between
  // [start:00] and [end:00] in the user's timezone are silently dropped;
  // the Firestore notification doc is still written so the inbox stays
  // accurate.
  quietHoursEnabled: boolean;
  quietHoursStart: number; // 0-23
  quietHoursEnd: number;   // 0-23
  timezone: string;        // IANA, e.g. 'Europe/Sofia'
};

const DEFAULT_PREFS: Prefs = {
  likes: true,
  comments: true,
  follows: true,
  messages: true,
  storyReactions: true,
  mentions: true,
  tournamentReminders: true,
  quietHoursEnabled: false,
  quietHoursStart: 22,
  quietHoursEnd: 7,
  // Resolve the device's IANA timezone at load time. Without this the
  // Cloud Function falls back to Europe/Sofia which is correct for ~95%
  // of users but breaks for anglers abroad.
  timezone: Intl?.DateTimeFormat?.()?.resolvedOptions?.()?.timeZone ?? 'Europe/Sofia',
};

// Narrow the row key to ONLY the boolean prefs — the new non-boolean
// quiet-hours fields (start/end/timezone) have their own dedicated UI
// further down and shouldn't be rendered through the toggle template.
type BoolPrefKey = 'likes' | 'comments' | 'follows' | 'messages' | 'storyReactions' | 'mentions' | 'tournamentReminders';
type Row = { key: BoolPrefKey; icon: string; label: string; sub: string };

// Grouped by conceptual category so a 7-row list reads as 3 small,
// scannable sections instead of a single flat scroll. Order within each
// group follows expected frequency (most-common at top).
const SECTIONS: { title: string; rows: Row[] }[] = [
  {
    title: 'Социални',
    rows: [
      { key: 'likes',         icon: 'heart-outline',      label: 'Харесвания',           sub: 'Когато някой хареса твой улов' },
      { key: 'comments',      icon: 'chatbubble-outline', label: 'Коментари',            sub: 'Нови коментари под твои публикации' },
      { key: 'follows',       icon: 'person-add-outline', label: 'Нови последователи',   sub: 'Когато някой те последва' },
      { key: 'mentions',      icon: 'at-outline',         label: 'Споменавания',         sub: 'Когато някой те спомене в публикация' },
    ],
  },
  {
    title: 'Лични',
    rows: [
      { key: 'messages',       icon: 'mail-outline',  label: 'Съобщения',            sub: 'Лични съобщения' },
      { key: 'storyReactions', icon: 'happy-outline', label: 'Реакции на истории',   sub: 'Реакции към твоите истории' },
    ],
  },
  {
    title: 'Събития',
    rows: [
      { key: 'tournamentReminders', icon: 'trophy-outline', label: 'Напомняния за турнири', sub: 'Когато турнир, в който участваш, завършва утре' },
    ],
  },
];

export default function NotificationPreferencesScreen() {
  const { colors, mode } = useTheme();
  const { user } = useAuth();
  const navigation = useAppNavigation();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    const firestore = ensureFirebase()?.db;
    if (!firestore) { setLoading(false); return; }
    getDoc(doc(firestore, 'users', user.uid, 'settings', 'notifications'))
      .then((snap) => { if (snap.exists()) setPrefs({ ...DEFAULT_PREFS, ...snap.data() as Partial<Prefs> }); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  // Generic prefs writer — handles both boolean toggles and numeric quiet-
  // hours fields with the same optimistic-update-then-write pattern.
  // Rollback on failure so the UI doesn't lie. Captures the FULL previous
  // prefs so rolling back is one assignment regardless of which field
  // changed.
  const updatePrefs = async (patch: Partial<Prefs>) => {
    if (!user) return;
    const firestore = ensureFirebase()?.db;
    if (!firestore) return;
    const previous = prefs;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    setSaving(true);
    try {
      await setDoc(doc(firestore, 'users', user.uid, 'settings', 'notifications'), next);
    } catch {
      setPrefs(previous);
      Toast.show({
        type: 'error',
        text1: 'Грешка',
        text2: 'Не успяхме да запазим настройката. Опитай отново.',
        visibilityTime: 2500,
      });
    } finally {
      setSaving(false);
    }
  };

  const toggle = (key: 'likes' | 'comments' | 'follows' | 'messages' | 'storyReactions' | 'mentions' | 'tournamentReminders') =>
    updatePrefs({ [key]: !prefs[key] } as Partial<Prefs>);

  // Time-picker modal state — null when closed, 'start' / 'end' when open.
  // iOS uses the inline spinner; Android pops the native dialog one-shot.
  const [pickingHour, setPickingHour] = useState<'start' | 'end' | null>(null);
  const formatHour = (h: number) => `${String(h).padStart(2, '0')}:00`;

  // Use theme tokens so a future accent palette change applies here too —
  // earlier these were hardcoded hex which drifted from the rest of the
  // app whenever the theme moved.
  const cardBg = colors.card;
  const cardBorder = colors.border;

  return (
    <Screen scroll padded={false}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.lg }}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Назад">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={{ fontSize: 20, fontFamily: 'Manrope_800ExtraBold', color: colors.text, flex: 1 }}>Известия</Text>
        {saving && <ActivityIndicator size="small" color={colors.primary} />}
      </View>

      {loading ? (
        <View style={{ padding: spacing.xl, alignItems: 'center' }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <>
        {SECTIONS.map((section) => (
          <View key={section.title} style={{ marginBottom: spacing.lg }}>
            {/* Section header — small uppercase label with letter-spacing,
                same pattern Apple Settings uses for grouped lists. Reads
                as "this is a subset" without taking much vertical space. */}
            <Text style={{
              fontSize: 11,
              fontFamily: 'Manrope_700Bold',
              letterSpacing: 0.8,
              textTransform: 'uppercase',
              color: colors.textMuted,
              paddingHorizontal: spacing.xl + spacing.sm,
              paddingBottom: 6,
            }}>
              {section.title}
            </Text>
            <View style={{ marginHorizontal: spacing.xl, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: cardBorder, backgroundColor: cardBg }}>
              {section.rows.map((row, i) => (
                <View key={row.key}>
                  {i > 0 && <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: cardBorder, marginLeft: 54 }} />}
                  <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: 14, gap: 12 }}>
                    <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name={row.icon as any} size={18} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontFamily: 'Manrope_700Bold', color: colors.text }}>{row.label}</Text>
                      <Text style={{ fontSize: 11, fontFamily: 'Manrope_400Regular', color: colors.textMuted, marginTop: 1 }}>{row.sub}</Text>
                    </View>
                    <Switch
                      value={prefs[row.key]}
                      onValueChange={() => void toggle(row.key)}
                      trackColor={{ false: colors.border, true: colors.primary + '88' }}
                      thumbColor={prefs[row.key] ? colors.primary : colors.surfaceAlt}
                    />
                  </View>
                </View>
              ))}
            </View>
          </View>
        ))}

        {/* ── Quiet hours ──
            Sits below the category list because it cuts ACROSS categories:
            disables every push during the window, regardless of which
            type is being sent. Visual treatment matches the section
            headers above. */}
        <View style={{ marginBottom: spacing.lg }}>
          <Text style={{
            fontSize: 11,
            fontFamily: 'Manrope_700Bold',
            letterSpacing: 0.8,
            textTransform: 'uppercase',
            color: colors.textMuted,
            paddingHorizontal: spacing.xl + spacing.sm,
            paddingBottom: 6,
          }}>
            Тихи часове
          </Text>
          <View style={{ marginHorizontal: spacing.xl, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: cardBorder, backgroundColor: cardBg }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: 14, gap: 12 }}>
              <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="moon-outline" size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontFamily: 'Manrope_700Bold', color: colors.text }}>Не ме безпокой</Text>
                <Text style={{ fontSize: 11, fontFamily: 'Manrope_400Regular', color: colors.textMuted, marginTop: 1 }}>
                  Известията остават в приложението, но няма да получаваш push.
                </Text>
              </View>
              <Switch
                value={prefs.quietHoursEnabled}
                onValueChange={(v) => void updatePrefs({ quietHoursEnabled: v })}
                trackColor={{ false: colors.border, true: colors.primary + '88' }}
                thumbColor={prefs.quietHoursEnabled ? colors.primary : colors.surfaceAlt}
              />
            </View>
            {prefs.quietHoursEnabled ? (
              <>
                <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: cardBorder, marginLeft: 54 }} />
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: 14, gap: 12 }}>
                  <View style={{ width: 34, height: 34 }} />
                  <Text style={{ flex: 1, fontSize: 14, fontFamily: 'Manrope_600SemiBold', color: colors.text }}>Начало</Text>
                  <Pressable
                    onPress={() => setPickingHour('start')}
                    hitSlop={8}
                    style={{ paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.primarySurface }}
                  >
                    <Text style={{ fontSize: 14, fontFamily: 'Manrope_700Bold', color: colors.primary }}>{formatHour(prefs.quietHoursStart)}</Text>
                  </Pressable>
                </View>
                <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: cardBorder, marginLeft: 54 }} />
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: 14, gap: 12 }}>
                  <View style={{ width: 34, height: 34 }} />
                  <Text style={{ flex: 1, fontSize: 14, fontFamily: 'Manrope_600SemiBold', color: colors.text }}>Край</Text>
                  <Pressable
                    onPress={() => setPickingHour('end')}
                    hitSlop={8}
                    style={{ paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.primarySurface }}
                  >
                    <Text style={{ fontSize: 14, fontFamily: 'Manrope_700Bold', color: colors.primary }}>{formatHour(prefs.quietHoursEnd)}</Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </View>
        </View>

        {/* Time-picker. Modal-style on Android (one-shot dialog), inline
            on iOS where the spinner is the native pattern. We seed the
            picker with a Date object whose hour matches the current value
            and ignore minutes/seconds on the way back out — the stored
            field is whole hours only. */}
        {pickingHour ? (
          <DateTimePicker
            value={(() => {
              const d = new Date();
              d.setHours(pickingHour === 'start' ? prefs.quietHoursStart : prefs.quietHoursEnd, 0, 0, 0);
              return d;
            })()}
            mode="time"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(_, picked) => {
              const closing = Platform.OS === 'android'; // Android picker dismisses itself
              if (picked) {
                const hour = picked.getHours();
                void updatePrefs(
                  pickingHour === 'start'
                    ? { quietHoursStart: hour }
                    : { quietHoursEnd: hour },
                );
              }
              if (closing) setPickingHour(null);
            }}
          />
        ) : null}
        {pickingHour && Platform.OS === 'ios' ? (
          <Pressable
            onPress={() => setPickingHour(null)}
            style={{ marginHorizontal: spacing.xl, marginTop: spacing.sm, paddingVertical: 12, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center' }}
          >
            <Text style={{ fontSize: 15, fontFamily: 'Manrope_700Bold', color: '#fff' }}>Готово</Text>
          </Pressable>
        ) : null}
        </>
      )}
      <View style={{ height: spacing.xxl }} />
    </Screen>
  );
}
