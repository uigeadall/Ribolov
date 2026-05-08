import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { spacing, typography } from '../theme/typography';

export function OfflineBanner() {
  const online = useNetworkStatus();
  if (online) return null;
  return (
    <View style={styles.bar}>
      <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
      <Text style={styles.text}>Офлайн — проверете интернет връзката</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: spacing.lg,
    backgroundColor: '#c0392b',
  },
  text: { ...typography.small, color: '#fff', fontWeight: '600' },
});
