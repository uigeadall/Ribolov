import React, { useEffect, useMemo, useState, useCallback } from 'react';
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
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { useTheme } from '../services/themeContext';
import { spacing, typography } from '../theme/typography';
import type { ProfileStackParamList } from '../navigation/types';
import type { DirectMessage } from '../types';
import { useAuth } from '../services/authContext';
import { sendConversationMessage, subscribeConversationMessages, markConversationRead, subscribeUserPresence } from '../services/cloudSync';

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

export default function ChatDetailScreen() {
  const route = useRoute<R>();
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { user, configured } = useAuth();
  const { convId, otherName } = route.params;
  const [msgs, setMsgs] = useState<DirectMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [otherPresence, setOtherPresence] = useState<{ online: boolean; lastSeen?: number }>({ online: false });

  const { otherUid } = route.params;

  useEffect(() => {
    if (!configured || !user) return;
    // Mark as read when screen opens
    markConversationRead(convId, user.uid).catch(() => {});
    const unsub = subscribeConversationMessages(convId, (next) => {
      setMsgs(next);
      // Mark as read whenever new messages arrive while screen is open
      markConversationRead(convId, user.uid).catch(() => {});
    });
    return unsub;
  }, [convId, configured, user]);

  useEffect(() => {
    if (!configured) return;
    const unsub = subscribeUserPresence(otherUid, setOtherPresence);
    return unsub;
  }, [otherUid, configured]);

  const send = useCallback(async () => {
    if (!user || !text.trim()) return;
    setSending(true);
    try {
      await sendConversationMessage(convId, user.uid, text, otherUid);
      setText('');
    } finally {
      setSending(false);
    }
  }, [convId, text, user, otherUid]);

  const pickAndSendMedia = useCallback(async (source: 'camera' | 'gallery') => {
    if (!user) return;
    const perm = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') { Alert.alert('Няма достъп', 'Разреши достъп до камерата/галерията.'); return; }

    // Request base64 directly from ImagePicker — avoids all fetch/XHR/blob issues
    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.2,
      base64: true,
    };
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    if (!asset.base64) { Alert.alert('Грешка', 'Не може да се прочете снимката.'); return; }

    setUploading(true);
    try {
      // Store image as base64 data URL directly in Firestore message —
      // no Firebase Storage needed, no Blob/ArrayBuffer conversion.
      const MAX_B64 = 900_000; // ~675 KB image, safe under Firestore 1 MB doc limit
      if (asset.base64.length > MAX_B64) {
        throw new Error('Снимката е твърде голяма. Избери по-малка или използвай по-ниско качество.');
      }
      const dataUrl = `data:image/jpeg;base64,${asset.base64}`;
      await sendConversationMessage(convId, user.uid, '', otherUid, dataUrl, 'photo');
    } catch (e) {
      Alert.alert('Грешка', e instanceof Error ? e.message : String(e));
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
          alignSelf: 'flex-end',
          backgroundColor: colors.primary,
          padding: spacing.md,
          borderRadius: 14,
          maxWidth: '85%',
          marginBottom: spacing.sm,
        },
        bubbleOther: {
          alignSelf: 'flex-start',
          backgroundColor: colors.surfaceAlt,
          padding: spacing.md,
          borderRadius: 14,
          maxWidth: '85%',
          marginBottom: spacing.sm,
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
          data={msgs}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}
          renderItem={({ item }) => {
            const mine = item.senderUid === user.uid;
            return (
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
