import React, { useMemo } from 'react';
import { Text, View, StyleSheet, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { useTheme } from '../services/themeContext';
import { spacing, typography } from '../theme/typography';

export default function TournamentsScreen() {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        header: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: spacing.md,
        },
        title: { ...typography.h2, color: colors.text },
      }),
    [colors]
  );

  return (
    <Screen scroll>
      <View style={styles.header}>
        <Text style={styles.title}>Турнири</Text>
        <Pressable onPress={() => navigation.navigate('CreateTournament')} hitSlop={8}>
          <Ionicons name="add-circle-outline" size={32} color={colors.primary} />
        </Pressable>
      </View>

      <Card>
        <EmptyState
          icon="ribbon-outline"
          title="Списъкът от облака предстои"
          subtitle="Създай турнир с бутона + или от профила. Преглед на активни турнири ще се зарежда от Firebase в следваща стъпка."
        />
      </Card>

      <Button title="Нов турнир" onPress={() => navigation.navigate('CreateTournament')} style={{ marginTop: spacing.lg }} />
    </Screen>
  );
}
