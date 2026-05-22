import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  name: React.ComponentProps<typeof Ionicons>['name'];
  size?: number;
  color?: string;
  count: number;
};

export function BadgeIcon({ name, size = 24, color, count }: Props) {
  // Show "99+" when over the cap so 250 unread doesn't render the same as 99.
  const label = count > 99 ? '99+' : String(count);
  return (
    <View style={styles.wrap}>
      <Ionicons name={name} size={size} color={color} />
      {count > 0 ? (
        <View style={[styles.badge, label.length > 1 && styles.badgeWide]}>
          <Text style={styles.badgeText}>{label}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  badge: {
    position: 'absolute',
    top: -5,
    right: -7,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: '#e53935',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  badgeWide: { right: -10 },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#fff',
    lineHeight: 12,
  },
});
