import type { ForwardRefExoticComponent, RefAttributes } from 'react';
import { MAP_ENGINE } from '../config/mapEngine';
import { LeafletMap, type LeafletMapHandle, type LeafletMapProps } from './LeafletMap';
import { NativeMapView } from './NativeMapView';

type MapEngineComp = ForwardRefExoticComponent<LeafletMapProps & RefAttributes<LeafletMapHandle>>;

// MapLibre is lazy-required so its native module is never loaded unless
// MAP_ENGINE === 'maplibre'. Without this gate, Expo Go (which lacks
// MLRNCameraModule) crashes at startup just from the import statement.
// To actually use MapLibre, rebuild the dev client: `npx expo run:ios`.
export const MapEngineComponent: MapEngineComp =
  MAP_ENGINE === 'maplibre'
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./MapLibreMap').MapLibreMap
    : MAP_ENGINE === 'native'
      ? NativeMapView
      : LeafletMap;
