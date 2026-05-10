// Leaflet 地図表示モジュール
// leaflet-src.esm.js は名前空間exportのため `* as L` で受ける(default exportではない)
import * as L from 'leaflet';

const GSI_TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png';
const GSI_ATTRIBUTION =
  '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>';

const INITIAL_CENTER = [34.852, 135.476];
const INITIAL_ZOOM = 14;
const MIN_ZOOM = 10;
const MAX_ZOOM = 18;

// ホーム画面の背景地図(箕面大滝中心、z=13)
const HOME_CENTER = [34.853667, 135.472041];
const HOME_ZOOM = 13;

let mapInstance = null;
let homeMapInstance = null;
let bufferLayer = null;
let emergencyLayer = null;
let hikingLayer = null;

// 地図の初期化
export function initMap(containerId) {
  const map = L.map(containerId, {
    center: INITIAL_CENTER,
    zoom: INITIAL_ZOOM,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM
  });

  L.tileLayer(GSI_TILE_URL, {
    attribution: GSI_ATTRIBUTION,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    crossOrigin: true
  }).addTo(map);

  mapInstance = map;
  return map;
}

// ビュー表示直後に呼んでサイズを再計算する(hidden→visible 切替で必須)
export function resizeMap() {
  if (mapInstance) mapInstance.invalidateSize();
}

// ホーム画面の背景地図(箕面大滝中心、z=13)
export function initHomeMap(containerId) {
  if (homeMapInstance) return homeMapInstance;
  const map = L.map(containerId, {
    center: HOME_CENTER,
    zoom: HOME_ZOOM,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    zoomControl: false
  });

  L.tileLayer(GSI_TILE_URL, {
    attribution: GSI_ATTRIBUTION,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    crossOrigin: true
  }).addTo(map);

  homeMapInstance = map;
  return map;
}

export function resizeHomeMap() {
  if (homeMapInstance) homeMapInstance.invalidateSize();
}

// バッファGeoJSON(z=17/z=18)をレイヤーとして追加
export async function loadBuffersLayer(url) {
  if (!mapInstance) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const geo = await res.json();

    bufferLayer = L.geoJSON(geo, {
      style: (feature) => styleForBuffer(feature)
    });
    return bufferLayer;
  } catch (err) {
    console.warn('バッファGeoJSON読込失敗:', err);
    return null;
  }
}

function styleForBuffer(feature) {
  // tile_buffers.geojson は properties.layer に "z17_default"/"z18_optional" を持つ
  const layer = feature?.properties?.layer ?? '';
  if (layer.includes('z18')) {
    return { color: '#16a34a', weight: 1, fillColor: '#22c55e', fillOpacity: 0.15 };
  }
  // z17(およびその他) は青
  return { color: '#1d4ed8', weight: 1, fillColor: '#3b82f6', fillOpacity: 0.15 };
}

export function setBuffersVisible(visible) {
  if (!mapInstance || !bufferLayer) return;
  if (visible) {
    bufferLayer.addTo(mapInstance);
  } else {
    mapInstance.removeLayer(bufferLayer);
  }
}

// 緊急ポイントGeoJSONをレイヤーとして追加
export async function loadEmergencyPointsLayer(url) {
  if (!mapInstance) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const geo = await res.json();

    emergencyLayer = L.geoJSON(geo, {
      pointToLayer: (feature, latlng) =>
        L.circleMarker(latlng, {
          radius: 5,
          color: '#dc2626',
          weight: 1,
          fillColor: '#ef4444',
          fillOpacity: 0.8
        }),
      onEachFeature: (feature, layer) => {
        const p = feature.properties || {};
        const id = p.id ?? p.pointId ?? '';
        const name = p.name ?? '';
        layer.bindPopup(`<strong>${escapeHtml(id)}</strong><br>${escapeHtml(name)}`);
      }
    });
    return emergencyLayer;
  } catch (err) {
    console.warn('緊急ポイントGeoJSON読込失敗:', err);
    return null;
  }
}

export function setEmergencyPointsVisible(visible) {
  if (!mapInstance || !emergencyLayer) return;
  if (visible) {
    emergencyLayer.addTo(mapInstance);
  } else {
    mapInstance.removeLayer(emergencyLayer);
  }
}

// ハイキングコース・スポットGeoJSONをレイヤーとして追加
// (route: LineString → 線、spot: Point → 円マーカー)
export async function loadHikingRoutesLayer(url) {
  if (!mapInstance) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const geo = await res.json();

    hikingLayer = L.geoJSON(geo, {
      style: () => ({
        color: '#ea580c',
        weight: 3,
        opacity: 0.85
      }),
      pointToLayer: (feature, latlng) =>
        L.circleMarker(latlng, {
          radius: 4,
          color: '#0c4a6e',
          weight: 1,
          fillColor: '#bae6fd',
          fillOpacity: 0.9
        }),
      onEachFeature: (feature, layer) => {
        const p = feature.properties || {};
        if (p.type === 'spot') {
          const id = p.id ?? '';
          const name = p.name ?? '';
          layer.bindPopup(`<strong>${escapeHtml(id)}</strong><br>${escapeHtml(name)}`);
        } else if (p.type === 'route') {
          const id = p.id ?? '';
          const sp = p.startPoint ?? '';
          const ep = p.endPoint ?? '';
          layer.bindPopup(`<strong>${escapeHtml(id)}</strong><br>${escapeHtml(sp)} → ${escapeHtml(ep)}`);
        }
      }
    });
    return hikingLayer;
  } catch (err) {
    console.warn('ハイキングコースGeoJSON読込失敗:', err);
    return null;
  }
}

export function setHikingRoutesVisible(visible) {
  if (!mapInstance || !hikingLayer) return;
  if (visible) {
    hikingLayer.addTo(mapInstance);
  } else {
    mapInstance.removeLayer(hikingLayer);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
