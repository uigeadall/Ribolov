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
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { useTheme } from '../services/themeContext';
import { spacing, typography } from '../theme/typography';
import type { ProfileStackParamList } from '../navigation/types';
import type { DirectMessage } from '../types';
import { useAuth } from '../services/authContext';
import { sendConversationMessage, subscribeConversationMessages, markConversationRead } from '../services/cloudSync';

type R = RouteProp<ProfileStackParamList, 'ChatDetail'>;

export default function ChatDetailScreen() {
  const route = useRoute<R>();
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { user, configured } = useAuth();
  const { convId, otherName } = route.params;
  const [msgs, setMsgs] = useState<DirectMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

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

  const styles = useMemo(
    () =>
      StyleSheet.create({
        header: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          paddingBottom: spacing.md,
        },
        title: { ...typography.h3, color: colors.text, flex: 1 },
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
            <Text style={styles.title} numberOfLines={1}>
              {otherName}
            </Text>
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
                <Text style={mine ? styles.msgMine : styles.msgOther}>{item.text}</Text>
              </View>
            );
          }}
        />

        <View style={[styles.inputRow, { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }]}>
          <TextInput
            style={styles.input}
            placeholder="Съобщение…"
            placeholderTextColor={colors.textMuted}
            value={text}
            onChangeText={setText}
            multiline
          />
          <Button title="Изпрати" onPress={send} loading={sending} style={{ paddingHorizontal: spacing.md }} />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}
