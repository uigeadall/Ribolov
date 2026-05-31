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

  // Dams + rivers GeoJSON for clustering. The whole dataset goes to the source
  // (no manual viewport cull) because MapLibre's native clustering does the
  // grouping internally and only renders cluster bubbles for the actual
  // visible region. The previous per-marker React render + bounds-cull
  // approach drew hundreds of overlapping pins at country zoom — see
  // screenshots from before this change.
  const damsGeoJson = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: dams.map((d) => ({
        type: 'Feature',
        properties: { id: d.id, name: d.name, kind: 'dam' },
        geometry: { type: 'Point', coordinates: [d.longitude, d.latitude] },
      })),
    }),
    [dams],
  );

  const riversGeoJson = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: rivers.map((r) => ({
        type: 'Feature',
        properties: { id: r.id, name: r.name, kind: 'river' },
        geometry: { type: 'Point', coordinates: [r.longitude, r.latitude] },
      })),
    }),
    [rivers],
  );

  // Tap handler shared by both sources: clusters zoom in two levels at the
  // tap point; individual features call back into the host screen with the
  // dam/river id. Cluster expansion via getClusterExpansionZoom would be
  // more precise but is async + adds complexity; +2 levels is what Leaflet's
  // MarkerCluster effectively did and feels natural.
  // GeoJSONSource onPress fires NativeSyntheticEvent<PressEventWithFeatures>.
  // Inferring the parameter type from the prop keeps us in sync with the
  // package's actual signature without re-deriving the (un-exported) alias.
  type WaterPressEvent = Parameters<
    NonNullable<React.ComponentProps<typeof GeoJSONSource>['onPress']>
  >[0];
  const onWaterSourcePress = useCallback(
    (event: WaterPressEvent) => {
      const f = event.nativeEvent.features?.[0];
      const props = f?.properties;
      if (!f || !props) return;
      const geom = f.geometry;
      const coord = geom && 'coordinates' in geom ? (geom.coordinates as number[]) : undefined;
      if (props.cluster && coord && coord.length === 2) {
        cameraRef.current?.flyTo({
          center: [coord[0]!, coord[1]!],
          zoom: Math.min(14, zoom + 2),
          duration: 400,
        });
        return;
      }
      const id = props.id as string | undefined;
      const kind = props.kind as string | undefined;
      if (!id) return;
      if (kind === 'dam') onDamPress(id);
      else if (kind === 'river') onRiverPress(id);
    },
    [zoom, onDamPress, onRiverPress],
  );

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

      {/* Dams — clustered GeoJSON source. clusterMaxZoomLevel: 12 means at
          zoom ≥13 individual pins show; below that, count bubbles appear.
          clusterRadius: 60 collapses pins within 60px of each other. Same
          UX as the old Leaflet MarkerCluster engine. */}
      {damsGeoJson.features.length > 0 ? (
        <GeoJSONSource
          id="dams-src"
          data={damsGeoJson}
          cluster
          clusterMaxZoom={12}
          clusterRadius={60}
          onPress={onWaterSourcePress}
        >
          {/* Cluster bubbles — navy circle, stepped radius by count */}
          <Layer
            id="dams-cluster-circle"
            type="circle"
            source="dams-src"
            filter={['has', 'point_count']}
            paint={{
              'circle-color': '#062D3D',
              'circle-radius': [
                'step',
                ['get', 'point_count'],
                18,
                5, 22,
                15, 26,
                30, 32,
              ],
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 3,
              'circle-opacity': 0.95,
            }}
          />
          {/* Cluster count label */}
          <Layer
            id="dams-cluster-count"
            type="symbol"
            source="dams-src"
            filter={['has', 'point_count']}
            layout={{
              'text-field': ['get', 'point_count_abbreviated'],
              'text-size': 13,
              'text-allow-overlap': true,
              'text-ignore-placement': true,
            }}
            paint={{ 'text-color': '#ffffff' }}
          />
          {/* Individual dam pins — small navy dots at high zoom */}
          <Layer
            id="dams-point"
            type="circle"
            source="dams-src"
            filter={['!', ['has', 'point_count']]}
            paint={{
              'circle-color': '#062D3D',
              'circle-radius': 9,
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 2.5,
              'circle-opacity': 0.95,
            }}
          />
          {/* Dam name label — visible at zoom ≥ 13 (above clusterMaxZoom).
              text-allow-overlap: false lets MapLibre's collision detection
              hide labels that would overlap, keeping the map readable when
              many dams sit close together. text-halo gives crisp legibility
              over OSM background tiles. */}
          <Layer
            id="dams-label"
            type="symbol"
            source="dams-src"
            filter={['!', ['has', 'point_count']]}
            minzoom={13}
            layout={{
              'text-field': ['get', 'name'],
              'text-size': 12,
              'text-offset': [0, 1.2],
              'text-anchor': 'top',
              'text-allow-overlap': false,
              'text-optional': true,
            }}
            paint={{
              'text-color': '#062D3D',
              'text-halo-color': '#ffffff',
              'text-halo-width': 1.5,
            }}
          />
        </GeoJSONSource>
      ) : null}

      {/* Rivers — same pattern, green color scheme */}
      {riversGeoJson.features.length > 0 ? (
        <GeoJSONSource
          id="rivers-src"
          data={riversGeoJson}
          cluster
          clusterMaxZoom={12}
          clusterRadius={60}
          onPress={onWaterSourcePress}
        >
          <Layer
            id="rivers-cluster-circle"
            type="circle"
            source="rivers-src"
            filter={['has', 'point_count']}
            paint={{
              'circle-color': '#2E9B5A',
              'circle-radius': [
                'step',
                ['get', 'point_count'],
                18,
                5, 22,
                15, 26,
                30, 32,
              ],
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 3,
              'circle-opacity': 0.95,
            }}
          />
          <Layer
            id="rivers-cluster-count"
            type="symbol"
            source="rivers-src"
            filter={['has', 'point_count']}
            layout={{
              'text-field': ['get', 'point_count_abbreviated'],
              'text-size': 13,
              'text-allow-overlap': true,
              'text-ignore-placement': true,
            }}
            paint={{ 'text-color': '#ffffff' }}
          />
          <Layer
            id="rivers-point"
            type="circle"
            source="rivers-src"
            filter={['!', ['has', 'point_count']]}
            paint={{
              'circle-color': '#2E9B5A',
              'circle-radius': 9,
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 2.5,
              'circle-opacity': 0.95,
            }}
          />
          {/* River name label — same shape as dams-label but green text. */}
          <Layer
            id="rivers-label"
            type="symbol"
            source="rivers-src"
            filter={['!', ['has', 'point_count']]}
            minzoom={13}
            layout={{
              'text-field': ['get', 'name'],
              'text-size': 12,
              'text-offset': [0, 1.2],
              'text-anchor': 'top',
              'text-allow-overlap': false,
              'text-optional': true,
            }}
            paint={{
              'text-color': '#0f3d21',
              'text-halo-color': '#ffffff',
              'text-halo-width': 1.5,
            }}
          />
        </GeoJSONSource>
      ) : null}

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
