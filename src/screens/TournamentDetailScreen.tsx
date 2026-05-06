import React, { useEffect, useMemo, useState } from 'react';
import { Text, StyleSheet, View } from 'react-native';
import { doc, getDoc } from 'firebase/firestore';
import { RouteProp, useRoute } from '@react-navigation/native';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { ensureFirebase } from '../services/firebase';
import type { ProfileStackParamList } from '../navigation/types';
import type { Tournament } from '../types';
import { useTheme } from '../services/themeContext';
import { spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { joinTournament } from '../services/cloudSync';

type R = RouteProp<ProfileStackParamList, 'TournamentDetail'>;

export default function TournamentDetailScreen() {
  const route = useRoute<R>();
  const { colors } = useTheme();
  const { user } = useAuth();
  const [t, setT] = useState<Tournament | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const fb = ensureFirebase();
    if (!fb) {
      setT(null);
      return;
    }
    getDoc(doc(fb.db, 'tournaments', route.params.id)).then((snap) => {
      setT(snap.exists() ? (snap.data() as Tournament) : null);
    });
  }, [route.params.id]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        title: { ...typography.h2, color: colors.text },
        meta: { ...typography.body, color: colors.textMuted, marginTop: spacing.sm },
        body: { ...typography.body, color: colors.text, marginTop: spacing.md, lineHeight: 22 },
      }),
    [colors]
  );

  const onJoin = async () => {
    if (!user || !t) return;
    setBusy(true);
    try {
      await joinTournament(t.id, user.uid, user.displayName || user.email || 'Рибар');
    } finally {
      setBusy(false);
    }
  };

  if (t === undefined) {
    return (
      <Screen>
        <Text style={{ ...typography.body, color: colors.textMuted }}>Зареждане…</Text>
      </Screen>
    );
  }

  if (!t) {
    return (
      <Screen>
        <Text style={{ ...typography.body, color: colors.textMuted }}>Турнирът не е намерен.</Text>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Text style={styles.title}>{t.name}</Text>
      <Text style={styles.meta}>
        {t.startDate} – {t.endDate}
      </Text>
      <Text style={styles.meta}>Домакин: {t.hostName}</Text>

      <Card style={{ marginTop: spacing.lg }}>
        <Text style={styles.body}>{t.description?.trim() ? t.description : 'Без описание.'}</Text>
        <Text style={[styles.meta, { marginTop: spacing.sm }]}>
          Категория: {t.category}
          {t.speciesName ? ` · Вид: ${t.speciesName}` : ''}
        </Text>
      </Card>

      {user ? (
        <Button title="Участвай" onPress={onJoin} loading={busy} style={{ marginTop: spacing.lg }} />
      ) : null}
    </Screen>
  );
}
