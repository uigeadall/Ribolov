import { useCallback, useRef, useState } from 'react';
import { InteractionManager } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Location from 'expo-location';
import AsyncStorage from '../storage/kv';
import { fetchWeather, fetchForecast, type WeatherSnapshot, type ForecastDay } from '../services/weather';
import { scheduleForecastNotificationIfGood } from '../services/pushNotifications';

const FALLBACK_COORD = { latitude: 42.6977, longitude: 23.3219 };
const STALE = 5 * 60 * 1000;

/**
 * Текущи условия + прогноза, извлечени от бившия HomeScreen. Чете
 * РАЗРЕШЕНИЕТО за локация без да го иска (промптът е само на Карта);
 * без разрешение показва София като мек fallback. Презарежда при фокус,
 * най-много веднъж на 5 минути.
 */
export function useWeather() {
  const lastFetchRef = useRef<number>(0);
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [weatherStatus, setWeatherStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [forecast, setForecast] = useState<ForecastDay[]>([]);
  const [locLabel, setLocLabel] = useState('София (примерно)');
  const [coord, setCoord] = useState<{ latitude: number; longitude: number } | null>(null);

  const load = useCallback(async (isCancelled: () => boolean = () => false) => {
    if (isCancelled()) return;
    setWeatherStatus('loading');
    let lat = FALLBACK_COORD.latitude, lng = FALLBACK_COORD.longitude, label = 'София (примерно)';
    let granted = false;
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (isCancelled()) return;
      if (status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (isCancelled()) return;
        lat = pos.coords.latitude; lng = pos.coords.longitude; label = 'Твоето местоположение';
        granted = true;
      }
    } catch { /* use fallback */ }
    if (isCancelled()) return;
    setLocLabel(label);
    setCoord(granted ? { latitude: lat, longitude: lng } : { ...FALLBACK_COORD });
    try {
      const [w, days] = await Promise.all([
        fetchWeather(lat, lng),
        fetchForecast(lat, lng).catch(() => [] as ForecastDay[]),
      ]);
      if (isCancelled()) return;
      setWeather(w); setForecast(days); setWeatherStatus('idle');
      // Pressure-trend cache — consumers may derive trend from the stored value.
      AsyncStorage.getItem('@ribolov/lastPressure').then(() => {
        AsyncStorage.setItem('@ribolov/lastPressure', String(w.pressureHpa)).catch(() => {});
      }).catch(() => {});
      // Self-deduping; the cancel gate keeps stale fetches from notifying.
      if (!isCancelled()) scheduleForecastNotificationIfGood(days).catch(() => {});
    } catch {
      if (!isCancelled()) { setWeather(null); setWeatherStatus('error'); }
    }
  }, []);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      const now = Date.now();
      if (now - lastFetchRef.current < STALE) return;
      lastFetchRef.current = now;
      void load(isCancelled);
    });
    return () => { cancelled = true; task.cancel(); };
  }, [load]));

  const reload = useCallback(() => {
    lastFetchRef.current = Date.now();
    void load();
  }, [load]);

  return { weather, weatherStatus, forecast, coord, locLabel, reload };
}
