import React, { useEffect, useState } from 'react';
import { View, Text, Switch, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { doc, getDoc, setDoc } from 'firebase/firestore';
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
};

const DEFAULT_PREFS: Prefs = { likes: true, comments: true, follows: true, messages: true, storyReactions: true, mentions: true, tournamentReminders: true };

const ROWS: { key: keyof Prefs; icon: string; label: string; sub: string }[] = [
  { key: 'likes',               icon: 'heart-outline',          label: 'Харесвания',           sub: 'Когато някой хареса твой улов' },
  { key: 'comments',            icon: 'chatbubble-outline',     label: 'Коментари',            sub: 'Нови коментари под твои публикации' },
  { key: 'follows',             icon: 'person-add-outline',     label: 'Нови последователи',   sub: 'Когато някой те последва' },
  { key: 'messages',            icon: 'mail-outline',           label: 'Съобщения',            sub: 'Лични съобщения' },
  { key: 'mentions',            icon: 'at-outline',             label: 'Споменавания',         sub: 'Когато някой те спомене в публикация' },
  { key: 'storyReactions',      icon: 'happy-outline',          label: 'Реакции на истории',   sub: 'Реакции към твоите истории' },
  { key: 'tournamentReminders', icon: 'trophy-outline',         label: 'Напомняния за турнири', sub: 'Когато турнир, в който участваш, завършва утре' },
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

  const toggle = async (key: keyof Prefs) => {
    if (!user) return;
    const firestore = ensureFirebase()?.db;
    if (!firestore) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setSaving(true);
    await setDoc(doc(firestore, 'users', user.uid, 'settings', 'notifications'), next).catch(() => {});
    setSaving(false);
  };

  const cardBg = mode === 'dark' ? '#0E1E35' : '#FFFFFF';
  const cardBorder = mode === 'dark' ? 'rgba(74,168,232,0.15)' : 'rgba(21,112,184,0.10)';

  return (
    <Screen scroll padded={false}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.lg }}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={{ fontSize: 20, fontFamily: 'Nunito_800ExtraBold', color: colors.text, flex: 1 }}>Известия</Text>
        {saving && <ActivityIndicator size="small" color={colors.primary} />}
      </View>

      <View style={{ marginHorizontal: spacing.xl, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: cardBorder, backgroundColor: cardBg }}>
        {loading ? (
          <View style={{ padding: spacing.xl, alignItems: 'center' }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          ROWS.map((row, i) => (
            <View key={row.key}>
              {i > 0 && <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: cardBorder, marginLeft: 54 }} />}
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: 14, gap: 12 }}>
                <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={row.icon as any} size={18} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontFamily: 'Nunito_700Bold', color: colors.text }}>{row.label}</Text>
                  <Text style={{ fontSize: 11, fontFamily: 'Nunito_400Regular', color: colors.textMuted, marginTop: 1 }}>{row.sub}</Text>
                </View>
                <Switch
                  value={prefs[row.key]}
                  onValueChange={() => void toggle(row.key)}
                  trackColor={{ false: mode === 'dark' ? '#1A3050' : '#E0E8F0', true: colors.primary + '88' }}
                  thumbColor={prefs[row.key] ? colors.primary : (mode === 'dark' ? '#3A5070' : '#C0D0E0')}
                />
              </View>
            </View>
          ))
        )}
      </View>
      <View style={{ height: spacing.xxl }} />
    </Screen>
  );
}
