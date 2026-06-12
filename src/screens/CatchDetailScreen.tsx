import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import {
  View, Text, StyleSheet, Alert, ScrollView,
  TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { doc, getDoc } from 'firebase/firestore';
import { Image } from 'expo-image';
import ViewShot from 'react-native-view-shot';
import { BrandedCatchPoster } from '../components/BrandedCatchPoster';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import Toast from 'react-native-toast-message';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { ImageViewer } from '../components/ImageViewer';
import { Skeleton } from '../components/Skeleton';
import { CatchConditionsCard } from '../components/CatchConditionsCard';
import { CatchLocationCard } from '../components/CatchLocationCard';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { catchesStore } from '../storage/storage';
import { requireFirebase } from '../services/firebase';
import { deleteCatchEverywhere } from '../services/cloudSync';
import { useAuth } from '../services/authContext';
import type { Catch } from '../types';
import type { LogbookStackParamList } from '../navigation/types';
import { formatCatchDate } from '../utils/formatCatchDate';
import { useAppNavigation } from '../navigation/useAppNavigation';
import { useFeedPostSocial } from '../hooks/useFeedPostSocial';
import { REACTIONS } from '../services/socialFeed';
import type { FeedItem } from '../services/catchSync';

type R = RouteProp<LogbookStackParamList, 'CatchDetail'>;

// Harmonized with the Navy & Chartreuse palette (kept in sync with LogbookScreen).
const CATCH_ACCENTS = ['#16729B', '#1E8E5A', '#115B7D', '#4FA8CE', '#0E2235', '#C77F12'];
function speciesAccent(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return CATCH_ACCENTS[Math.abs(h) % CATCH_ACCENTS.length];
}

function CatchDetailSkeleton() {
  return (
    <>
      <Skeleton height={300} borderRadius={0} />
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <Skeleton height={26} width="58%" />
        <Skeleton height={16} width="78%" />
        <Skeleton height={14} width="46%" />
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          <Skeleton height={28} width={88} />
          <Skeleton height={28} width={72} />
          <Skeleton height={28} width={80} />
        </View>
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          <Skeleton height={16} width="90%" />
          <Skeleton height={16} width="70%" />
        </View>
      </View>
    </>
  );
}

export default function CatchDetailScreen() {
  const route = useRoute<R>();
  const navigation = useAppNavigation();
  const { colors } = useTheme();
  const { user, configured } = useAuth();
  const [item, setItem] = useState<Catch | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOwn, setIsOwn] = useState(false);
  const [isPublicFromCloud, setIsPublicFromCloud] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [photoAspectRatio, setPhotoAspectRatio] = useState<number | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  // Index into the combined [main, ...extras] list so the viewer opens on the
  // photo the user actually tapped and they can swipe to the rest. Previously
  // the viewer was single-image only, which meant tapping extra photo #3
  // required dismissing the viewer and tapping #4 separately.
  const [viewerIndex, setViewerIndex] = useState(0);
  const [currentExtraPhoto, setCurrentExtraPhoto] = useState(0);
  const cardRef = useRef<ViewShot>(null);
  const posterRef = useRef<ViewShot>(null);
  const [posterSharing, setPosterSharing] = useState(false);

  // `silent` flag lets focus-triggered refreshes skip the skeleton so the
  // user doesn't see a flash when returning from the edit screen.
  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const id = route.params.id;
      const list = await catchesStore.list();
      const local = list.find((c) => c.id === id);
      if (local) {
        setItem(local);
        setIsOwn(true);
        // For own catches, the local doc never carries `isPublic` — probe Firestore
        // for the public copy so the social section shows up correctly.
        try {
          const fb = requireFirebase();
          const snap = await getDoc(doc(fb.db, 'publicCatches', id));
          setIsPublicFromCloud(snap.exists());
        } catch {
          setIsPublicFromCloud(false);
        }
        return;
      }
      try {
        const fb = requireFirebase();
        const snap = await getDoc(doc(fb.db, 'publicCatches', id));
        if (snap.exists()) {
          const data = snap.data() as Catch & { ownerUid?: string };
          setItem(data);
          setIsOwn(!!user?.uid && data.ownerUid === user.uid);
          setIsPublicFromCloud(true);
        } else {
          setItem(null);
          setIsPublicFromCloud(false);
        }
      } catch {
        setItem(null);
        setIsPublicFromCloud(false);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [route.params.id, user?.uid]);

  // Skip the skeleton on focus once we already have data — otherwise every
  // return from the edit/share/comments flow flashes the loading state.
  const initialFocusRef = useRef(true);
  useFocusEffect(useCallback(() => {
    const silent = !initialFocusRef.current;
    initialFocusRef.current = false;
    void reload(silent);
  }, [reload]));

  const styles = useMemo(() => StyleSheet.create({
    title: { ...typography.h2, color: colors.text },
    meta: { ...typography.body, color: colors.textMuted, marginTop: spacing.sm },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
    chip: {
      alignSelf: 'flex-start',
      paddingHorizontal: spacing.sm + 4,
      paddingVertical: 4,
      borderRadius: radius.pill,
      backgroundColor: colors.primarySurface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    chipText: { ...typography.small, fontFamily: 'Manrope_700Bold', color: colors.primary },
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

  // For local catches, `isPublic` is never on the local doc — rely on the Firestore probe.
  // For cloud-loaded catches, `isPublic` comes from the publicCatches doc itself.
  const isPublic = isPublicFromCloud || !!(feedItem && (feedItem as { isPublic?: boolean }).isPublic);
  const socialEnabled = isPublic && !!configured;

  const social = useFeedPostSocial({
    item: feedItem ?? { id: '', ownerUid: '', speciesName: '' } as FeedItem,
    myUid: user?.uid,
    myDisplayName: user?.displayName ?? 'Рибар',
    ownerName: feedItem?.ownerName ?? 'Рибар',
    socialEnabled,
    isVisible: true,
  });

  // Comment composer focus support — used by the notifications screen so
  // tapping a "X коментира" notif lands directly in the reply composer with
  // @X already typed. We use a ref to focus the TextInput once the social
  // hook is ready and the route param tells us who to reply to.
  const composerRef = useRef<TextInput | null>(null);
  const focusComment = route.params?.focusComment;
  useEffect(() => {
    if (!focusComment || !socialEnabled) return;
    const sanitized = focusComment.authorName.replace(/\s+/g, '_');
    social.setDraft(`@${sanitized} `);
    // Wait a frame so the input is mounted before we try to focus.
    const t = setTimeout(() => composerRef.current?.focus(), 250);
    return () => clearTimeout(t);
    // We intentionally only react to the param + readiness — re-running on
    // every social object change would clobber user edits to the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusComment?.authorName, socialEnabled]);

  const safeGoBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else (navigation as any).navigate('LogbookTab', { screen: 'LogbookList' });
  };

  const goToAddCatch = (params: { editCatchId?: string; duplicateCatchId?: string }) => {
    // AddCatch only lives in LogbookStack, so always navigate through the tab navigator
    (navigation as any).navigate('LogbookTab', { screen: 'AddCatch', params });
  };

  if (loading) {
    return (
      <Screen padded={false}>
        <CatchDetailSkeleton />
      </Screen>
    );
  }

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
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        await Sharing.shareAsync(uri, { mimeType: 'image/png' });
      }
    } catch {
      // Share failure is transient (user cancelled, system sheet glitched,
      // disk full). A modal Alert overstates the severity and forces the
      // user to dismiss before retrying. Toast disappears on its own.
      Toast.show({ type: 'error', text1: 'Споделянето не успя', visibilityTime: 2400 });
    } finally {
      setSharing(false);
    }
  };

  /**
   * "Share as Story" — captures the off-screen BrandedCatchPoster at
   * Instagram-Story aspect ratio (9:16) with bold typography over the
   * full-bleed catch photo plus a Ribolov watermark + ribolov.app footer.
   * This is the "outbound virality" path: users post their poster to
   * Stories, friends see the watermark, tap through to install.
   */
  const sharePoster = async () => {
    if (!posterRef.current) return;
    setPosterSharing(true);
    try {
      const uri = await (posterRef.current as any).capture();
      if (await Sharing.isAvailableAsync()) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Сподели улова' });
      }
    } catch {
      Toast.show({ type: 'error', text1: 'Споделянето не успя', visibilityTime: 2400 });
    } finally {
      setPosterSharing(false);
    }
  };

  const remove = () => {
    Alert.alert('Изтриване', 'Да се изтрие записът?', [
      { text: 'Отказ', style: 'cancel' },
      {
        text: 'Изтрий',
        style: 'destructive',
        onPress: async () => {
          await catchesStore.remove(item.id);
          // Also delete from Firestore + Storage so it doesn't stay in the public feed
          // or come back on next sync. Best-effort; the local delete already happened.
          if (user?.uid) void deleteCatchEverywhere(item.id, user.uid);
          safeGoBack();
        },
      },
    ]);
  };

  const metaLine = [
    formatCatchDate(item.date),
    item.weightKg != null ? `${item.weightKg} кг` : null,
    item.lengthCm != null ? `${item.lengthCm} см` : null,
    item.released ? 'пуснат' : null,
  ].filter(Boolean).join(' · ');

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Screen padded={false}>
        <ScrollView keyboardShouldPersistTaps="handled">

          {/* ── Full-bleed photo header ── */}
          {item.photoUri ? (
            <View style={{ position: 'relative' }}>
              <Pressable onPress={() => { setViewerIndex(0); setViewerOpen(true); }}>
                <Image
                  source={{ uri: item.photoUri }}
                  style={{ width: '100%', aspectRatio: photoAspectRatio ?? 4 / 3 }}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  onLoad={(e) => {
                    const { width, height } = e.source;
                    if (width && height) setPhotoAspectRatio(width / height);
                  }}
                />
                <LinearGradient
                  colors={['transparent', 'rgba(0,0,0,0.75)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: spacing.lg, paddingTop: spacing.xl }}
                >
                  <Text style={{ ...typography.h2, color: '#fff' }} numberOfLines={1}>{item.speciesName}</Text>
                  <Text style={{ ...typography.body, color: 'rgba(255,255,255,0.82)', marginTop: 2 }} numberOfLines={1}>{metaLine}</Text>
                </LinearGradient>
              </Pressable>
              {/* Floating back button — glass circle */}
              <View style={{
                position: 'absolute', top: spacing.lg, left: spacing.md,
                width: 36, height: 36, borderRadius: 18, overflow: 'hidden',
              }}>
                <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFillObject} />
                <LinearGradient
                  colors={['rgba(255,255,255,0.14)', 'rgba(255,255,255,0.04)']}
                  start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
                  style={StyleSheet.absoluteFillObject}
                />
                <Pressable
                  onPress={safeGoBack}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Назад"
                  style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Ionicons name="chevron-back" size={22} color="#fff" />
                </Pressable>
              </View>
            </View>
          ) : (
            <LinearGradient
              colors={[speciesAccent(item.speciesName), speciesAccent(item.speciesName) + '99']}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.lg }}
            >
              <Pressable onPress={safeGoBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Назад">
                <Ionicons name="chevron-back" size={28} color="#fff" />
              </Pressable>
              <Text style={{ ...typography.h2, color: '#fff', flex: 1 }} numberOfLines={1}>{item.speciesName}</Text>
            </LinearGradient>
          )}

          <View style={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
          {/* The ViewShot wrapper is captured for the "share as image" action.
              It keeps the photo title + a single condensed meta line + a small
              chip row + the watermark so the shared image stays compact. The
              richer conditions/location cards below sit OUTSIDE the ViewShot
              so they polish the in-app view without bloating the share image. */}
          <ViewShot ref={cardRef} options={{ format: 'png', quality: 0.95 }}>
            <View style={{ backgroundColor: colors.background }}>
              {!item.photoUri ? <Text style={styles.meta}>{metaLine}</Text> : null}
              {item.bait ? <Text style={styles.meta}>Стръв: {item.bait}</Text> : null}

              {/* Condensed chip row kept only for share-image purposes. */}
              <View style={styles.chipRow}>
                {item.conditions?.fishingRating != null ? <View style={styles.chip}><Text style={styles.chipText}>{item.conditions.fishingRating}/5 риболов</Text></View> : null}
                {item.conditions?.temperatureC != null ? <View style={styles.chip}><Text style={styles.chipText}>{item.conditions.temperatureC}°C</Text></View> : null}
                {item.conditions?.moonPhaseName ? <View style={styles.chip}><Text style={styles.chipText}>{item.conditions.moonPhaseName}</Text></View> : null}
                {item.weightKg != null ? <View style={styles.chip}><Text style={styles.chipText}>{item.weightKg} кг</Text></View> : null}
                {item.released ? <View style={styles.chip}><Text style={[styles.chipText, { color: colors.success }]}>C&R</Text></View> : null}
              </View>

              {item.photoTitle ? <Text style={styles.photoTitle}>{item.photoTitle}</Text> : null}
              <Text style={styles.watermark}>Риболов</Text>
            </View>
          </ViewShot>

          {/* Rich cards — outside ViewShot so they don't bloat the share image. */}
          {item.conditions ? <CatchConditionsCard conditions={item.conditions} /> : null}
          {item.location ? <CatchLocationCard location={item.location} /> : null}

          {(item.extraPhotoUris?.length ?? 0) > 0 ? (
            <>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                scrollEventThrottle={160}
                onScroll={(e) => {
                  const x = e.nativeEvent.contentOffset.x;
                  setCurrentExtraPhoto(Math.round(x / 208));
                }}
              >
                {item.extraPhotoUris!.map((uri, i) => (
                  // +1 because index 0 in the combined list is the main photo;
                  // extras occupy indices 1..N. Without the offset, tapping
                  // "extra #0" would open the main photo and confuse users.
                  <Pressable key={i} onPress={() => { setViewerIndex(i + (item.photoUri ? 1 : 0)); setViewerOpen(true); }}>
                    <Image source={{ uri }} style={styles.extraPhoto} contentFit="cover" />
                  </Pressable>
                ))}
              </ScrollView>
              {item.extraPhotoUris!.length > 1 && (
                <View style={{
                  flexDirection: 'row',
                  alignSelf: 'center',
                  gap: 6,
                  marginTop: spacing.sm,
                }}>
                  {item.extraPhotoUris!.map((_, idx) => {
                    const active = idx === currentExtraPhoto;
                    return (
                      <View
                        key={idx}
                        style={{
                          width: active ? 16 : 6,
                          height: 6,
                          borderRadius: 3,
                          backgroundColor: active ? colors.primary : colors.border,
                        }}
                      />
                    );
                  })}
                </View>
              )}
            </>
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
                  ref={composerRef}
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
            <Button title="Сподели като Story" onPress={sharePoster} loading={posterSharing} />
            <Button title="Сподели като снимка" variant="secondary" onPress={shareCard} loading={sharing} />
            {isOwn && (
              <>
                <Button title="Добави подобен" variant="secondary" onPress={() => goToAddCatch({ duplicateCatchId: item.id })} />
                <Button title="Редактирай" variant="secondary" onPress={() => goToAddCatch({ editCatchId: item.id })} />
                <Button title="Изтрий записа" variant="danger" onPress={remove} />
              </>
            )}
          </Card>
          </View>
        </ScrollView>
        <ImageViewer
          uris={[item.photoUri, ...(item.extraPhotoUris ?? [])].filter((u): u is string => !!u)}
          initialIndex={viewerIndex}
          visible={viewerOpen}
          onClose={() => setViewerOpen(false)}
        />
        {/* Off-screen story poster. Renders at full 1080x1920 size so the
            ViewShot capture produces a print-quality image, then sits at
            -9999 px so it's never visible to the user. The capture itself
            doesn't care about visibility — it renders to a temp PNG file. */}
        <View pointerEvents="none" style={{ position: 'absolute', left: -9999, top: -9999 }}>
          <BrandedCatchPoster
            ref={posterRef}
            catchItem={item}
            ownerName={feedItem?.ownerName ?? user?.displayName ?? undefined}
            format="story"
          />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}
