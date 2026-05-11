import React from 'react';
import { View, Text, Pressable, Modal, FlatList, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../services/themeContext';
import { spacing, typography } from '../theme/typography';
import type { TripPlan } from '../types';

type Props = {
  visible: boolean;
  trips: TripPlan[];
  selectedTripId: string | undefined;
  onSelect: (id: string | undefined) => void;
  onClose: () => void;
};

const NO_TRIP: TripPlan = { id: '', title: 'Без излет', dateIso: '' };

export function TripPickerModal({ visible, trips, selectedTripId, onSelect, onClose }: Props) {
  const { colors } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={onClose} />
      <View
        style={{
          backgroundColor: colors.card,
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          paddingBottom: 32,
          maxHeight: '60%',
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: spacing.lg,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.border,
          }}
        >
          <Text style={{ ...typography.h3, color: colors.text }}>Избери излет</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={24} color={colors.textMuted} />
          </Pressable>
        </View>
        <FlatList
          data={[NO_TRIP, ...trips]}
          keyExtractor={(t) => t.id || 'none'}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                onSelect(item.id || undefined);
                onClose();
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.md,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: colors.border,
              }}
            >
              <View>
                <Text style={{ ...typography.bodyBold, color: colors.text }}>{item.title}</Text>
                {item.dateIso ? (
                  <Text style={{ ...typography.caption, color: colors.textMuted }}>
                    {new Date(item.dateIso).toLocaleDateString('bg-BG')}
                  </Text>
                ) : null}
              </View>
              {(selectedTripId ?? '') === item.id ? (
                <Ionicons name="checkmark" size={20} color={colors.primary} />
              ) : null}
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}
