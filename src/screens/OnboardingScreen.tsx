import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Dimensions,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { Button } from '../components/Button';

const { width: SCREEN_W } = Dimensions.get('window');

type Slide = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  accent: string;
};

const SLIDES: Slide[] = [
  {
    key: 'welcome',
    icon: 'fish',
    title: 'Добре дошъл в Риболов',
    body: 'Твоят риболовен дневник, общност и карта на водоемите — всичко на едно място.',
    accent: '#0E4D64',
  },
  {
    key: 'logbook',
    icon: 'book',
    title: 'Записвай всеки улов',
    body: 'Вид риба, тегло, снимка, локация и бележки. Всичко се пази на телефона — дори без интернет.',
    accent: '#1A7A9C',
  },
  {
    key: 'social',
    icon: 'newspaper',
    title: 'Лента на общността',
    body: 'Следвай рибари, харесвай улови, коментирай и участвай в класирания.',
    accent: '#2E9B5A',
  },
  {
    key: 'map',
    icon: 'map',
    title: 'Карта и прогноза',
    body: 'Стотици язовири и реки с риболовен индекс, прогноза за 7 дни и фаза на луната.',
    accent: '#093545',
  },
];

type Props = { onDone: () => void };

export default function OnboardingScreen({ onDone }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList>(null);
  const [index, setIndex] = useState(0);

  const goNext = () => {
    if (index < SLIDES.length - 1) {
      listRef.current?.scrollToIndex({ index: index + 1, animated: true });
      setIndex(index + 1);
    } else {
      onDone();
    }
  };

  const isLast = index === SLIDES.length - 1;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(s) => s.key}
        horizontal
        pagingEnabled
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        renderItem={({ item }) => (
          <View style={[styles.slide, { width: SCREEN_W }]}>
            <View style={[styles.iconRing, { backgroundColor: item.accent }]}>
              <Ionicons name={item.icon} size={56} color="#fff" />
            </View>
            <Text style={[styles.title, { color: colors.text }]}>{item.title}</Text>
            <Text style={[styles.body, { color: colors.textMuted }]}>{item.body}</Text>
          </View>
        )}
      />

      {/* Dots */}
      <View style={styles.dots}>
        {SLIDES.map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              {
                backgroundColor: i === index ? colors.primary : colors.border,
                width: i === index ? 24 : 8,
              },
            ]}
          />
        ))}
      </View>

      {/* Actions */}
      <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <Button
          title={isLast ? 'Започни' : 'Напред'}
          onPress={goNext}
          style={{ flex: 1 }}
        />
        {!isLast ? (
          <Pressable onPress={onDone} style={styles.skip} hitSlop={8}>
            <Text style={[styles.skipText, { color: colors.textMuted }]}>Пропусни</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
  },
  iconRing: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  title: {
    ...typography.h1,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  body: {
    ...typography.body,
    textAlign: 'center',
    lineHeight: 26,
    maxWidth: 320,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  actions: {
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  skip: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  skipText: { ...typography.body },
});
