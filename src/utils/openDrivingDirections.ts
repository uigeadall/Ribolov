import { Platform, Linking, Alert } from 'react-native';

export type GeoPoint = { latitude: number; longitude: number };

/**
 * Отваря приложение за карти с маршрут по пътя до целта.
 * Ако има `origin`, се задава начална точка (Google Maps / Apple Maps).
 * Без origin приложението за карти типично пита текущата локация.
 */
export async function openDrivingDirections(
  destination: GeoPoint,
  options?: { origin?: GeoPoint | null }
): Promise<boolean> {
  const { latitude: lat2, longitude: lon2 } = destination;
  if (!Number.isFinite(lat2) || !Number.isFinite(lon2)) {
    Alert.alert('Маршрут', 'Невалидни координати за водоема.');
    return false;
  }

  const dest = `${lat2},${lon2}`;
  const origin = options?.origin;
  const hasOrigin =
    origin != null &&
    Number.isFinite(origin.latitude) &&
    Number.isFinite(origin.longitude) &&
    !(origin.latitude === 0 && origin.longitude === 0);

  const orig = hasOrigin ? `${origin!.latitude},${origin!.longitude}` : '';

  const candidates: string[] = [];

  if (Platform.OS === 'ios') {
    if (hasOrigin) candidates.push(`maps://?saddr=${encodeURIComponent(orig)}&daddr=${encodeURIComponent(dest)}`);
    candidates.push(`maps://?daddr=${encodeURIComponent(dest)}`);
    if (hasOrigin) {
      candidates.push(
        `http://maps.apple.com/?saddr=${encodeURIComponent(orig)}&daddr=${encodeURIComponent(dest)}&dirflg=d`
      );
    }
    candidates.push(`http://maps.apple.com/?daddr=${encodeURIComponent(dest)}&dirflg=d`);
  }

  candidates.push(
    hasOrigin
      ? `https://www.google.com/maps/dir/${encodeURIComponent(orig)}/${encodeURIComponent(dest)}?travelmode=driving`
      : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=driving`
  );

  for (const url of candidates) {
    try {
      const ok = await Linking.canOpenURL(url);
      if (ok) {
        await Linking.openURL(url);
        return true;
      }
    } catch {
      /* пробвай следващия */
    }
  }

  try {
    await Linking.openURL(candidates[candidates.length - 1]!);
    return true;
  } catch {
    Alert.alert('Маршрут', 'Неуспешно отваряне на навигация. Инсталирай Google Maps или ползвай Safari.');
    return false;
  }
}
