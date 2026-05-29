import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  Layer,
  Map,
  type MapRef,
  Marker,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native';
import type { LngLatBounds } from '@maplibre/maplibre-react-native';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { NativeSyntheticEvent } from 'react-native';
import type {
  CatchMapMarker,
  HeatmapCell,
  LeafletMapHandle,
  LeafletMapProps,
  LeafletMapType,
} from './LeafletMap';

// ── Map styles ───────────────────────────────────────────────────────────────
// Standard uses OpenFreeMap (vector, free, no API key). Satellite + hybrid
// use Esri World Imagery raster tiles — matches the Leaflet engine so users
// see the same imagery when switching engines.

const OPENFREEMAP_LIBERTY = 'https://tiles.openfreemap.org/styles/liberty';

const ESRI_IMAGERY_TILE =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_LABELS_TILE =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'esri-imagery': {
      type: 'raster',
      tiles: [ESRI_IMAGERY_TILE],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Tiles © Esri',
    },
  },
  layers: [{ id: 'esri-imagery', type: 'raster', source: 'esri-imagery' }],
};

const HYBRID_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'esri-imagery': {
      type: 'raster',
      tiles: [ESRI_IMAGERY_TILE],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Tiles © Esri',
    },
    'esri-labels': {
      type: 'raster',
      tiles: [ESRI_LABELS_TILE],
      tileSize: 256,
      maxzoom: 19,
    },
  },
  layers: [
    { id: 'esri-imagery', type: 'raster', source: 'esri-imagery' },
    { id: 'esri-labels', type: 'raster', source: 'esri-labels' },
  ],
};

function styleForMapType(mt: LeafletMapType): string | StyleSpecification {
  if (mt === 'satellite') return SATELLITE_STYLE;
  if (mt === 'hybrid') return HYBRID_STYLE;
  return OPENFREEMAP_LIBERTY;
}

// ── Geo helpers ──────────────────────────────────────────────────────────────

const CULL_BUFFER = 0.25;
const LABEL_ZOOM_THRESHOLD = 12;

const EARTH_RADIUS_M = 6_378_137;

/** Build a 32-sided polygon approximating a circle of `radiusMeters` around
 *  [lng, lat]. Used for heatmap cells so they keep a fixed geographic size,
 *  matching the Leaflet / react-native-maps behavior. */
function circleToPolygon(
  lng: number,
  lat: number,
  radiusMeters: number,
  sides = 32,
): [number, number][] {
  const coords: [number, number][] = [];
  const latRad = (lat * Math.PI) / 180;
  const dLat = (radiusMeters / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLng = dLat / Math.max(Math.cos(latRad), 0.01);
  for (let i = 0; i <= sides; i++) {
    const angle = (i / sides) * 2 * Math.PI;
    coords.push([lng + dLng * Math.cos(angle), lat + dLat * Math.sin(angle)]);
  }
  return coords;
}

function heatColor(ownerCount: number): string {
  if (ownerCount >= 10) return '#C92A2A';
  if (ownerCount >= 6) return '#E85D04';
  return '#F7B731';
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SpotPin() {
  return (
    <View style={styles.spotPlate}>
      <Ionicons name="fish-outline" size={20} color="#E8F8FF" />
    </View>
  );
}

function WaterPin({
  name,
  showLabel,
  type,
}: {
  name: string;
  showLabel: boolean;
  type: 'dam' | 'river';
}) {
  return (
    <View style={styles.markerCol}>
      {showLabel ? (
        <View style={[styles.labelBubble, type === 'dam' ? styles.labelDam : styles.labelRiver]}>
          <Text
            numberOfLines={1}
            style={type === 'dam' ? styles.labelTextDam : styles.labelTextRiver}
          >
            {name}
          </Text>
        </View>
      ) : null}
      <View style={[styles.iconPlate, type === 'dam' ? styles.plateDam : styles.plateRiver]}>
        <Ionicons
          name={type === 'dam' ? 'layers-outline' : 'water-outline'}
          size={20}
          color={type === 'dam' ? '#C8F0E8' : '#E8FFF2'}
        />
      </View>
    </View>
  );
}

function LiveFishingPin() {
  return (
    <View style={styles.livePlate}>
      <Ionicons name="flame" size={18} color="#FFF6D8" />
    </View>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export const MapLibreMap = forwardRef<LeafletMapHandle, LeafletMapProps>(function MapLibreMap(
  props,
  ref,
) {
  const {
    spots,
    dams,
    rivers,
    catchMarkers,
    heatmapCells,
    liveFishingMarkers,
    pendingCoord,
    userCoord,
    routeLine,
    mapType,
    onLongPress,
    onMarkerPress,
    onDamPress,
    onRiverPress,
    onLivePinPress,
    onMapMove,
  } = props;

  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);

  // Viewport state — used for marker culling and label visibility.
  const [center, setCenter] = useState<[number, number]>([25.35, 42.65]);
  const [zoom, setZoom] = useState(7);
  const [bounds, setBounds] = useState<LngLatBounds | null>(null);

  const showWaterLabels = zoom >= LABEL_ZOOM_THRESHOLD;

  useImperativeHandle(
    ref,
    () => ({
      flyTo: (lat, lng, z = 13) => {
        cameraRef.current?.flyTo({
          center: [lng, lat],
          zoom: z,
          duration: 600,
        });
      },
    }),
    [],
  );

  // Fit camera to route polyline whenever it changes.
  useEffect(() => {
    if (!routeLine || routeLine.length < 2) return;
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const p of routeLine) {
      if (p.longitude < minLng) minLng = p.longitude;
      if (p.longitude > maxLng) maxLng = p.longitude;
      if (p.latitude < minLat) minLat = p.latitude;
      if (p.latitude > maxLat) maxLat = p.latitude;
    }
    const t = setTimeout(() => {
      // LngLatBounds is flat [west, south, east, north].
      cameraRef.current?.fitBounds([minLng, minLat, maxLng, maxLat], {
        padding: { top: 120, right: 48, bottom: 180, left: 48 },
        duration: 600,
      });
    }, 400);
    return () => clearTimeout(t);
  }, [routeLine]);

  const onRegionDidChange = useCallback(
    (e: NativeSyntheticEvent<ViewStateChangeEvent>) => {
      const { center: c, zoom: z, bounds: b } = e.nativeEvent;
      setCenter(c);
      setZoom(z);
      setBounds(b);
      onMapMove?.(c[1], c[0], z);
    },
    [onMapMove],
  );

  const onMapLongPress = useCallback(
    (e: NativeSyntheticEvent<{ lngLat: [number, number] }>) => {
      const [lng, lat] = e.nativeEvent.lngLat;
      onLongPress(lat, lng);
    },
    [onLongPress],
  );

  // Cull dams/rivers to the visible bounds + buffer to avoid mounting thousands
  // of <Marker>s off-screen (large for Bulgaria's full river dataset).
  const visibleDams = useMemo(() => {
    if (!bounds) return dams;
    const [west, south, east, north] = bounds;
    return dams.filter(
      (d) =>
        d.longitude >= west - CULL_BUFFER &&
        d.longitude <= east + CULL_BUFFER &&
        d.latitude >= south - CULL_BUFFER &&
        d.latitude <= north + CULL_BUFFER,
    );
  }, [dams, bounds]);

  const visibleRivers = useMemo(() => {
    if (!bounds) return rivers;
    const [west, south, east, north] = bounds;
    return rivers.filter(
      (r) =>
        r.longitude >= west - CULL_BUFFER &&
        r.longitude <= east + CULL_BUFFER &&
        r.latitude >= south - CULL_BUFFER &&
        r.latitude <= north + CULL_BUFFER,
    );
  }, [rivers, bounds]);

  // GeoJSON for catch markers — rendered as a CircleLayer for performance
  // when many catches are visible at once.
  const catchGeoJson = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: (catchMarkers ?? []).map((c: CatchMapMarker) => ({
        type: 'Feature',
        properties: {
          id: c.id,
          label: c.speciesName + (c.weightKg ? ' ' + c.weightKg + ' кг' : ''),
        },
        geometry: { type: 'Point', coordinates: [c.longitude, c.latitude] },
      })),
    }),
    [catchMarkers],
  );

  // Heatmap as filled polygons so the radius stays geographic (matches the
  // 2200m radius the other engines use).
  const heatmapGeoJson = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: (heatmapCells ?? []).map((h: HeatmapCell, i) => ({
        type: 'Feature',
        properties: { idx: i, color: heatColor(h.ownerCount) },
        geometry: {
          type: 'Polygon',
          coordinates: [circleToPolygon(h.longitude, h.latitude, 2200)],
        },
      })),
    }),
    [heatmapCells],
  );

  const routeGeoJson = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!routeLine || routeLine.length < 2) return null;
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: routeLine.map((p) => [p.longitude, p.latitude]),
          },
        },
      ],
    };
  }, [routeLine]);

  return (
    <Map
      ref={mapRef}
      style={styles.fill}
      mapStyle={styleForMapType(mapType)}
      compass={false}
      attribution
      attributionPosition={{ bottom: 8, right: 8 }}
      logo={false}
      touchRotate={false}
      touchPitch={false}
      onLongPress={onMapLongPress}
      onRegionDidChange={onRegionDidChange}
    >
      <Camera
        ref={cameraRef}
        initialViewState={{ center: [25.35, 42.65], zoom: 7 }}
      />

      {/* Heatmap polygons (rendered below markers) */}
      {heatmapGeoJson.features.length > 0 ? (
        <GeoJSONSource id="heatmap-src" data={heatmapGeoJson}>
          <Layer
            id="heatmap-fill"
            type="fill"
            source="heatmap-src"
            paint={{ 'fill-color': ['get', 'color'], 'fill-opacity': 0.32 }}
          />
          <Layer
            id="heatmap-outline"
            type="line"
            source="heatmap-src"
            paint={{
              'line-color': ['get', 'color'],
              'line-width': 1.2,
              'line-opacity': 0.65,
            }}
          />
        </GeoJSONSource>
      ) : null}

      {/* Route line */}
      {routeGeoJson ? (
        <GeoJSONSource id="route-src" data={routeGeoJson}>
          <Layer
            id="route-line"
            type="line"
            source="route-src"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': '#0E4D64', 'line-width': 6, 'line-opacity': 0.92 }}
          />
        </GeoJSONSource>
      ) : null}

      {/* Catch markers — orange circles, fixed pixel radius */}
      {catchGeoJson.features.length > 0 ? (
        <GeoJSONSource id="catches-src" data={catchGeoJson}>
          <Layer
            id="catches-circle"
            type="circle"
            source="catches-src"
            paint={{
              'circle-radius': 9,
              'circle-color': '#FF8533',
              'circle-stroke-color': '#E85D04',
              'circle-stroke-width': 2.5,
              'circle-opacity': 0.88,
            }}
          />
        </GeoJSONSource>
      ) : null}

      {/* Spot markers */}
      {spots.map((s) => (
        <Marker
          key={`spot-${s.id}`}
          id={`spot-${s.id}`}
          lngLat={[s.longitude, s.latitude]}
          anchor="center"
          onPress={() => onMarkerPress(s.id)}
        >
          <SpotPin />
        </Marker>
      ))}

      {/* Dams */}
      {visibleDams.map((d) => (
        <Marker
          key={`dam-${d.id}`}
          id={`dam-${d.id}`}
          lngLat={[d.longitude, d.latitude]}
          anchor="bottom"
          onPress={() => onDamPress(d.id)}
        >
          <WaterPin name={d.name} showLabel={showWaterLabels} type="dam" />
        </Marker>
      ))}

      {/* Rivers */}
      {visibleRivers.map((r) => (
        <Marker
          key={`river-${r.id}`}
          id={`river-${r.id}`}
          lngLat={[r.longitude, r.latitude]}
          anchor="bottom"
          onPress={() => onRiverPress(r.id)}
        >
          <WaterPin name={r.name} showLabel={showWaterLabels} type="river" />
        </Marker>
      ))}

      {/* Live fishing pins */}
      {(liveFishingMarkers ?? []).map((p) => (
        <Marker
          key={`live-${p.id}`}
          id={`live-${p.id}`}
          lngLat={[p.longitude, p.latitude]}
          anchor="bottom"
          onPress={() => onLivePinPress?.(p.id)}
        >
          <LiveFishingPin />
        </Marker>
      ))}

      {/* Pending tap location */}
      {pendingCoord ? (
        <Marker
          id="pending"
          lngLat={[pendingCoord.longitude, pendingCoord.latitude]}
          anchor="center"
        >
          <View style={styles.pendingDot} />
        </Marker>
      ) : null}

      {/* User location */}
      {userCoord ? (
        <Marker id="user" lngLat={[userCoord.longitude, userCoord.latitude]} anchor="center">
          <View style={styles.userDot} />
        </Marker>
      ) : null}
    </Map>
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
  pendingDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FF908F',
    borderWidth: 3,
    borderColor: '#D64545',
  },
  userDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#8AEEBA',
    borderWidth: 3,
    borderColor: '#2E9B5A',
  },
});
