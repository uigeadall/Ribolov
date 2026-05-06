import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import WebView from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import type { Spot } from '../types';
import type { Dam } from '../data/dams';
import type { River } from '../data/rivers';

export type LeafletMapType = 'standard' | 'satellite' | 'hybrid';

export type LeafletMapHandle = {
  flyTo: (lat: number, lng: number, zoom?: number) => void;
};

type Props = {
  spots: Spot[];
  dams: Dam[];
  rivers: River[];
  pendingCoord: { latitude: number; longitude: number } | null;
  userCoord: { latitude: number; longitude: number } | null;
  /** Полилиния по пътища (lng/lat точки от OSRM и др.), или null за скриване */
  routeLine?: { latitude: number; longitude: number }[] | null;
  mapType: LeafletMapType;
  onLongPress: (lat: number, lng: number) => void;
  onMarkerPress: (id: string) => void;
  onDamPress: (id: string) => void;
  onRiverPress: (id: string) => void;
};

export type LeafletMapProps = Props;

const MAP_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
html,body,#map{margin:0;padding:0;height:100%;width:100%;}
.leaflet-tooltip.wt-dam{background:rgba(255,255,255,0.96)!important;border:2px solid #062D3D!important;color:#062D3D;font-weight:700;font-size:12px;padding:4px 9px;border-radius:7px;box-shadow:0 2px 8px rgba(0,0,0,.22);}
.leaflet-tooltip.wt-river{background:rgba(236,255,242,0.96)!important;border:2px solid #1e6b3d!important;color:#0f3d21;font-weight:700;font-size:12px;padding:4px 9px;border-radius:7px;box-shadow:0 2px 8px rgba(0,0,0,.22);}
.wt-div-icon{background:transparent!important;border:none!important;}
</style>
</head><body>
<div id="map"></div>
<script>
(function(){
  function POST(o){ try{ window.ReactNativeWebView.postMessage(JSON.stringify(o)); }catch(e){} }
  var map = L.map('map', { zoomControl: true }).setView([42.65, 25.35], 7);
  var layers = {};
  layers.standard = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19});
  layers.satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19});
  layers.labels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',{maxZoom:19});
  var activeBase = layers.standard.addTo(map);

  map.on('zoomend', function(){ POST({type:'zoom', z: map.getZoom()}); });

  function damPin(){ return L.divIcon({
    className:'wt-div-icon',
    html:'<svg width="28" height="30" viewBox="0 0 28 30" xmlns="http://www.w3.org/2000/svg"><defs><filter id="sd"><feDropShadow dx="0" dy="1.5" stdDeviation="1.5" flood-opacity=".4"/></filter></defs><ellipse cx="14" cy="21" rx="11" ry="7" fill="#1A7A9C" stroke="#fff" stroke-width="2.5" filter="url(#sd)"/><rect x="4" y="5" width="20" height="11" rx="3" fill="#062D3D" stroke="#fff" stroke-width="2.5" filter="url(#sd)"/><path d="M10 10h8M14 7v6" stroke="#8AEEBA" stroke-width="1.8" stroke-linecap="round"/></svg>',
    iconSize:[28,30],
    iconAnchor:[14,30]
  });}
  function riverPin(){ return L.divIcon({
    className:'wt-div-icon',
    html:'<svg width="30" height="32" viewBox="0 0 30 32" xmlns="http://www.w3.org/2000/svg"><defs><filter id="sr"><feDropShadow dx="0" dy="1.5" stdDeviation="1.5" flood-opacity=".4"/></filter></defs><path d="M15 4 C22 10 24 14 15 28 C6 14 8 10 15 4 Z" fill="#2E9B5A" stroke="#fff" stroke-width="2.5" filter="url(#sr)"/><path d="M9 14 Q15 10 21 14 Q15 19 9 14" fill="none" stroke="#C8F5D9" stroke-width="2" stroke-linecap="round"/></svg>',
    iconSize:[30,32],
    iconAnchor:[15,31]
  });}
  function spotPin(){ return L.divIcon({
    className:'wt-div-icon',
    html:'<svg width="30" height="30" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg"><defs><filter id="ss"><feDropShadow dx="0" dy="1.5" stdDeviation="1.6" flood-opacity=".42"/></filter></defs><circle cx="15" cy="15" r="13" fill="#1A7A9C" stroke="#fff" stroke-width="2.5" filter="url(#ss)"/><path d="M8 15c2.5-4 6.5-5 10-3 2 1 3 3 3 5 0 4-3 6-6 7l1.5-3c2-.8 3.5-2.5 3.5-4.5 0-3-3.5-4.5-6-3-2 1-3 3-3 5 0 2.5 2 4 4 4.5v1.5c-5-.8-8.5-4-8.5-8.5z" fill="#E8F4FA"/></svg>',
    iconSize:[30,30],
    iconAnchor:[15,15]
  });}

  var spotMarkers = [];
  var damMarkers = [];
  var riverMarkers = [];
  var pendMarker = null;
  var userMarker = null;
  var lpTimer = null;

  function clearArr(arr){
    arr.forEach(function(m){ map.removeLayer(m); });
    arr.length = 0;
  }

  function applyMapType(mt){
    if(window.__labelsOn){ map.removeLayer(layers.labels); window.__labelsOn=false; }
    map.removeLayer(activeBase);
    if(mt === 'satellite'){
      activeBase = layers.satellite.addTo(map);
    } else if(mt === 'hybrid'){
      activeBase = layers.satellite.addTo(map);
      layers.labels.addTo(map);
      window.__labelsOn = true;
    } else {
      activeBase = layers.standard.addTo(map);
    }
  }

  window.__refreshMarkersFromRn = function(payload){
    applyMapType(payload.mapType || 'standard');
    var mz = typeof payload.zoom === 'number' ? payload.zoom : 7;
    var showNames = mz >= 12;

    clearArr(spotMarkers);
    (payload.spots||[]).forEach(function(s){
      var m = L.marker([s.latitude,s.longitude], { icon: spotPin(), interactive:true })
        .addTo(map)
        .on('click', function(){ POST({type:'spot', id:s.id}); });
      spotMarkers.push(m);
    });

    clearArr(damMarkers);
    (payload.dams||[]).forEach(function(d){
      var m = L.marker([d.latitude,d.longitude], { icon: damPin(), interactive:true })
        .addTo(map)
        .on('click', function(){ POST({type:'dam', id:d.id}); });
      if(showNames){ m.bindTooltip(d.name, { permanent:true, direction:'top', className:'wt-dam', offset:[0,-14] }); }
      damMarkers.push(m);
    });

    clearArr(riverMarkers);
    (payload.rivers||[]).forEach(function(r){
      var m = L.marker([r.latitude,r.longitude], { icon: riverPin(), opacity: 0.95 })
        .addTo(map)
        .on('click', function(){ POST({type:'river', id:r.id}); });
      if(showNames){ m.bindTooltip(r.name, { permanent:true, direction:'top', className:'wt-river', offset:[0,-14] }); }
      riverMarkers.push(m);
    });

    if(pendMarker){ map.removeLayer(pendMarker); pendMarker=null; }
    if(payload.pending){
      pendMarker = L.circleMarker([payload.pending.latitude,payload.pending.longitude],{radius:11,color:'#D64545',fillColor:'#FF908F',fillOpacity:0.95,weight:3}).addTo(map);
    }

    if(userMarker){ map.removeLayer(userMarker); userMarker=null; }
    if(payload.user){
      userMarker = L.circleMarker([payload.user.latitude,payload.user.longitude],{radius:10,color:'#2E9B5A',fillColor:'#8AEEBA',fillOpacity:1,weight:3}).addTo(map);
    }

    if(window.__routeLayer){ map.removeLayer(window.__routeLayer); window.__routeLayer=null; }
    if(payload.route && payload.route.length >= 2){
      var latlngs = payload.route.map(function(p){ return [p.latitude,p.longitude]; });
      window.__routeLayer = L.polyline(latlngs,{color:'#0E4D64',weight:6,opacity:0.92,lineJoin:'round',lineCap:'round'}).addTo(map);
      try{ map.fitBounds(window.__routeLayer.getBounds(),{padding:[48,48],maxZoom:13}); }catch(e3){}
    }
  };

  window.__flyTo = function(lat,lng,z){
    map.setView([lat,lng], z||13);
  };

  var el = map.getContainer();
  el.addEventListener('touchstart', function(ev){
    if(ev.touches.length!==1) return;
    var t = ev.touches[0];
    lpTimer = setTimeout(function(){
      var rect = el.getBoundingClientRect();
      var x = t.clientX - rect.left;
      var y = t.clientY - rect.top;
      var latlng = map.containerPointToLatLng(L.point(x,y));
      POST({type:'longpress', lat: latlng.lat, lng: latlng.lng});
    }, 720);
  }, {passive:true});
  ['touchend','touchcancel'].forEach(function(ev){
    el.addEventListener(ev, function(){ clearTimeout(lpTimer); lpTimer=null; }, {passive:true});
  });

  POST({type:'ready'});
})();
</script>
</body></html>`;

export const LeafletMap = forwardRef<LeafletMapHandle, Props>(function LeafletMap(props, ref) {
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
  const webRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const [webZoom, setWebZoom] = useState(7);

  const payloadJson = useMemo(
    () =>
      JSON.stringify({
        spots,
        dams,
        rivers,
        pending: pendingCoord,
        user: userCoord,
        route: routeLine ?? null,
        mapType,
        zoom: webZoom,
      }),
    [spots, dams, rivers, pendingCoord, userCoord, routeLine, mapType, webZoom]
  );

  const injectRefresh = useCallback(() => {
    webRef.current?.injectJavaScript(`
      try {
        var payload = ${payloadJson};
        if(window.__refreshMarkersFromRn) window.__refreshMarkersFromRn(payload);
      } catch(e) {}
      true;
    `);
  }, [payloadJson]);

  useEffect(() => {
    if (readyRef.current) injectRefresh();
  }, [injectRefresh]);

  useImperativeHandle(ref, () => ({
    flyTo: (lat: number, lng: number, zoom = 13) => {
      webRef.current?.injectJavaScript(`
        window.__flyTo && window.__flyTo(${lat},${lng},${zoom});
        true;
      `);
    },
  }));

  const onMsg = useCallback(
    (e: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(e.nativeEvent.data) as {
          type: string;
          id?: string;
          lat?: number;
          lng?: number;
          z?: number;
        };
        if (msg.type === 'ready') {
          readyRef.current = true;
          injectRefresh();
        } else if (msg.type === 'zoom' && typeof msg.z === 'number') {
          setWebZoom(msg.z);
        } else if (msg.type === 'longpress' && msg.lat != null && msg.lng != null) {
          onLongPress(msg.lat, msg.lng);
        } else if (msg.type === 'spot' && msg.id) onMarkerPress(msg.id);
        else if (msg.type === 'dam' && msg.id) onDamPress(msg.id);
        else if (msg.type === 'river' && msg.id) onRiverPress(msg.id);
      } catch {
        /* ignore */
      }
    },
    [injectRefresh, onLongPress, onMarkerPress, onDamPress, onRiverPress]
  );

  return (
    <WebView
      ref={webRef}
      style={styles.fill}
      originWhitelist={['*']}
      source={{ html: MAP_HTML }}
      onMessage={onMsg}
      javaScriptEnabled
      domStorageEnabled
    />
  );
});

const styles = StyleSheet.create({ fill: { flex: 1, backgroundColor: '#DDE8EE' } });
