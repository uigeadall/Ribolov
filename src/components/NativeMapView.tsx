import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Platform, StyleSheet, View, Text } from 'react-native';
import MapView, { Circle, Marker, Polyline, type Region } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import type { LeafletMapHandle, LeafletMapProps, LeafletMapType } from './LeafletMap';

/** По-малко delta = по-силен zoom; под този праг показваме имена на язовири/реки. */
const LABEL_LAT_DELTA_THRESHOLD = 0.11;

function zoomToRegion(lat: number, lng: number, zoom: number): Region {
  const latDelta = Math.min(40, Math.max(0.003, 360 / Math.pow(2, zoom + 0.85)));
  const cos = Math.cos((lat * Math.PI) / 180);
  const lngDelta = latDelta / (Math.abs(cos) > 0.2 ? Math.abs(cos) : 0.2);
  return {
    latitude: lat,
    longitude: lng,
    latitudeDelta: latDelta,
    longitudeDelta: lngDelta,
  };
}

function rnMapType(mt: LeafletMapType): 'standard' | 'satellite' | 'hybrid' {
  if (mt === 'satellite') return 'satellite';
  if (mt === 'hybrid') return 'hybrid';
  return 'standard';
}

/** Спот — риба в акварелен кръг (по-голям от предишния маркер). */
function SpotPin() {
  return (
    <View style={styles.spotPlate}>
      <Ionicons name="fish-outline" size={26} color="#E8F8FF" />
    </View>
  );
}

/** Язовир — „слойове“ върху тъмен диск (водно огледало). */
function DamPin({ name, showLabel }: { name: string; showLabel: boolean }) {
  return (
    <View style={styles.markerCol} accessibilityLabel={name}>
      {showLabel ? (
        <View style={[styles.labelBubble, styles.labelDam]}>
          <Text numberOfLines={1} style={styles.labelTextDam}>
            {name}
          </Text>
        </View>
      ) : null}
      <View style={[styles.iconPlate, styles.plateDam]}>
        <Ionicons name="layers-outline" size={26} color="#C8F0E8" />
      </View>
    </View>
  );
}

/** Река — водно конче в зелен диск. */
function RiverPin({ name, showLabel }: { name: string; showLabel: boolean }) {
  return (
    <View style={styles.markerCol} accessibilityLabel={name}>
      {showLabel ? (
        <View style={[styles.labelBubble, styles.labelRiver]}>
          <Text numberOfLines={1} style={styles.labelTextRiver}>
            {name}
          </Text>
        </View>
      ) : null}
      <View style={[styles.iconPlate, styles.plateRiver]}>
        <Ionicons name="water-outline" size={27} color="#E8FFF2" />
      </View>
    </View>
  );
}

/** Нативна карта — собствени иконки вместо червени пинове; имена при достатъчен zoom. */
export const NativeMapView = forwardRef<LeafletMapHandle, LeafletMapProps>(function NativeMapView(props, ref) {
  const {
    spots,
    dams,
    rivers,
    pendingCoord,
    userCoord,
    routeLine,
    mapType,
    onLongPress,
    onMarkerPress,
    onDamPress,
    onRiverPress,
  } = props;

  const mapRef = useRef<MapView>(null);
  const [showWaterLabels, setShowWaterLabels] = useState(false);

  const onRegionChangeComplete = useCallback((region: Region) => {
    setShowWaterLabels(region.latitudeDelta <= LABEL_LAT_DELTA_THRESHOLD);
  }, []);

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
    >
      {spots.map((s) => (
        <Marker
          key={`spot-${s.id}`}
          coordinate={{ latitude: s.latitude, longitude: s.longitude }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
          onPress={() => onMarkerPress(s.id)}
        >
          <SpotPin />
        </Marker>
      ))}
      {dams.map((d) => (
        <Marker
          key={`dam-${d.id}`}
          coordinate={{ latitude: d.latitude, longitude: d.longitude }}
          anchor={{ x: 0.5, y: 1 }}
          tracksViewChanges={showWaterLabels}
          onPress={() => onDamPress(d.id)}
        >
          <DamPin name={d.name} showLabel={showWaterLabels} />
        </Marker>
      ))}
      {rivers.map((r) => (
        <Marker
          key={`river-${r.id}`}
          coordinate={{ latitude: r.latitude, longitude: r.longitude }}
          anchor={{ x: 0.5, y: 1 }}
          opacity={0.95}
          tracksViewChanges={showWaterLabels}
          onPress={() => onRiverPress(r.id)}
        >
          <RiverPin name={r.name} showLabel={showWaterLabels} />
        </Marker>
      ))}
      {pendingCoord ? (
        <Circle
          center={pendingCoord}
          radius={100}
          strokeWidth={3}
          strokeColor="#D64545"
          fillColor="rgba(255, 144, 143, 0.95)"
        />
      ) : null}
      {userCoord ? (
        <Circle
          center={userCoord}
          radius={82}
          strokeWidth={3}
          strokeColor="#2E9B5A"
          fillColor="rgba(138, 238, 186, 1)"
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
});

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#DDE8EE' },
  markerCol: { alignItems: 'center' },
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
    elevation: 4,
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
    elevation: 5,
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
    elevation: 5,
  },
});
