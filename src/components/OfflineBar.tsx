import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { ensureFirebase } from '../services/firebase';
import { flushPendingCatchSync } from '../services/catchSyncQueue';
import { flushPendingMessages } from '../services/messageSyncQueue';

const CHECK_URL = 'https://1.1.1.1';
const CHECK_INTERVAL_MS = 10_000;

async function checkOnline(): Promise<boolean> {
  try {
    await fetch(CHECK_URL, { method: 'HEAD' });
    return true;
  } catch {
    return false;
  }
}

export function OfflineBar() {
  const [offline, setOffline] = useState(false);
  const prevOfflineRef = useRef(false);
  const slideAnim = useRef(new Animated.Value(-40)).current;

  // Animate the bar and flush sync queue on reconnect
  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: offline ? 0 : -40,
      duration: 280,
      useNativeDriver: true,
    }).start();

    if (prevOfflineRef.current && !offline) {
      const fb = ensureFirebase();
      const u = fb?.auth.currentUser;
      if (u) {
        void flushPendingCatchSync({ user: { uid: u.uid, displayName: u.displayName, email: u.email } });
        void flushPendingMessages();
      }
    }
    prevOfflineRef.current = offline;
  }, [offline, slideAnim]);

  // Poll connectivity every 10 seconds
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const online = await checkOnline();
      if (!cancelled) setOffline(!online);
    };

    void run();
    const id = setInterval(() => { void run(); }, CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <Animated.View
      style={[styles.bar, { transform: [{ translateY: slideAnim }] }]}
      pointerEvents="none"
    >
      <Text style={styles.text}>Офлайн — само дневникът работи</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#C77F12',
    paddingVertical: 6,
    alignItems: 'center',
    zIndex: 9999,
  },
  text: {
    color: '#fff',
    fontSize: 12,
    fontFamily: 'Manrope_600SemiBold',
    textAlign: 'center',
  },
});
