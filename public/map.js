// Leaflet 地図表示モジュール
// leaflet-src.esm.js は名前空間exportのため `* as L` で受ける(default exportではない)
import * as L from 'leaflet';

const GSI_TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png';
const GSI_ATTRIBUTION =
  '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>';

// 起動時の中心は箕面大滝、z=15(ホーム/マップビュー共通の単一マップ)
const INITIAL_CENTER = [34.853667, 135.472041];
const INITIAL_ZOOM = 15;
const MIN_ZOOM = 10;
const MAX_ZOOM = 18;

let mapInstance = null;
let bufferLayer = null;

// 緊急ポイント: GeoJSON とレイヤー、現在のスタイルを保持
let emergencyGeoJSON = null;
let emergencyLayer = null;
let emergencyStyle = null;

// ハイキング(ルート+スポット): GeoJSON とレイヤー、ルート/スポット双方のスタイルを保持
let hikingGeoJSON = null;
let hikingLayer = null;
let hikingRouteStyle = null;
let hikingSpotStyle = null;

// 地図の初期化
// 右下に下から: 国土地理院クレジット(attribution) → スケール(metric) → ズームボタン
export function initMap(containerId) {
  const map = L.map(containerId, {
    center: INITIAL_CENTER,
    zoom: INITIAL_ZOOM,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    zoomControl: false,
    attributionControl: false
  });

  L.tileLayer(GSI_TILE_URL, {
    attribution: GSI_ATTRIBUTION,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    crossOrigin: true
  }).addTo(map);

  // bottomright は後から追加したものほど上に積まれる。
  // 期待する並び(上から): zoom → scale → attribution なので、逆順に追加する。
  L.control.attribution({ position: 'bottomright' }).addTo(map);
  L.control.scale({ position: 'bottomright', metric: true, imperial: false, maxWidth: 150 }).addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  mapInstance = map;
  return map;
}

// ビュー表示直後に呼んでサイズを再計算する(hidden→visible 切替で必須)
export function resizeMap() {
  if (mapInstance) mapInstance.invalidateSize();
}

// ===== マーカー形状の生成 =====
function shapeToSVG(shape, color, size) {
  const s = Math.max(4, Math.min(80, size || 10));
  const c = s / 2;
  const r = (s - 2) / 2;
  const stroke = '#ffffff';
  switch (shape) {
    case 'circle':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><circle cx="${c}" cy="${c}" r="${r}" fill="${color}" stroke="${stroke}" stroke-width="1"/></svg>`;
    case 'square':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><rect x="1" y="1" width="${s - 2}" height="${s - 2}" fill="${color}" stroke="${stroke}" stroke-width="1"/></svg>`;
    case 'triangle': {
      const pts = `${c},1 ${s - 1},${s - 1} 1,${s - 1}`;
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><polygon points="${pts}" fill="${color}" stroke="${stroke}" stroke-width="1"/></svg>`;
    }
    case 'diamond': {
      const pts = `${c},1 ${s - 1},${c} ${c},${s - 1} 1,${c}`;
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><polygon points="${pts}" fill="${color}" stroke="${stroke}" stroke-width="1"/></svg>`;
    }
    case 'star':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><polygon points="${starPoints(s)}" fill="${color}" stroke="${stroke}" stroke-width="1"/></svg>`;
    case 'line':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><line x1="1" y1="${c}" x2="${s - 1}" y2="${c}" stroke="${color}" stroke-width="${Math.max(2, Math.round(s / 3))}"/></svg>`;
    default:
      return shapeToSVG('circle', color, size);
  }
}

function starPoints(s) {
  const cx = s / 2;
  const cy = s / 2;
  const outerR = (s - 2) / 2;
  const innerR = outerR * 0.4;
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    pts.push(`${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)}`);
  }
  return pts.join(' ');
}

function createPointMarker(latlng, style) {
  const size = Math.max(4, Math.min(80, style?.size || 10));
  const icon = L.divIcon({
    html: shapeToSVG(style?.shape || 'circle', style?.color || '#dc2626', size),
    className: 'custom-marker',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
  return L.marker(latlng, { icon });
}

// ===== バッファ =====
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
  const layer = feature?.properties?.layer ?? '';
  if (layer.includes('z18')) {
    return { color: '#16a34a', weight: 1, fillColor: '#22c55e', fillOpacity: 0.15 };
  }
  return { color: '#1d4ed8', weight: 1, fillColor: '#3b82f6', fillOpacity: 0.15 };
}

export function setBuffersVisible(visible) {
  if (!mapInstance || !bufferLayer) return;
  if (visible) bufferLayer.addTo(mapInstance);
  else mapInstance.removeLayer(bufferLayer);
}

// ===== 緊急ポイント =====
export async function loadEmergencyPointsLayer(url, style) {
  if (!mapInstance) return null;
  // ユーザーが先に設定変更していたらそちらを優先(load完了前の race 対策)
  emergencyStyle = emergencyStyle || style;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    emergencyGeoJSON = await res.json();
    emergencyLayer = buildEmergencyLayer();
    return emergencyLayer;
  } catch (err) {
    console.warn('緊急ポイントGeoJSON読込失敗:', err);
    return null;
  }
}

function buildEmergencyLayer() {
  return L.geoJSON(emergencyGeoJSON, {
    pointToLayer: (feature, latlng) => createPointMarker(latlng, emergencyStyle),
    onEachFeature: (feature, layer) => {
      const p = feature.properties || {};
      const id = p.id ?? p.pointId ?? '';
      const name = p.name ?? '';
      layer.bindPopup(`<strong>${escapeHtml(id)}</strong><br>${escapeHtml(name)}`);
    }
  });
}

export function setEmergencyStyle(style) {
  emergencyStyle = style;
  if (!emergencyGeoJSON || !mapInstance) return;
  const wasVisible = emergencyLayer && mapInstance.hasLayer(emergencyLayer);
  if (emergencyLayer) mapInstance.removeLayer(emergencyLayer);
  emergencyLayer = buildEmergencyLayer();
  if (wasVisible) emergencyLayer.addTo(mapInstance);
}

export function setEmergencyPointsVisible(visible) {
  if (!mapInstance || !emergencyLayer) return;
  if (visible) emergencyLayer.addTo(mapInstance);
  else mapInstance.removeLayer(emergencyLayer);
}

// ===== ハイキング(ルート+スポット) =====
// routeStyle は LineString に、spotStyle は Point に適用
export async function loadHikingRoutesLayer(url, routeStyle, spotStyle) {
  if (!mapInstance) return null;
  hikingRouteStyle = hikingRouteStyle || routeStyle;
  hikingSpotStyle = hikingSpotStyle || spotStyle;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    hikingGeoJSON = await res.json();
    hikingLayer = buildHikingLayer();
    return hikingLayer;
  } catch (err) {
    console.warn('ハイキングコースGeoJSON読込失敗:', err);
    return null;
  }
}

function buildHikingLayer() {
  return L.geoJSON(hikingGeoJSON, {
    style: () => ({
      color: hikingRouteStyle?.color || '#ea580c',
      weight: hikingRouteStyle?.size || 3,
      opacity: 0.85
    }),
    pointToLayer: (feature, latlng) => createPointMarker(latlng, hikingSpotStyle),
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
}

export function setHikingRouteStyle(style) {
  hikingRouteStyle = style;
  rebuildHikingLayer();
}

export function setHikingSpotStyle(style) {
  hikingSpotStyle = style;
  rebuildHikingLayer();
}

function rebuildHikingLayer() {
  if (!hikingGeoJSON || !mapInstance) return;
  const wasVisible = hikingLayer && mapInstance.hasLayer(hikingLayer);
  if (hikingLayer) mapInstance.removeLayer(hikingLayer);
  hikingLayer = buildHikingLayer();
  if (wasVisible) hikingLayer.addTo(mapInstance);
}

export function setHikingRoutesVisible(visible) {
  if (!mapInstance || !hikingLayer) return;
  if (visible) hikingLayer.addTo(mapInstance);
  else mapInstance.removeLayer(hikingLayer);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
