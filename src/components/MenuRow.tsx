import React, { useMemo } from 'react';
import { Pressable, View, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../services/themeContext';
import { spacing, typography } from '../theme/typography';

type Props = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  onPress: () => void;
  showDivider?: boolean;
  dense?: boolean;
  destructive?: boolean;
  /** Red badge count shown before the chevron */
  rightBadge?: number;
};

export function MenuRow({ icon, title, subtitle, onPress, showDivider, dense, destructive, rightBadge }: Props) {
  const { colors } = useTheme();
  const iconBox = dense ? 30 : 40;
  const iconRadius = dense ? 9 : 12;
  const padV = dense ? spacing.sm : spacing.md + 2;
  const iconGap = dense ? spacing.sm : spacing.md;
  const iconGlyph = dense ? 17 : 21;
  const chevronSz = dense ? 17 : 20;
  const dividerInset = iconBox + iconGap;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        press: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: padV,
          paddingHorizontal: spacing.xs,
          borderRadius: spacing.sm,
        },
        iconBg: {
          width: iconBox,
          height: iconBox,
          borderRadius: iconRadius,
          backgroundColor: destructive ? `${colors.danger}22` : colors.primarySurface,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: iconGap,
        },
        title: {
          ...(dense
            ? { fontSize: 14, fontWeight: '600' as const, letterSpacing: 0.06, lineHeight: 19 }
            : typography.bodyBold),
          color: destructive ? colors.danger : colors.text,
          flex: 1,
        },
        sub: { ...typography.caption, color: colors.textMuted, marginTop: dense ? 1 : 2 },
        divider: {
          height: StyleSheet.hairlineWidth,
          backgroundColor: colors.border,
          marginLeft: dividerInset,
        },
      }),
    [colors, dense, destructive]
  );

  const iconColor = destructive ? colors.danger : colors.primary;
  const chevronColor = destructive ? colors.danger : colors.textMuted;

  return (
    <View>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={title}
        android_ripple={{
          color: destructive ? `${colors.danger}33` : `${colors.primary}18`,
          borderless: false,
        }}
        style={({ pressed }) => [
          styles.press,
          pressed && Platform.OS === 'ios'
            ? { backgroundColor: destructive ? `${colors.danger}18` : colors.primarySurface }
            : null,
        ]}
      >
        <View style={styles.iconBg}>
          <Ionicons name={icon} size={iconGlyph} color={iconColor} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
        </View>
        {rightBadge ? (
          <View style={{ backgroundColor: '#E53935', borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, marginRight: 6 }}>
            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{rightBadge > 99 ? '99+' : rightBadge}</Text>
          </View>
        ) : null}
        <Ionicons name="chevron-forward" size={chevronSz} color={chevronColor} />
      </Pressable>
      {showDivider ? <View style={styles.divider} /> : null}
    </View>
  );
}
