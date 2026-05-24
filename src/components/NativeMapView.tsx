import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform, StyleSheet, View, Text } from 'react-native';
import MapView, { Circle, Marker, Polyline, type Region } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import type { LeafletMapHandle, LeafletMapProps, LeafletMapType, CatchMapMarker, LiveFishingMarker } from './LeafletMap';

const LABEL_THRESHOLD = 0.11;

// ── Clustering ────────────────────────────────────────────────────────────────

type Cluster = {
  latitude: number;
  longitude: number;
  count: number;
  ids: string[];
};

function clusterMarkers(
  markers: CatchMapMarker[],
  region: { latitudeDelta: number; longitudeDelta: number },
): Cluster[] {
  const cellLat = region.latitudeDelta / 6;
  const cellLng = region.longitudeDelta / 6;
  const cells = new Map<string, { latSum: number; lngSum: number; ids: string[] }>();

  for (const m of markers) {
    const row = Math.floor(m.latitude / cellLat);
    const col = Math.floor(m.longitude / cellLng);
    const key = `${row}:${col}`;
    const cell = cells.get(key);
    if (cell) {
      cell.latSum += m.latitude;
      cell.lngSum += m.longitude;
      cell.ids.push(m.id);
    } else {
      cells.set(key, { latSum: m.latitude, lngSum: m.longitude, ids: [m.id] });
    }
  }

  const result: Cluster[] = [];
  for (const cell of cells.values()) {
    result.push({
      latitude: cell.latSum / cell.ids.length,
      longitude: cell.lngSum / cell.ids.length,
      count: cell.ids.length,
      ids: cell.ids,
    });
  }
  return result;
}
// Degrees of extra padding beyond the visible region when culling markers.
const CULL_BUFFER = 0.25;
// How long (ms) to keep tracksViewChanges=true after a marker mounts/remounts on Android.
const ANDROID_TRACK_MS = 800;

function zoomToRegion(lat: number, lng: number, zoom: number): Region {
  const latDelta = Math.min(40, Math.max(0.003, 360 / Math.pow(2, zoom + 0.85)));
  const cos = Math.cos((lat * Math.PI) / 180);
  const lngDelta = latDelta / (Math.abs(cos) > 0.2 ? Math.abs(cos) : 0.2);
  return { latitude: lat, longitude: lng, latitudeDelta: latDelta, longitudeDelta: lngDelta };
}

function zoomFromRegion(r: Region): number {
  // Inverse of zoomToRegion latDelta = 360 / 2^(zoom + 0.85)
  return Math.log2(360 / Math.max(r.latitudeDelta, 0.0001)) - 0.85;
}

function rnMapType(mt: LeafletMapType): 'standard' | 'satellite' | 'hybrid' {
  if (mt === 'satellite') return 'satellite';
  if (mt === 'hybrid') return 'hybrid';
  return 'standard';
}

// Marker tail triangles are drawn with the "0x0 view with borders" CSS trick:
// the borders render OUTSIDE the layout box (which is 0x0). On iOS the marker
// view paints itself directly and overflows are honoured. On Android,
// react-native-maps rasterises each custom marker into a bitmap sized to the
// View's REPORTED layout — so anything drawn outside the layout box gets
// clipped on the way to the bitmap. The previous workaround was a uniform
// `padding: 4` around the column, but it didn't fully cover the 9-10px tall
// tail AND it shifted the geographic anchor away from the tail tip (the
// `anchor={{x: 0.5, y: 1}}` puts the bottom of the bitmap at the geo coord,
// so any padding below the tail pushed the tip up off the location).
//
// The fix: wrap each triangle in a parent sized exactly to the triangle's
// visual bounds. The triangle's 0x0 child renders its borders INSIDE the
// sized wrapper, which means the layout box now contains the full visual,
// the Android bitmap captures it, and the tail tip continues to sit exactly
// at the anchor coordinate.
function SpotPin() {
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={styles.spotPlate}>
        <Ionicons name="fish-outline" size={20} color="#E8F8FF" />
      </View>
      <View style={styles.spotTailWrap}>
        <View style={styles.spotTail} />
      </View>
    </View>
  );
}

function DamPin({ name, showLabel }: { name: string; showLabel: boolean }) {
  return (
    <View style={styles.markerCol} accessibilityLabel={name}>
      {showLabel ? (
        <View style={[styles.labelBubble, styles.labelDam]}>
          <Text numberOfLines={1} style={styles.labelTextDam}>{name}</Text>
        </View>
      ) : null}
      <View style={[styles.iconPlate, styles.plateDam]}>
        <Ionicons name="layers-outline" size={20} color="#C8F0E8" />
      </View>
      <View style={styles.damTailWrap}>
        <View style={styles.damTail} />
      </View>
    </View>
  );
}

function LiveFishingPin() {
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={styles.livePlate}>
        <Ionicons name="flame" size={18} color="#FFF6D8" />
      </View>
      <View style={styles.liveTailWrap}>
        <View style={styles.liveTail} />
      </View>
    </View>
  );
}

function RiverPin({ name, showLabel }: { name: string; showLabel: boolean }) {
  return (
    <View style={styles.markerCol} accessibilityLabel={name}>
      {showLabel ? (
        <View style={[styles.labelBubble, styles.labelRiver]}>
          <Text numberOfLines={1} style={styles.labelTextRiver}>{name}</Text>
        </View>
      ) : null}
      <View style={[styles.iconPlate, styles.plateRiver]}>
        <Ionicons name="water-outline" size={20} color="#E8FFF2" />
      </View>
      <View style={styles.riverTailWrap}>
        <View style={styles.riverTail} />
      </View>
    </View>
  );
}

/**
 * Android-only hook: returns true for ANDROID_TRACK_MS after `resetKey` changes,
 * then false. This ensures custom-view markers finish painting before we stop
 * tracking, which prevents the silent blank-marker bug on Android.
 */
function useAndroidTracks(resetKey: string): boolean {
  const [tracks, setTracks] = useState(Platform.OS === 'android');
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    setTracks(true);
    const t = setTimeout(() => setTracks(false), ANDROID_TRACK_MS);
    return () => clearTimeout(t);
  }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return tracks;
}

/** Thin wrapper so each dam/river marker manages its own tracksViewChanges lifecycle. */
type WaterMarkerProps = {
  id: string;
  latitude: number;
  longitude: number;
  name: string;
  showLabel: boolean;
  type: 'dam' | 'river';
  onPress: () => void;
};

const WaterMarker = React.memo(function WaterMarker({
  id, latitude, longitude, name, showLabel, type, onPress,
}: WaterMarkerProps) {
  const resetKey = `${id}-${showLabel ? 1 : 0}`;
  const tracks = useAndroidTracks(resetKey);

  return (
    <Marker
      identifier={id}
      coordinate={{ latitude, longitude }}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={tracks}
      onPress={onPress}
    >
      {type === 'dam'
        ? <DamPin name={name} showLabel={showLabel} />
        : <RiverPin name={name} showLabel={showLabel} />}
    </Marker>
  );
});

export const NativeMapView = forwardRef<LeafletMapHandle, LeafletMapProps>(
  function NativeMapView(props, ref) {
    const { spots, dams, rivers, catchMarkers, heatmapCells, liveFishingMarkers, pendingCoord, userCoord, routeLine, mapType, onLongPress, onMarkerPress, onDamPress, onRiverPress, onLivePinPress, onMapMove } = props;

    const mapRef = useRef<MapView>(null);

    const [region, setRegion] = useState<Region>({
      latitude: 42.65,
      longitude: 25.35,
      latitudeDelta: 6,
      longitudeDelta: 6,
    });
    const [showWaterLabels, setShowWaterLabels] = useState(false);

    // Spot markers always use tracksViewChanges=false (no label changes).
    // On Android, a one-shot true→false ensures initial paint.
    const spotResetKey = 'spots-init';
    const spotTracks = useAndroidTracks(spotResetKey);

    const onRegionChangeComplete = useCallback((r: Region) => {
      setRegion(r);
      setShowWaterLabels(r.latitudeDelta <= LABEL_THRESHOLD);
      onMapMove?.(r.latitude, r.longitude, zoomFromRegion(r));
    }, [onMapMove]);

    useImperativeHandle(ref, () => ({
      flyTo: (lat: number, lng: number, zoom = 13) => {
        mapRef.current?.animateToRegion(zoomToRegion(lat, lng, zoom), 450);
      },
    }));

    useEffect(() => {
      if (!routeLine || routeLine.length < 2) return;
      const t = setTimeout(() => {
        mapRef.current?.fitToCoordinates(routeLine, {
          edgePadding: { top: 120, right: 48, bottom: 180, left: 48 },
          animated: true,
        });
      }, 450);
      return () => clearTimeout(t);
    }, [routeLine]);

    // Viewport culling: only render markers inside the visible region + buffer.
    const visibleDams = useMemo(() => {
      const { latitude: lat, longitude: lng, latitudeDelta: dLat, longitudeDelta: dLng } = region;
      const minLat = lat - dLat / 2 - CULL_BUFFER;
      const maxLat = lat + dLat / 2 + CULL_BUFFER;
      const minLng = lng - dLng / 2 - CULL_BUFFER;
      const maxLng = lng + dLng / 2 + CULL_BUFFER;
      return dams.filter(
        (d) => d.latitude >= minLat && d.latitude <= maxLat && d.longitude >= minLng && d.longitude <= maxLng,
      );
    }, [dams, region]);

    const visibleRivers = useMemo(() => {
      const { latitude: lat, longitude: lng, latitudeDelta: dLat, longitudeDelta: dLng } = region;
      const minLat = lat - dLat / 2 - CULL_BUFFER;
      const maxLat = lat + dLat / 2 + CULL_BUFFER;
      const minLng = lng - dLng / 2 - CULL_BUFFER;
      const maxLng = lng + dLng / 2 + CULL_BUFFER;
      return rivers.filter(
        (r) => r.latitude >= minLat && r.latitude <= maxLat && r.longitude >= minLng && r.longitude <= maxLng,
      );
    }, [rivers, region]);

    const catchClusters = useMemo(
      () => clusterMarkers(catchMarkers ?? [], region),
      [catchMarkers, region],
    );

    return (
      <MapView
        ref={mapRef}
        style={styles.fill}
        initialRegion={zoomToRegion(42.65, 25.35, 7)}
        mapType={rnMapType(mapType)}
        onLongPress={(e) => {
          const { latitude, longitude } = e.nativeEvent.coordinate;
          onLongPress(latitude, longitude);
        }}
        onRegionChangeComplete={onRegionChangeComplete}
        rotateEnabled={false}
        pitchEnabled={false}
        showsUserLocation={false}
        showsMyLocationButton={false}
        // Android: move rendering to hardware layer — smoother panning.
        {...(Platform.OS === 'android' ? { renderToHardwareTextureAndroid: true } : {})}
      >
        {spots.map((s) => (
          <Marker
            key={`spot-${s.id}`}
            coordinate={{ latitude: s.latitude, longitude: s.longitude }}
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={spotTracks}
            onPress={() => onMarkerPress(s.id)}
          >
            <SpotPin />
          </Marker>
        ))}

        {visibleDams.map((d) => (
          <WaterMarker
            key={`dam-${d.id}`}
            id={`dam-${d.id}`}
            latitude={d.latitude}
            longitude={d.longitude}
            name={d.name}
            showLabel={showWaterLabels}
            type="dam"
            onPress={() => onDamPress(d.id)}
          />
        ))}

        {visibleRivers.map((r) => (
          <WaterMarker
            key={`river-${r.id}`}
            id={`river-${r.id}`}
            latitude={r.latitude}
            longitude={r.longitude}
            name={r.name}
            showLabel={showWaterLabels}
            type="river"
            onPress={() => onRiverPress(r.id)}
          />
        ))}

        {(heatmapCells ?? []).map((h, i) => {
          // Color ramp by distinct-angler count: yellow → orange → red.
          // The threshold floor of 3 is enforced server-side in fetchSpeciesHeatmap.
          const color = h.ownerCount >= 10 ? '#C92A2A' : h.ownerCount >= 6 ? '#E85D04' : '#F7B731';
          return (
            <Circle
              key={`heat-${i}-${h.latitude.toFixed(3)}-${h.longitude.toFixed(3)}`}
              center={{ latitude: h.latitude, longitude: h.longitude }}
              radius={2200}
              strokeWidth={1.2}
              strokeColor={color}
              fillColor={color + '52'}
            />
          );
        })}

        {catchClusters.map((cluster) =>
          cluster.count === 1 ? (
            <Circle
              key={`catch-${cluster.ids[0]}`}
              center={{ latitude: cluster.latitude, longitude: cluster.longitude }}
              radius={120}
              strokeWidth={2.5}
              strokeColor="#E85D04"
              fillColor="rgba(255,133,51,0.75)"
            />
          ) : (
            <Marker
              key={`cluster-${cluster.ids.join('-')}`}
              coordinate={{ latitude: cluster.latitude, longitude: cluster.longitude }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
            >
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#E85D04', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{cluster.count}</Text>
              </View>
            </Marker>
          ),
        )}

        {(liveFishingMarkers ?? []).map((p) => (
          <Marker
            key={`live-${p.id}`}
            identifier={`live-${p.id}`}
            coordinate={{ latitude: p.latitude, longitude: p.longitude }}
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={false}
            onPress={() => onLivePinPress?.(p.id)}
          >
            <LiveFishingPin />
          </Marker>
        ))}

        {pendingCoord ? (
          <Circle
            center={pendingCoord}
            radius={100}
            strokeWidth={3}
            strokeColor="#D64545"
            fillColor="rgba(255,144,143,0.95)"
          />
        ) : null}

        {userCoord ? (
          <Circle
            center={userCoord}
            radius={82}
            strokeWidth={3}
            strokeColor="#2E9B5A"
            fillColor="rgba(138,238,186,1)"
          />
        ) : null}

        {routeLine && routeLine.length >= 2 ? (
          <Polyline
            coordinates={routeLine}
            strokeColor="#0E4D64"
            strokeWidth={6}
            lineJoin="round"
            lineCap="round"
          />
        ) : null}
      </MapView>
    );
  },
);

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#DDE8EE' },
  markerCol: { alignItems: 'center', overflow: 'visible' },
  labelBubble: {
    maxWidth: 220,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    marginBottom: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    // Android elevation paints a drop-shadow that extends past the layout box,
    // which the marker rasteriser then clips — visible as a hard-edged shadow
    // stub. The white border + thicker text outline already provide enough
    // contrast against light/dark map tiles, so leave Android shadowless.
    ...(Platform.OS === 'android' ? {} : { elevation: 4 }),
  },
  labelDam: { backgroundColor: 'rgba(255,255,255,0.96)', borderWidth: 2, borderColor: '#062D3D' },
  labelRiver: { backgroundColor: 'rgba(236,255,242,0.96)', borderWidth: 2, borderColor: '#1e6b3d' },
  labelTextDam: { fontSize: 12, fontWeight: '700', color: '#062D3D' },
  labelTextRiver: { fontSize: 12, fontWeight: '700', color: '#0f3d21' },
  iconPlate: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.38,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    // On Android, elevation shadow is clipped when the marker view is rasterised.
    // Use 0 to avoid truncated-icon artefacts; the white border provides contrast instead.
    elevation: Platform.OS === 'android' ? 0 : 5,
  },
  plateDam: { backgroundColor: '#062D3D' },
  plateRiver: { backgroundColor: '#2E9B5A' },
  spotPlate: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1A7A9C',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.38,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: Platform.OS === 'android' ? 0 : 5,
  },
  // Each tail wrapper is sized to the triangle's visual bounds and overlaps
  // the plate above by 1px (marginTop: -1) to hide the seam — same visual
  // result as the previous direct marginTop: -1 on the 0x0 triangle, but
  // with a layout box that actually contains the triangle so the Android
  // marker bitmap doesn't clip it. The inner triangle stays 0x0 and renders
  // via the border trick, now safely INSIDE the sized wrapper.
  spotTailWrap: {
    width: 14, height: 10, marginTop: -1,
    alignItems: 'center',
  },
  spotTail: {
    width: 0, height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 10,
    borderStyle: 'solid',
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#1A7A9C',
  },
  damTailWrap: {
    width: 12, height: 9, marginTop: -1,
    alignItems: 'center',
  },
  damTail: {
    width: 0, height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 9,
    borderStyle: 'solid',
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#062D3D',
  },
  riverTailWrap: {
    width: 12, height: 9, marginTop: -1,
    alignItems: 'center',
  },
  riverTail: {
    width: 0, height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 9,
    borderStyle: 'solid',
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#2E9B5A',
  },
  livePlate: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E85D04',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFE9C8',
    shadowColor: '#000',
    shadowOpacity: 0.38,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: Platform.OS === 'android' ? 0 : 5,
  },
  liveTailWrap: {
    width: 12, height: 9, marginTop: -1,
    alignItems: 'center',
  },
  liveTail: {
    width: 0, height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 9,
    borderStyle: 'solid',
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#E85D04',
  },
});
