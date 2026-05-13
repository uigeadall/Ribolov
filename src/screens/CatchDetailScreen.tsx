import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Alert, ScrollView,
  TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { doc, getDoc } from 'firebase/firestore';
import { Image } from 'expo-image';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { ImageViewer } from '../components/ImageViewer';
import { useTheme } from '../services/themeContext';
import { spacing, typography } from '../theme/typography';
import { catchesStore } from '../storage/storage';
import { requireFirebase } from '../services/firebase';
import { useAuth } from '../services/authContext';
import type { Catch } from '../types';
import type { LogbookStackParamList } from '../navigation/types';
import { formatCatchDate } from '../utils/formatCatchDate';
import { useAppNavigation } from '../navigation/useAppNavigation';
import { useFeedPostSocial } from '../hooks/useFeedPostSocial';
import { REACTIONS } from '../services/socialFeed';
import type { FeedItem } from '../services/catchSync';

type R = RouteProp<LogbookStackParamList, 'CatchDetail'>;

export default function CatchDetailScreen() {
  const route = useRoute<R>();
  const navigation = useAppNavigation();
  const { colors } = useTheme();
  const { user, configured } = useAuth();
  const [item, setItem] = useState<Catch | null>(null);
  const [isOwn, setIsOwn] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [photoAspectRatio, setPhotoAspectRatio] = useState<number | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerUri, setViewerUri] = useState<string>('');
  const cardRef = useRef<ViewShot>(null);

  const reload = useCallback(async () => {
    const id = route.params.id;
    const list = await catchesStore.list();
    const local = list.find((c) => c.id === id);
    if (local) {
      setItem(local);
      setIsOwn(true);
      return;
    }
    try {
      const fb = requireFirebase();
      const snap = await getDoc(doc(fb.db, 'publicCatches', id));
      if (snap.exists()) {
        const data = snap.data() as Catch & { ownerUid?: string };
        setItem(data);
        setIsOwn(!!user?.uid && data.ownerUid === user.uid);
      } else {
        setItem(null);
      }
    } catch {
      setItem(null);
    }
  }, [route.params.id, user?.uid]);

  useFocusEffect(useCallback(() => { void reload(); }, [reload]));

  const styles = useMemo(() => StyleSheet.create({
    title: { ...typography.h2, color: colors.text },
    meta: { ...typography.body, color: colors.textMuted, marginTop: spacing.sm },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
    chip: {
      alignSelf: 'flex-start',
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: 4,
      borderRadius: 8,
      backgroundColor: colors.primarySurface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    chipText: { ...typography.small, fontWeight: '600', color: colors.primary },
    photoTitle: { ...typography.bodyBold, color: colors.text, marginTop: spacing.md, fontSize: 17, lineHeight: 24 },
    notes: { ...typography.body, color: colors.text, marginTop: spacing.md, lineHeight: 22 },
    photo: { width: '100%', borderRadius: 12, marginTop: spacing.md, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
    extraPhoto: { width: 200, height: 150, borderRadius: 10, marginTop: spacing.md, marginRight: spacing.sm, backgroundColor: colors.surfaceAlt },
    watermark: { ...typography.caption, color: colors.textMuted, marginTop: spacing.md, textAlign: 'right' },
    actions: { marginTop: spacing.lg, gap: spacing.sm },
    // social
    socialRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginTop: spacing.md, paddingVertical: spacing.sm },
    socialBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    socialLbl: { ...typography.caption, color: colors.textMuted },
    reactionBar: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
    commentRow: { marginBottom: spacing.sm },
    commentAuthor: { ...typography.caption, fontWeight: '700', color: colors.text },
    commentText: { ...typography.body, color: colors.text, marginTop: 2 },
    composer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
    input: {
      flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 20,
      paddingHorizontal: spacing.md, paddingVertical: 8,
      ...typography.body, color: colors.text, backgroundColor: colors.surfaceAlt,
    },
  }), [colors]);

  const feedItem = useMemo<FeedItem | null>(() => {
    if (!item) return null;
    const asCloud = item as FeedItem;
    if (!asCloud.ownerUid && !user?.uid) return null;
    return { ...item, ownerUid: asCloud.ownerUid ?? user!.uid, ownerName: asCloud.ownerName ?? user?.displayName ?? 'Рибар' };
  }, [item, user]);

  const isPublic = !!(feedItem && (feedItem as { isPublic?: boolean }).isPublic);
  const socialEnabled = isPublic && !!configured;

  const social = useFeedPostSocial({
    item: feedItem ?? { id: '', ownerUid: '', speciesName: '' } as FeedItem,
    myUid: user?.uid,
    myDisplayName: user?.displayName ?? user?.email ?? 'Рибар',
    ownerName: feedItem?.ownerName ?? 'Рибар',
    socialEnabled,
    isVisible: true,
  });

  const safeGoBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('LogbookList');
  };

  if (!item) {
    return (
      <Screen>
        <Text style={{ ...typography.body, color: colors.textMuted }}>Уловът не е намерен.</Text>
        <Button title="Назад" variant="secondary" onPress={safeGoBack} style={{ marginTop: spacing.lg }} />
      </Screen>
    );
  }

  const shareCard = async () => {
    if (!cardRef.current) return;
    setSharing(true);
    try {
      const uri = await (cardRef.current as any).capture();
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png' });
      }
    } catch {
      Alert.alert('Грешка', 'Споделянето не успя.');
    } finally {
      setSharing(false);
    }
  };

  const remove = () => {
    Alert.alert('Изтриване', 'Да се изтрие записът?', [
      { text: 'Отказ', style: 'cancel' },
      { text: 'Изтрий', style: 'destructive', onPress: async () => { await catchesStore.remove(item.id); safeGoBack(); } },
    ]);
  };

  const metaLine = [
    formatCatchDate(item.date),
    item.weightKg != null ? `${item.weightKg} кг` : null,
    item.lengthCm != null ? `${item.lengthCm} см` : null,
    item.released ? 'пуснат' : null,
  ].filter(Boolean).join(' · ');

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen padded={false}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled">

          <ViewShot ref={cardRef} options={{ format: 'png', quality: 0.95 }}>
            <View style={{ backgroundColor: colors.background }}>
              <Text style={styles.title}>{item.speciesName}</Text>
              <Text style={styles.meta}>{metaLine}</Text>
              {item.location?.name ? <Text style={styles.meta}>{item.location.name}</Text> : null}
              {item.bait ? <Text style={styles.meta}>Стръв: {item.bait}</Text> : null}

              <View style={styles.chipRow}>
                {item.syncedToCloud ? <View style={styles.chip}><Text style={styles.chipText}>Синхронизиран</Text></View> : null}
                {item.conditions?.fishingRating != null ? <View style={styles.chip}><Text style={styles.chipText}>{'⭐'.repeat(item.conditions.fishingRating)} риболов</Text></View> : null}
                {item.conditions?.temperatureC != null ? <View style={styles.chip}><Text style={styles.chipText}>{item.conditions.temperatureC}°C</Text></View> : null}
                {item.conditions?.windKmh != null ? <View style={styles.chip}><Text style={styles.chipText}>💨 {item.conditions.windKmh} км/ч</Text></View> : null}
                {item.conditions?.pressureHpa != null ? <View style={styles.chip}><Text style={styles.chipText}>⏱ {item.conditions.pressureHpa} hPa</Text></View> : null}
                {item.conditions?.moonPhaseName ? <View style={styles.chip}><Text style={styles.chipText}>{item.conditions.moonPhaseName}</Text></View> : null}
              </View>

              {item.photoUri ? (
                <Pressable onPress={() => { setViewerUri(item.photoUri!); setViewerOpen(true); }}>
                  <View style={[styles.photo, { aspectRatio: photoAspectRatio ?? 4 / 3 }]}>
                    <Image
                      source={{ uri: item.photoUri }}
                      style={StyleSheet.absoluteFillObject}
                      contentFit="contain"
                      cachePolicy="memory-disk"
                      onLoad={(e) => {
                        const { width, height } = e.source;
                        if (width && height) setPhotoAspectRatio(width / height);
                      }}
                    />
                  </View>
                </Pressable>
              ) : null}

              {item.photoTitle ? <Text style={styles.photoTitle}>{item.photoTitle}</Text> : null}
              <Text style={styles.watermark}>🎣 Риболов</Text>
            </View>
          </ViewShot>

          {(item.extraPhotoUris?.length ?? 0) > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {item.extraPhotoUris!.map((uri, i) => (
                <Pressable key={i} onPress={() => { setViewerUri(uri); setViewerOpen(true); }}>
                  <Image source={{ uri }} style={styles.extraPhoto} contentFit="cover" />
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          {item.notes ? <Text style={styles.notes}>{item.notes}</Text> : null}

          {/* ── Social section (likes + comments) — only for public catches ── */}
          {socialEnabled && (
            <View style={{ marginTop: spacing.md }}>

              {/* Reaction picker modal */}
              <Modal visible={social.reactionPickerOpen} transparent animationType="fade" onRequestClose={() => social.setReactionPickerOpen(false)}>
                <Pressable style={{ flex: 1 }} onPress={() => social.setReactionPickerOpen(false)}>
                  <View style={{
                    position: 'absolute', bottom: 120, left: spacing.lg, right: spacing.lg,
                    backgroundColor: colors.card, borderRadius: 50, borderWidth: 1,
                    borderColor: colors.border, flexDirection: 'row', justifyContent: 'space-around',
                    padding: spacing.sm, shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.2, shadowRadius: 12, elevation: 8,
                  }}>
                    {(Object.entries(REACTIONS) as [import('../services/socialFeed').ReactionType, { emoji: string; label: string }][]).map(([type, r]) => (
                      <Pressable
                        key={type}
                        onPress={() => social.onPickReaction(type)}
                        style={{ alignItems: 'center', padding: spacing.sm, borderRadius: 12, backgroundColor: social.myReaction === type ? colors.primarySurface : 'transparent' }}
                      >
                        <Text style={{ fontSize: 28 }}>{r.emoji}</Text>
                        <Text style={{ ...typography.caption, color: colors.textMuted, marginTop: 2, fontSize: 10 }}>{r.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                </Pressable>
              </Modal>

              {/* Reaction summary */}
              {social.reactionSummary.length > 0 && (
                <View style={styles.reactionBar}>
                  {social.reactionSummary.map((r) => (
                    <Text key={r.type} style={{ ...typography.body, color: colors.text }}>
                      {r.emoji} {r.count}
                    </Text>
                  ))}
                </View>
              )}

              {/* Action row */}
              <View style={styles.socialRow}>
                <Pressable
                  onPress={() => social.myReaction ? social.onPickReaction(social.myReaction) : social.setReactionPickerOpen(true)}
                  onLongPress={() => social.setReactionPickerOpen(true)}
                  delayLongPress={300}
                  disabled={social.likeBusy}
                  style={[styles.socialBtn, social.likeBusy && { opacity: 0.5 }]}
                  hitSlop={8}
                >
                  <Text style={{ fontSize: 22 }}>{social.myReaction ? REACTIONS[social.myReaction].emoji : '🤍'}</Text>
                  {social.likeCount > 0 && (
                    <Text style={[styles.socialLbl, social.myReaction && { color: colors.primary }]}>
                      {social.likeCount}
                    </Text>
                  )}
                </Pressable>

                <View style={styles.socialBtn}>
                  <Ionicons name="chatbubble-outline" size={20} color={colors.textMuted} />
                  {social.allComments.length > 0 && (
                    <Text style={styles.socialLbl}>{social.allComments.length}</Text>
                  )}
                </View>
              </View>

              {/* Comments */}
              {social.allComments.map((c) => (
                <View key={c.id} style={[styles.commentRow, c.replyToId && { marginLeft: spacing.xl }]}>
                  {c.replyToId ? (
                    <Text style={{ ...typography.caption, color: colors.textMuted, marginBottom: 2 }}>↩ {c.replyToName}</Text>
                  ) : null}
                  <Text style={styles.commentAuthor}>{c.authorName}</Text>
                  <Text style={styles.commentText}>{c.text}</Text>
                </View>
              ))}

              {/* Reply indicator */}
              {social.replyingTo && (
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primarySurface, borderRadius: 8, paddingHorizontal: spacing.sm, paddingVertical: 4, marginBottom: spacing.xs, gap: spacing.sm }}>
                  <Text style={{ ...typography.caption, color: colors.primary, flex: 1 }}>↩ Отговор на {social.replyingTo.name}</Text>
                  <Pressable onPress={() => social.setReplyingTo(null)} hitSlop={8}>
                    <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                  </Pressable>
                </View>
              )}

              {/* Composer */}
              <View style={styles.composer}>
                <TextInput
                  style={styles.input}
                  placeholder="Коментар…"
                  placeholderTextColor={colors.textMuted}
                  value={social.draft}
                  onChangeText={social.setDraft}
                  maxLength={2000}
                  editable={!social.sendBusy}
                />
                <Pressable onPress={social.onSendComment} disabled={social.sendBusy || !social.draft.trim()} hitSlop={8}>
                  {social.sendBusy
                    ? <ActivityIndicator size="small" color={colors.primary} />
                    : <Ionicons name="send" size={22} color={social.draft.trim() ? colors.primary : colors.textMuted} />}
                </Pressable>
              </View>
            </View>
          )}

          <Card style={styles.actions}>
            <Button title="Сподели като снимка" variant="secondary" onPress={shareCard} loading={sharing} />
            {isOwn && (
              <>
                <Button title="Добави подобен" variant="secondary" onPress={() => navigation.navigate('AddCatch', { duplicateCatchId: item.id })} />
                <Button title="Редактирай" variant="secondary" onPress={() => navigation.navigate('AddCatch', { editCatchId: item.id })} />
                <Button title="Изтрий записа" variant="danger" onPress={remove} />
              </>
            )}
          </Card>
        </ScrollView>
        <ImageViewer uri={viewerUri} visible={viewerOpen} onClose={() => setViewerOpen(false)} />
      </Screen>
    </KeyboardAvoidingView>
  );
}
