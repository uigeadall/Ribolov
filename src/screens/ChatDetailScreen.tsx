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
} from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import { useAppNavigation } from '../navigation/useAppNavigation';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { uploadAsync, FileSystemUploadType } from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import type { ProfileStackParamList } from '../navigation/types';
import type { DirectMessage } from '../types';
import { useAuth } from '../services/authContext';
import { sendConversationMessage, subscribeConversationMessages, markConversationRead, subscribeUserPresence } from '../services/cloudSync';
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

export default function ChatDetailScreen() {
  const route = useRoute<R>();
  const navigation = useAppNavigation();
  const { colors } = useTheme();
  const { user, configured } = useAuth();
  const { convId, otherName } = route.params;
  const [msgs, setMsgs] = useState<DirectMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [otherPresence, setOtherPresence] = useState<{ online: boolean; lastSeen?: number }>({ online: false });
  const flatRef = useRef<FlatList<ChatItem>>(null);

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

  const { otherUid } = route.params;

  useEffect(() => {
    if (!configured || !user) return;
    markConversationRead(convId, user.uid).catch(() => {});
    const unsubMsgs = subscribeConversationMessages(convId, (next) => {
      setMsgs(next);
      markConversationRead(convId, user.uid).catch(() => {});
      flatRef.current?.scrollToEnd({ animated: true });
    });
    const unsubPresence = subscribeUserPresence(otherUid, setOtherPresence);
    return () => { unsubMsgs(); unsubPresence(); };
  }, [convId, otherUid, configured, user]);

  const send = useCallback(async () => {
    if (!user || !text.trim()) return;
    setSending(true);
    const trimmed = text.trim();
    try {
      const myName = user.displayName ?? user.email ?? 'Рибар';
      await sendConversationMessage(convId, user.uid, trimmed, otherUid, myName);
      setText('');
    } catch (e) {
      const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '';
      if (code === 'unavailable' || code === 'failed-precondition') {
        const myName = user.displayName ?? user.email ?? 'Рибар';
        await enqueueMessage(convId, user.uid, trimmed, otherUid, myName).catch(() => {});
        setText('');
        Alert.alert('Офлайн', 'Съобщението ще бъде изпратено, когато се свържеш с интернет.');
      } else {
        handleError(e);
      }
    } finally {
      setSending(false);
    }
  }, [convId, text, user, otherUid]);

  const pickAndSendMedia = useCallback(async (source: 'camera' | 'gallery') => {
    if (!user) return;
    const perm = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Няма достъп', 'Разреши достъп до камерата/галерията.');
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: 'images',
      quality: 0.5,
    };
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
      const ts = Date.now();
      const storagePath = `publicCatchPhotos/${user.uid}/chat_${ts}.jpg`;

      // FileSystem.uploadAsync sends the file as raw binary — no Blob/ArrayBuffer in JS.
      const uploadResult = await uploadAsync(
        `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(storagePath)}`,
        asset.uri,
        {
          httpMethod: 'POST',
          uploadType: FileSystemUploadType.BINARY_CONTENT,
          headers: {
            'Content-Type': 'image/jpeg',
            'Authorization': `Bearer ${token}`,
          },
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

  const styles = useMemo(
    () =>
      StyleSheet.create({
        header: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          paddingBottom: spacing.md,
        },
        headerInfo: {
          flex: 1,
          flexDirection: 'column',
        },
        title: { ...typography.h3, color: colors.text },
        bubbleMine: {
          backgroundColor: colors.primary,
          padding: spacing.md,
          borderRadius: 14,
          borderBottomRightRadius: 3,
        },
        bubbleOther: {
          backgroundColor: colors.surfaceAlt,
          padding: spacing.md,
          borderRadius: 14,
          borderBottomLeftRadius: 3,
          borderWidth: 1,
          borderColor: colors.border,
        },
        msgMine: { ...typography.body, color: colors.white },
        msgOther: { ...typography.body, color: colors.text },
        inputRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end', paddingTop: spacing.sm },
        input: {
          flex: 1,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          fontSize: 16,
          color: colors.text,
          maxHeight: 120,
        },
      }),
    [colors]
  );

  if (!configured || !user) {
    return (
      <Screen>
        <Text style={{ ...typography.body, color: colors.textMuted }}>Нужен е вход и Firebase за чата.</Text>
      </Screen>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen padded={false} safeAreaEdges={['top', 'left', 'right']} avoidKeyboard={false}>
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
          <View style={styles.header}>
            <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
              <Ionicons name="chevron-back" size={28} color={colors.primary} />
            </Pressable>
            <View style={styles.headerInfo}>
              <Text style={styles.title} numberOfLines={1}>
                {otherName}
              </Text>
              <Text style={{ fontSize: 11, color: otherPresence.online ? '#2E9B5A' : colors.textMuted, marginTop: 1 }}>
                {otherPresence.online
                  ? 'Онлайн'
                  : otherPresence.lastSeen
                    ? `Последно виждан ${formatMsgTime(otherPresence.lastSeen)}`
                    : ''}
              </Text>
            </View>
          </View>
        </View>

        <FlatList
          ref={flatRef}
          data={chatItems}
          keyExtractor={(m) => ('_sep' in m ? m.id : m.id)}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}
          onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
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
              <View style={{ position: 'relative', alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '85%', marginBottom: spacing.sm }}>
                <View style={mine ? styles.bubbleMine : styles.bubbleOther}>
                  {item.mediaUrl && item.mediaType === 'photo' ? (
                    <Image
                      source={{ uri: item.mediaUrl }}
                      style={{ width: 200, height: 150, borderRadius: 8 }}
                      contentFit="cover"
                    />
                  ) : item.mediaUrl && item.mediaType === 'video' ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons name="videocam" size={20} color={mine ? colors.white : colors.text} />
                      <Text style={mine ? styles.msgMine : styles.msgOther}>Видео</Text>
                    </View>
                  ) : (
                    <Text style={mine ? styles.msgMine : styles.msgOther}>{item.text}</Text>
                  )}
                  {item.createdAt ? (
                    <Text style={{ fontSize: 10, color: mine ? 'rgba(255,255,255,0.6)' : colors.textMuted, marginTop: 3, alignSelf: 'flex-end' }}>
                      {formatMsgTime(item.createdAt)}
                    </Text>
                  ) : null}
                </View>
                {/* Bubble tail */}
                <View style={{
                  position: 'absolute', bottom: 0,
                  ...(mine
                    ? { right: -6, borderTopWidth: 10, borderTopColor: colors.primary, borderLeftWidth: 8, borderLeftColor: 'transparent', borderBottomColor: 'transparent', borderBottomWidth: 0 }
                    : { left: -6, borderTopWidth: 10, borderTopColor: colors.surfaceAlt, borderRightWidth: 8, borderRightColor: 'transparent', borderBottomColor: 'transparent', borderBottomWidth: 0 }),
                  width: 0, height: 0, borderStyle: 'solid',
                }} />
              </View>
            );
          }}
        />

        <View style={[styles.inputRow, { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }]}>
          <Pressable
            onPress={() => {
              Alert.alert('Изпрати медия', undefined, [
                { text: 'Камера', onPress: () => pickAndSendMedia('camera') },
                { text: 'Галерия', onPress: () => pickAndSendMedia('gallery') },
                { text: 'Отказ', style: 'cancel' },
              ]);
            }}
            hitSlop={8}
            style={{ paddingVertical: spacing.sm }}
          >
            <Ionicons name="camera-outline" size={26} color={colors.primary} />
          </Pressable>
          <TextInput
            style={styles.input}
            placeholder="Съобщение…"
            placeholderTextColor={colors.textMuted}
            value={text}
            onChangeText={setText}
            multiline
            maxLength={2000}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {uploading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : null}
            <Button title="Изпрати" onPress={send} loading={sending} style={{ paddingHorizontal: spacing.md }} />
          </View>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}
