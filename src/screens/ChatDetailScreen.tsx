import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Alert,
  ActivityIndicator,
  Animated,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { useAppNavigation } from '../navigation/useAppNavigation';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { uploadAsync, FileSystemUploadType } from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Screen } from '../components/Screen';
import { ImageViewer } from '../components/ImageViewer';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import type { ProfileStackParamList } from '../navigation/types';
import type { DirectMessage } from '../types';
import { useAuth } from '../services/authContext';
import { useAvatarUrl } from '../hooks/useAvatarUrl';
import { sendConversationMessage, subscribeConversationMessages, markConversationRead, subscribeUserPresence } from '../services/cloudSync';
import { setTypingStatus, subscribeTyping } from '../services/messaging';
import { enqueueMessage } from '../services/messageSyncQueue';
import { ensureFirebase } from '../services/firebase';
import { handleError } from '../utils/handleError';

type R = RouteProp<ProfileStackParamList, 'ChatDetail'>;

function formatMsgTime(createdAt: unknown): string {
  if (!createdAt) return '';
  let d: Date | null = null;
  if (typeof createdAt === 'number') {
    d = new Date(createdAt);
  } else {
    const ts = createdAt as { toDate?: () => Date; seconds?: number };
    d = ts.toDate ? ts.toDate() : ts.seconds ? new Date(ts.seconds * 1000) : null;
  }
  if (!d) return '';
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const timeStr = d.toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return timeStr;
  if (isYesterday) return `Вчера ${timeStr}`;
  return `${d.toLocaleDateString('bg-BG', { day: 'numeric', month: 'short' })} ${timeStr}`;
}

type ChatItem = DirectMessage | { _sep: true; label: string; id: string };

function msgDateKey(createdAt: unknown): string {
  if (!createdAt) return '';
  let d: Date | null = null;
  if (typeof createdAt === 'number') d = new Date(createdAt);
  else { const t = createdAt as { toDate?: () => Date; seconds?: number }; d = t.toDate ? t.toDate() : t.seconds ? new Date(t.seconds * 1000) : null; }
  return d ? d.toDateString() : '';
}

function msgDayLabel(createdAt: unknown): string {
  if (!createdAt) return '';
  let d: Date | null = null;
  if (typeof createdAt === 'number') d = new Date(createdAt);
  else { const t = createdAt as { toDate?: () => Date; seconds?: number }; d = t.toDate ? t.toDate() : t.seconds ? new Date(t.seconds * 1000) : null; }
  if (!d) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Днес';
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Вчера';
  return d.toLocaleDateString('bg-BG', { day: 'numeric', month: 'long' });
}

function TypingDot({ delay, color }: { delay: number; color: string }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: -4, duration: 300, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.delay(600),
      ])
    ).start();
  }, [anim, delay]);
  return <Animated.View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, transform: [{ translateY: anim }] }} />;
}

export default function ChatDetailScreen() {
  const route = useRoute<R>();
  const navigation = useAppNavigation();
  const { colors, mode } = useTheme();
  const { user, configured } = useAuth();
  const { convId, otherName, otherUid } = route.params;
  const [msgs, setMsgs] = useState<DirectMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [otherPresence, setOtherPresence] = useState<{ online: boolean; lastSeen?: number }>({ online: false });
  const [typingUid, setTypingUid] = useState<string | null>(null);
  const [viewerUri, setViewerUri] = useState('');
  const [viewerVisible, setViewerVisible] = useState(false);
  const flatRef = useRef<FlatList<ChatItem>>(null);
  const isAtBottomRef = useRef(true);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingStartedRef = useRef(false);
  const insets = useSafeAreaInsets();

  // Hide the floating tab bar so it doesn't cover the input
  useFocusEffect(
    useCallback(() => {
      const parent = navigation.getParent();
      parent?.setOptions({ tabBarStyle: { display: 'none' } });
      return () => parent?.setOptions({ tabBarStyle: undefined });
    }, [navigation])
  );

  const heroColors: [string, string, string] = mode === 'dark'
    ? ['#0A1E38', '#050C1A', '#030810']
    : ['#2B87CE', '#1570B8', '#0D559A'];

  const otherInitials = otherName.slice(0, 1).toUpperCase();
  const avatarUrl = useAvatarUrl({
    ownerUid: otherUid,
    isMine: false,
    resolvedAvatarUrl: undefined,
    ownerPhotoUrl: undefined,
  });

  const chatItems = useMemo<ChatItem[]>(() => {
    const result: ChatItem[] = [];
    let prevKey = '';
    msgs.forEach((msg) => {
      const key = msgDateKey(msg.createdAt);
      if (key && key !== prevKey) {
        result.push({ _sep: true, label: msgDayLabel(msg.createdAt), id: `sep-${key}` });
        prevKey = key;
      }
      result.push(msg);
    });
    return result;
  }, [msgs]);

  useEffect(() => {
    if (!configured || !user) return;
    markConversationRead(convId, user.uid).catch(() => {});
    const unsubMsgs = subscribeConversationMessages(convId, (next) => {
      setMsgs(next);
      markConversationRead(convId, user.uid).catch(() => {});
    });
    const unsubPresence = subscribeUserPresence(otherUid, setOtherPresence);
    const unsubTyping = subscribeTyping(convId, user.uid, setTypingUid);
    return () => {
      unsubMsgs();
      unsubPresence();
      unsubTyping();
      void setTypingStatus(convId, user.uid, false);
    };
  }, [convId, otherUid, configured, user]);

  const clearTypingStatus = useCallback(() => {
    if (typingTimeout.current) { clearTimeout(typingTimeout.current); typingTimeout.current = null; }
    if (user && typingStartedRef.current) {
      typingStartedRef.current = false;
      void setTypingStatus(convId, user.uid, false);
    }
  }, [convId, user]);

  const send = useCallback(async () => {
    if (!user || !text.trim()) return;
    setSending(true);
    const trimmed = text.trim();
    clearTypingStatus();
    setText('');
    try {
      const myName = user.displayName ?? user.email ?? 'Рибар';
      await sendConversationMessage(convId, user.uid, trimmed, otherUid, myName);
    } catch (e) {
      const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '';
      if (code === 'unavailable' || code === 'failed-precondition') {
        const myName = user.displayName ?? user.email ?? 'Рибар';
        await enqueueMessage(convId, user.uid, trimmed, otherUid, myName).catch(() => {});
        Alert.alert('Офлайн', 'Съобщението ще бъде изпратено, когато се свържеш с интернет.');
      } else {
        setText(trimmed);
        handleError(e);
      }
    } finally {
      setSending(false);
    }
  }, [convId, text, user, otherUid, clearTypingStatus]);

  const pickAndSendMedia = useCallback(async (source: 'camera' | 'gallery') => {
    if (!user) return;
    const perm = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Няма достъп', 'Разреши достъп до камерата/галерията.');
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: 'images', quality: 0.5 };
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    setUploading(true);
    try {
      const fb = ensureFirebase();
      if (!fb) throw new Error('Firebase не е наличен.');
      const token = await fb.auth.currentUser?.getIdToken(true);
      if (!token) throw new Error('Не е влезено в акаунт.');
      const bucket = fb.auth.app.options.storageBucket;
      if (!bucket) throw new Error('Firebase Storage не е конфигуриран.');
      // Use the chatMedia bucket so only the two participants can read it
      // (publicCatchPhotos rules grant read to any signed-in user — privacy leak).
      const storagePath = `chatMedia/${convId}/${user.uid}_${Date.now()}.jpg`;
      const uploadResult = await uploadAsync(
        `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(storagePath)}`,
        asset.uri,
        {
          httpMethod: 'POST',
          uploadType: FileSystemUploadType.BINARY_CONTENT,
          headers: { 'Content-Type': 'image/jpeg', Authorization: `Bearer ${token}` },
        },
      );
      if (uploadResult.status < 200 || uploadResult.status >= 300) {
        throw new Error(`Upload failed (${uploadResult.status}): ${uploadResult.body}`);
      }
      const meta = JSON.parse(uploadResult.body) as { name: string; downloadTokens: string };
      const url = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(meta.name)}?alt=media&token=${meta.downloadTokens}`;
      const myName = user.displayName ?? user.email ?? 'Рибар';
      await sendConversationMessage(convId, user.uid, '', otherUid, myName, url, 'photo');
    } catch (e) {
      handleError(e);
    } finally {
      setUploading(false);
    }
  }, [user, convId, otherUid]);

  const styles = useMemo(() => StyleSheet.create({
    bubbleMine: {
      backgroundColor: colors.primary,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 18,
      borderBottomRightRadius: 4,
    },
    bubbleOther: {
      backgroundColor: colors.surfaceAlt,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 18,
      borderBottomLeftRadius: 4,
      borderWidth: 1,
      borderColor: colors.border,
    },
    msgMine: { ...typography.body, color: '#fff' },
    msgOther: { ...typography.body, color: colors.text },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: spacing.sm,
      paddingTop: 8,
      paddingHorizontal: spacing.md,
      backgroundColor: colors.background,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    inputWrap: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'flex-end',
      backgroundColor: colors.surfaceAlt,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: Platform.OS === 'ios' ? 8 : 4,
    },
    input: {
      flex: 1,
      fontSize: 16,
      color: colors.text,
      maxHeight: 120,
      paddingVertical: 0,
    },
    sendBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
    },
  }), [colors]);

  if (!configured || !user) {
    return (
      <Screen>
        <Text style={{ ...typography.body, color: colors.textMuted }}>Нужен е вход и Firebase за чата.</Text>
      </Screen>
    );
  }

  const hasSendText = text.trim().length > 0;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen padded={false} safeAreaEdges={['top', 'left', 'right']} avoidKeyboard={false}>

        {/* Gradient header */}
        <LinearGradient colors={heroColors} style={{ paddingBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 12, paddingBottom: 6, gap: 10 }}>
            <Pressable
              onPress={() => navigation.goBack()}
              hitSlop={8}
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name="chevron-back" size={22} color="#fff" />
            </Pressable>

            <Pressable
              onPress={() => navigation.navigate('UserPublicProfile', { uid: otherUid, displayName: otherName })}
              style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 }}
              hitSlop={6}
            >
              <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {avatarUrl ? (
                  <Image source={{ uri: avatarUrl }} style={{ width: 42, height: 42, borderRadius: 21 }} contentFit="cover" cachePolicy="memory-disk" />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 18 }}>{otherInitials}</Text>
                )}
                {otherPresence.online && (
                  <View style={{ position: 'absolute', bottom: 1, right: 1, width: 11, height: 11, borderRadius: 6, backgroundColor: '#2ECC71', borderWidth: 2, borderColor: '#fff' }} />
                )}
              </View>

              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }} numberOfLines={1}>{otherName}</Text>
                <Text style={{ fontSize: 11, color: otherPresence.online ? '#A8F0C6' : 'rgba(255,255,255,0.55)', marginTop: 1 }}>
                  {otherPresence.online
                    ? 'Онлайн'
                    : otherPresence.lastSeen
                      ? `Последно виждан ${formatMsgTime(otherPresence.lastSeen)}`
                      : ''}
                </Text>
              </View>
            </Pressable>
          </View>
        </LinearGradient>

        {/* Messages */}
        <FlatList
          ref={flatRef}
          data={chatItems}
          keyExtractor={(m) => ('_sep' in m ? m.id : m.id)}
          contentContainerStyle={{ paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md }}
          onContentSizeChange={() => { if (isAtBottomRef.current) flatRef.current?.scrollToEnd({ animated: false }); }}
          onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            isAtBottomRef.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 80;
          }}
          scrollEventThrottle={100}
          renderItem={({ item }) => {
            if ('_sep' in item) {
              return (
                <View style={{ alignItems: 'center', marginVertical: spacing.sm }}>
                  <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 3, borderWidth: 1, borderColor: colors.border }}>
                    <Text style={{ ...typography.caption, color: colors.textMuted, fontWeight: '600' }}>{item.label}</Text>
                  </View>
                </View>
              );
            }
            const mine = item.senderUid === user.uid;
            return (
              <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '80%', marginBottom: 6 }}>
                <View style={mine ? styles.bubbleMine : styles.bubbleOther}>
                  {item.mediaUrl && item.mediaType === 'photo' ? (
                    <Pressable onPress={() => { setViewerUri(item.mediaUrl!); setViewerVisible(true); }}>
                      <Image
                        source={{ uri: item.mediaUrl }}
                        style={{ width: 200, height: 150, borderRadius: 10 }}
                        contentFit="cover"
                      />
                    </Pressable>
                  ) : item.mediaUrl && item.mediaType === 'video' ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons name="videocam" size={20} color={mine ? '#fff' : colors.text} />
                      <Text style={mine ? styles.msgMine : styles.msgOther}>Видео</Text>
                    </View>
                  ) : (
                    <Text style={mine ? styles.msgMine : styles.msgOther}>{item.text}</Text>
                  )}
                  {item.createdAt ? (
                    <Text style={{ fontSize: 10, color: mine ? 'rgba(255,255,255,0.55)' : colors.textMuted, marginTop: 4, alignSelf: 'flex-end' }}>
                      {formatMsgTime(item.createdAt)}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          }}
        />

        {/* Typing indicator bubble */}
        {typingUid && (
          <View style={{ paddingHorizontal: spacing.md, paddingBottom: 6 }}>
            <View style={{ alignSelf: 'flex-start', backgroundColor: colors.surfaceAlt, borderRadius: 18, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 10 }}>
              <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
                {[0, 1, 2].map(i => <TypingDot key={i} delay={i * 180} color={colors.textMuted} />)}
              </View>
            </View>
          </View>
        )}

        {/* Input row */}
        <View style={[styles.inputRow, { paddingBottom: Math.max(12, insets.bottom) }]}>
          <Pressable
            onPress={() => Alert.alert('Изпрати медия', undefined, [
              { text: 'Камера', onPress: () => pickAndSendMedia('camera') },
              { text: 'Галерия', onPress: () => pickAndSendMedia('gallery') },
              { text: 'Отказ', style: 'cancel' },
            ])}
            hitSlop={8}
            style={{ paddingBottom: Platform.OS === 'ios' ? 8 : 4 }}
          >
            {uploading
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <Ionicons name="image-outline" size={26} color={colors.primary} />
            }
          </Pressable>

          <View style={styles.inputWrap}>
            <TextInput
              style={styles.input}
              placeholder="Съобщение…"
              placeholderTextColor={colors.textMuted}
              value={text}
              onChangeText={(t) => {
                setText(t);
                if (!user) return;
                // Only write 'typing=true' once until clearTypingStatus runs; debounce 'false' after 2s idle.
                if (!typingStartedRef.current) {
                  typingStartedRef.current = true;
                  void setTypingStatus(convId, user.uid, true);
                }
                if (typingTimeout.current) clearTimeout(typingTimeout.current);
                typingTimeout.current = setTimeout(() => {
                  typingStartedRef.current = false;
                  void setTypingStatus(convId, user.uid, false);
                }, 2000);
              }}
              multiline
              maxLength={2000}
            />
          </View>

          <Pressable
            onPress={send}
            disabled={sending || !hasSendText}
            style={[styles.sendBtn, { backgroundColor: hasSendText ? colors.primary : colors.surfaceAlt }]}
          >
            {sending
              ? <ActivityIndicator size="small" color={hasSendText ? '#fff' : colors.textMuted} />
              : <Ionicons name="arrow-up" size={20} color={hasSendText ? '#fff' : colors.textMuted} />
            }
          </Pressable>
        </View>

        <ImageViewer uri={viewerUri} visible={viewerVisible} onClose={() => setViewerVisible(false)} />
      </Screen>
    </KeyboardAvoidingView>
  );
}
