import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  FlatList,
  Pressable,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { speciesList } from '../data/species';
import { recentSpeciesStore } from '../storage/storage';

type Props = {
  visible: boolean;
  selectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
};

export function SpeciesPicker({ visible, selectedId, onSelect, onClose }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [recentIds, setRecentIds] = useState<string[]>([]);

  useEffect(() => {
    if (visible) recentSpeciesStore.get().then(setRecentIds);
  }, [visible]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return speciesList;
    return speciesList.filter(
      (s) =>
        s.nameBg.toLowerCase().includes(q) ||
        s.nameLatin.toLowerCase().includes(q)
    );
  }, [query]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
        sheet: {
          backgroundColor: colors.card,
          borderTopLeftRadius: radius.xl,
          borderTopRightRadius: radius.xl,
          paddingBottom: Math.max(insets.bottom, spacing.md),
          maxHeight: '82%',
          borderTopWidth: 1,
          borderColor: colors.border,
        },
        handle: {
          width: 36,
          height: 4,
          borderRadius: 2,
          backgroundColor: colors.border,
          alignSelf: 'center',
          marginTop: spacing.sm,
          marginBottom: spacing.md,
        },
        headerRow: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: spacing.lg,
          marginBottom: spacing.md,
          gap: spacing.sm,
        },
        title: { ...typography.h3, color: colors.text, flex: 1 },
        searchWrap: {
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.surfaceAlt,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          paddingHorizontal: spacing.md,
          marginHorizontal: spacing.lg,
          marginBottom: spacing.sm,
          gap: spacing.sm,
        },
        searchInput: {
          flex: 1,
          paddingVertical: Platform.OS === 'ios' ? spacing.sm + 2 : spacing.sm,
          fontSize: 15,
          color: colors.text,
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.lg,
          gap: spacing.md,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
        },
        rowActive: { backgroundColor: colors.primarySurface },
        nameCol: { flex: 1 },
        nameBg: { ...typography.bodyBold, color: colors.text },
        nameLatin: { ...typography.small, color: colors.textMuted, fontStyle: 'italic', marginTop: 2 },
        empty: {
          ...typography.body,
          color: colors.textMuted,
          textAlign: 'center',
          paddingVertical: spacing.xl,
        },
      }),
    [colors, insets.bottom]
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>Вид риба</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>
          </View>
          <View style={styles.searchWrap}>
            <Ionicons name="search-outline" size={18} color={colors.textMuted} />
            <TextInput
              placeholder="Търси вид…"
              placeholderTextColor={colors.textMuted}
              value={query}
              onChangeText={setQuery}
              style={styles.searchInput}
              autoFocus
              clearButtonMode="while-editing"
              returnKeyType="search"
            />
          </View>
          <FlatList
            data={filtered}
            keyExtractor={(s) => s.id}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              recentIds.length > 0 && !query.trim() ? (
                <>
                  <Text style={{ ...typography.small, fontWeight: '700', color: colors.textMuted, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, letterSpacing: 0.5 }}>
                    ПОСЛЕДНО ИЗПОЛЗВАНИ
                  </Text>
                  {recentIds.map((id) => {
                    const s = speciesList.find((x) => x.id === id);
                    if (!s) return null;
                    const active = s.id === selectedId;
                    return (
                      <Pressable
                        key={s.id}
                        style={[styles.row, active && styles.rowActive]}
                        onPress={() => { onSelect(s.id); onClose(); setQuery(''); }}
                        android_ripple={{ color: `${colors.primary}22` }}
                      >
                        <View style={styles.nameCol}>
                          <Text style={styles.nameBg}>{s.nameBg}</Text>
                          <Text style={styles.nameLatin}>{s.nameLatin}</Text>
                        </View>
                        {active ? <Ionicons name="checkmark-circle" size={20} color={colors.primary} /> : null}
                      </Pressable>
                    );
                  })}
                  <Text style={{ ...typography.small, fontWeight: '700', color: colors.textMuted, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, letterSpacing: 0.5 }}>
                    ВСИЧКИ ВИДОВЕ
                  </Text>
                </>
              ) : null
            }
            ListEmptyComponent={
              <Text style={styles.empty}>Няма намерени видове</Text>
            }
            renderItem={({ item }) => {
              const active = item.id === selectedId;
              return (
                <Pressable
                  style={[styles.row, active && styles.rowActive]}
                  onPress={() => { onSelect(item.id); onClose(); setQuery(''); }}
                  android_ripple={{ color: `${colors.primary}22` }}
                >
                  <View style={styles.nameCol}>
                    <Text style={styles.nameBg}>{item.nameBg}</Text>
                    <Text style={styles.nameLatin}>{item.nameLatin}</Text>
                  </View>
                  {active ? (
                    <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                  ) : null}
                </Pressable>
              );
            }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
