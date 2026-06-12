import React, { useEffect, useMemo } from 'react';
import { View, Text, Animated, Easing, StyleSheet, Dimensions } from 'react-native';

const { width: SCREEN_W } = Dimensions.get('window');

const LETTERS = ['Р', 'И', 'Б', 'О', 'Л', 'О', 'В'];
const TAGLINE_WORDS = ['Дневник', 'за', 'рибари.'];
const TAGLINE_2_WORDS = ['Всичко', 'на', 'едно', 'място.'];

// Type scale picked from screen width so we fill the line on small phones
// without overflowing on big ones.
const LETTER_SIZE = Math.min(SCREEN_W * 0.18, 86);

/** A single letter that fades in from below with stagger. Each letter is its
    own Animated.Text so we can sequence them independently — sliding a single
    long string wouldn't give us the kinetic build-up. */
function KineticLetter({ letter, delay }: { letter: string; delay: number }) {
  const t = useMemo(() => new Animated.Value(0), []);
  useEffect(() => {
    Animated.timing(t, {
      toValue: 1,
      duration: 560,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [t, delay]);
  const opacity = t;
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [22, 0] });
  return (
    <Animated.Text style={[styles.letter, { opacity, transform: [{ translateY }] }]}>
      {letter}
    </Animated.Text>
  );
}

/** Word in the tagline — fades up in place, used to type out the sentence
    word-by-word rather than character-by-character (faster, less gimmicky). */
function TaglineWord({ word, delay, style }: { word: string; delay: number; style?: any }) {
  const t = useMemo(() => new Animated.Value(0), []);
  useEffect(() => {
    Animated.timing(t, {
      toValue: 1,
      duration: 480,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [t, delay]);
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [6, 0] });
  return (
    <Animated.Text style={[styles.taglineWord, style, { opacity: t, transform: [{ translateY }] }]}>
      {word}
    </Animated.Text>
  );
}

function currentDate(): { day: string; date: string; place: string } {
  const days = ['НЕДЕЛЯ', 'ПОНЕДЕЛНИК', 'ВТОРНИК', 'СРЯДА', 'ЧЕТВЪРТЪК', 'ПЕТЪК', 'СЪБОТА'];
  const months = ['ЯНУ', 'ФЕВ', 'МАР', 'АПР', 'МАЙ', 'ЮНИ', 'ЮЛИ', 'АВГ', 'СЕП', 'ОКТ', 'НОЕ', 'ДЕК'];
  const d = new Date();
  return {
    day: days[d.getDay()],
    date: `${d.getDate().toString().padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()}`,
    place: 'СОФИЯ',
  };
}

/**
 * "Manifesto" splash — editorial / magazine-style typographic composition.
 * Zero imagery. Massive wordmark with letter-by-letter kinetic reveal, four
 * corner marks (issue/date/place/loader) that frame the page, a typed-in
 * tagline below the headline, and a thin amber rule that draws across.
 */
export default function AppSplashScreen() {
  const meta = useMemo(currentDate, []);

  const a = useMemo(() => ({
    cornersOpacity: new Animated.Value(0),
    ruleScale: new Animated.Value(0),
    ruleOpacity: new Animated.Value(0),
    underlineWidth: new Animated.Value(0),
    loaderDots: [0, 1, 2].map(() => new Animated.Value(0)),
  }), []);

  useEffect(() => {
    // Corner marks fade in immediately so the page frame is established
    // before the headline starts building.
    Animated.timing(a.cornersOpacity, {
      toValue: 1, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start();

    // Amber rule draws across just before the headline lands.
    Animated.parallel([
      Animated.timing(a.ruleOpacity, { toValue: 1, duration: 400, delay: 80, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(a.ruleScale, { toValue: 1, duration: 700, delay: 80, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();

    // Headline underline grows after the last letter lands (560ms entry + last
    // letter's 60ms-per-letter stagger ≈ 1100ms total).
    Animated.timing(a.underlineWidth, {
      toValue: 1, duration: 600, delay: 1100, easing: Easing.out(Easing.cubic), useNativeDriver: false,
    }).start();

    // Loader: a row of three dots in the bottom-right that fade in and out in
    // staggered sequence, suggesting "working in background" without a spinner.
    const dotLoops = a.loaderDots.map((dot, i) => Animated.loop(
      Animated.sequence([
        Animated.delay(i * 200),
        Animated.timing(dot, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(dot, { toValue: 0, duration: 600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    ));
    dotLoops.forEach((l) => l.start());

    return () => {
      dotLoops.forEach((l) => l.stop());
    };
  }, [a]);

  return (
    <View style={styles.container}>
      {/* ── Corner marks — establish the editorial frame ── */}
      <Animated.View style={[styles.cornerTopLeft, { opacity: a.cornersOpacity }]}>
        <Text style={styles.cornerSmall}>РИБОЛОВ</Text>
        <Text style={styles.cornerSmallMuted}>ИЗДАНИЕ № 01</Text>
      </Animated.View>

      <Animated.View style={[styles.cornerTopRight, { opacity: a.cornersOpacity }]}>
        <Text style={[styles.cornerSmall, { textAlign: 'right' }]}>{meta.day}</Text>
        <Text style={[styles.cornerSmallMuted, { textAlign: 'right' }]}>{meta.date}</Text>
      </Animated.View>

      <Animated.View style={[styles.cornerBottomLeft, { opacity: a.cornersOpacity }]}>
        <Text style={styles.cornerSmallMuted}>{meta.place}</Text>
        <Text style={styles.cornerSmall}>44.6° N</Text>
      </Animated.View>

      <Animated.View style={[styles.cornerBottomRight, { opacity: a.cornersOpacity }]}>
        <View style={styles.loaderRow}>
          {a.loaderDots.map((d, i) => (
            <Animated.View
              key={i}
              style={[
                styles.loaderDot,
                { opacity: d.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }) },
              ]}
            />
          ))}
        </View>
        <Text style={[styles.cornerSmallMuted, { textAlign: 'right', marginTop: 6 }]}>
          ЗАРЕЖДАНЕ
        </Text>
      </Animated.View>

      {/* ── Headline area ── */}
      <View style={styles.headlineWrap}>
        {/* Thin amber rule above the headline */}
        <Animated.View
          style={[
            styles.amberRule,
            { opacity: a.ruleOpacity, transform: [{ scaleX: a.ruleScale }] },
          ]}
        />

        {/* Kicker line above the wordmark — sets up the editorial voice */}
        <Animated.Text style={[styles.kicker, { opacity: a.cornersOpacity }]}>
          ЗА ВСЕКИ, КОЙТО ПРЕДПОЧИТА ВОДАТА
        </Animated.Text>

        {/* Massive wordmark — letter-by-letter reveal */}
        <View style={styles.headline}>
          {LETTERS.map((l, i) => (
            <KineticLetter key={i} letter={l} delay={400 + i * 60} />
          ))}
        </View>

        {/* Animated underline beneath the wordmark — grows after letters land */}
        <Animated.View
          style={[
            styles.headlineUnderline,
            { width: a.underlineWidth.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
          ]}
        />

        {/* Two-line tagline, words appearing in sequence */}
        <View style={styles.tagline}>
          {TAGLINE_WORDS.map((w, i) => (
            <TaglineWord key={`a-${i}`} word={w} delay={1400 + i * 100} />
          ))}
        </View>
        <View style={styles.tagline}>
          {TAGLINE_2_WORDS.map((w, i) => (
            <TaglineWord
              key={`b-${i}`}
              word={w}
              delay={1700 + i * 100}
              style={styles.taglineMuted}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

// Brand splash: navy canvas, teal accent (was near-black + amber).
const BG = '#13294B';
const TEXT = '#FFFFFF';
const MUTED = 'rgba(220, 230, 245, 0.45)';
const AMBER = '#14B8B8';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
    overflow: 'hidden',
  },

  // ── Corner marks ──
  cornerTopLeft: {
    position: 'absolute',
    top: 64,
    left: 24,
  },
  cornerTopRight: {
    position: 'absolute',
    top: 64,
    right: 24,
    alignItems: 'flex-end',
  },
  cornerBottomLeft: {
    position: 'absolute',
    bottom: 36,
    left: 24,
  },
  cornerBottomRight: {
    position: 'absolute',
    bottom: 36,
    right: 24,
    alignItems: 'flex-end',
  },
  cornerSmall: {
    fontSize: 10,
    fontWeight: '700',
    color: TEXT,
    letterSpacing: 2.4,
  },
  cornerSmallMuted: {
    fontSize: 9,
    color: MUTED,
    letterSpacing: 2,
    marginTop: 4,
    fontWeight: '500',
  },

  loaderRow: {
    flexDirection: 'row',
    gap: 5,
  },
  loaderDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: AMBER,
  },

  // ── Headline area ──
  headlineWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  amberRule: {
    width: 56,
    height: 2,
    backgroundColor: AMBER,
    marginBottom: 18,
  },
  kicker: {
    color: MUTED,
    fontSize: 10,
    letterSpacing: 3,
    fontWeight: '600',
    marginBottom: 14,
    textAlign: 'center',
  },
  headline: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  letter: {
    fontSize: LETTER_SIZE,
    fontWeight: '800',
    color: TEXT,
    lineHeight: LETTER_SIZE * 1.05,
    letterSpacing: -1.5,
  },
  headlineUnderline: {
    marginTop: 14,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.18)',
    maxWidth: 280,
    alignSelf: 'center',
  },
  tagline: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 16,
    gap: 6,
  },
  taglineWord: {
    fontSize: 15,
    color: TEXT,
    fontWeight: '500',
  },
  taglineMuted: {
    color: MUTED,
    fontWeight: '400',
  },
});
