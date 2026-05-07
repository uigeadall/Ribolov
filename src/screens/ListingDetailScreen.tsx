import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, Linking, ScrollView } from 'react-native';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { getListing, deactivateListing, CATEGORY_LABELS, CONDITION_LABELS, type GearListing } from '../services/marketplace';
import type { ProfileStackParamList } from '../navigation/types';

type R = RouteProp<ProfileStackParamList, 'ListingDetail'>;

export default function ListingDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<R>();
  const { listingId } = route.params;
  const { colors } = useTheme();
  const { user } = useAuth();
  const [listing, setListing] = useState<GearListing | null>(null);

  const styles = useMemo(() => StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    title: { ...typography.h2, color: colors.text, flex: 1 },
    photo: { width: '100%', height: 280, backgroundColor: colors.surfaceAlt },
    price: { ...typography.h1, color: colors.primary, marginBottom: spacing.xs },
    name: { ...typography.h3, color: colors.text, marginBottom: spacing.sm },
    chipRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
    chip: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.primarySurface, borderWidth: 1, borderColor: colors.border },
    chipText: { ...typography.small, color: colors.primary, fontWeight: '600' },
    desc: { ...typography.body, color: colors.text, lineHeight: 22 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
    metaText: { ...typography.caption, color: colors.textMuted },
  }), [colors]);

  useFocusEffect(useCallback(() => {
    getListing(listingId).then(setListing);
  }, [listingId]));

  if (!listing) return <Screen><Text style={{ color: colors.textMuted }}>Зареждане…</Text></Screen>;

  const isMine = user?.uid === listing.sellerUid;

  const contact = async () => {
    const c = listing.contact.trim();
    if (c.includes('@')) {
      Linking.openURL(`mailto:${c}?subject=Обява: ${listing.title}`);
    } else {
      Linking.openURL(`tel:${c.replace(/\s+/g, '')}`);
    }
  };

  const deactivate = () => {
    Alert.alert('Архивирай обявата', 'Обявата ще изчезне от Марзет.', [
      { text: 'Отказ', style: 'cancel' },
      { text: 'Архивирай', style: 'destructive', onPress: async () => { await deactivateListing(listingId); navigation.goBack(); } },
    ]);
  };

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="chevron-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{listing.title}</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        {listing.photoUrl ? (
          <Image source={{ uri: listing.photoUrl }} style={styles.photo} contentFit="cover" />
        ) : (
          <View style={[styles.photo, { alignItems: 'center', justifyContent: 'center' }]}>
            <Ionicons name="bag-outline" size={56} color={colors.border} />
          </View>
        )}
        <View style={{ padding: spacing.lg }}>
          <Text style={styles.price}>{listing.priceBGN} лв.</Text>
          <Text style={styles.name}>{listing.title}</Text>
          <View style={styles.chipRow}>
            <View style={styles.chip}><Text style={styles.chipText}>{CATEGORY_LABELS[listing.category]}</Text></View>
            <View style={styles.chip}><Text style={styles.chipText}>{CONDITION_LABELS[listing.condition]}</Text></View>
          </View>
          {listing.description ? <Text style={styles.desc}>{listing.description}</Text> : null}

          <Card style={{ marginTop: spacing.lg }}>
            <Text style={{ ...typography.bodyBold, color: colors.text }}>{listing.sellerName}</Text>
            <View style={styles.metaRow}>
              <Ionicons name="location-outline" size={14} color={colors.textMuted} />
              <Text style={styles.metaText}>{listing.locationName}</Text>
            </View>
            <View style={styles.metaRow}>
              <Ionicons name="call-outline" size={14} color={colors.textMuted} />
              <Text style={styles.metaText}>{listing.contact}</Text>
            </View>
          </Card>

          {!isMine ? (
            <Button title={`Свържи се с ${listing.sellerName}`} onPress={contact} style={{ marginTop: spacing.lg }} />
          ) : (
            <Button title="Архивирай обявата" variant="danger" onPress={deactivate} style={{ marginTop: spacing.lg }} />
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
