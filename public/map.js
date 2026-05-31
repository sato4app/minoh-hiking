// Leaflet 地図表示モジュール
// leaflet-src.esm.js は名前空間exportのため `* as L` で受ける(default exportではない)
import * as L from 'leaflet';

const GSI_TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png';
const GSI_ATTRIBUTION =
  '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>';

// 起動時の中心は箕面ビジターセンター、z=15(ホーム/マップビュー共通の単一マップ)
const INITIAL_CENTER = [34.85839, 135.4788];

const INITIAL_ZOOM = 15;
const MIN_ZOOM = 10;
const MAX_ZOOM = 18;

let mapInstance = null;

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
  // 期待する並び(上から): zoom → zoom-display → scale → attribution なので、逆順に追加する。
  L.control.attribution({ position: 'bottomright' }).addTo(map);
  L.control.scale({ position: 'bottomright', metric: true, imperial: false, maxWidth: 150 }).addTo(map);
  new ZoomDisplayControl({ position: 'bottomright' }).addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  mapInstance = map;
  return map;
}

// ===== 現在のズームレベル表示(ズームボタンの左に配置) =====
const ZoomDisplayControl = L.Control.extend({
  onAdd(map) {
    const div = L.DomUtil.create('div', 'zoom-display');
    const update = () => { div.textContent = `z=${map.getZoom()}`; };
    update();
    map.on('zoomend', update);
    return div;
  }
});

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
    // ルート端点(開始/終了ポイント)の多くは緊急ポイント。
    // ハイキング層が先に構築済みなら、端点座標を反映するため再構築する。
    rebuildHikingLayer();
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
    console.warn('ハイキングルートGeoJSON読込失敗:', err);
    return null;
  }
}

// 開始/終了ポイントの座標索引を id から構築(緊急ポイント優先、無ければハイキングスポット)
function buildEndpointIndex() {
  const index = new Map();
  const add = (gj) => {
    if (!gj) return;
    for (const f of gj.features) {
      const g = f.geometry;
      if (!g || g.type !== 'Point') continue;
      const id = f.properties?.id ?? f.properties?.pointId;
      if (id != null && !index.has(id)) index.set(id, g.coordinates);
    }
  };
  add(emergencyGeoJSON);
  add(hikingGeoJSON);
  return index;
}

function sameCoord(a, b) {
  return !!a && !!b && a[0] === b[0] && a[1] === b[1];
}

// ルート線を「開始ポイント → 中間点 → 終了ポイント」で結ぶため、
// LineString の先頭に開始ポイント、末尾に終了ポイントの座標を補う。
// 元データは変更せず、表示用に座標を拡張したコピーを返す。
function withRouteEndpoints(gj, index) {
  if (!gj) return gj;
  const features = gj.features.map((f) => {
    if (f.properties?.type !== 'route' || f.geometry?.type !== 'LineString') return f;
    const coords = f.geometry.coordinates.slice();
    const start = index.get(f.properties.startPoint);
    const end = index.get(f.properties.endPoint);
    if (start && !sameCoord(start, coords[0])) coords.unshift(start);
    if (end && !sameCoord(end, coords[coords.length - 1])) coords.push(end);
    return { ...f, geometry: { ...f.geometry, coordinates: coords } };
  });
  return { ...gj, features };
}

function buildHikingLayer() {
  // ルートに開始/終了ポイントを補ったコピーを描画(緊急ポイント未読込時は中間点のみ)
  const data = withRouteEndpoints(hikingGeoJSON, buildEndpointIndex());
  return L.geoJSON(data, {
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

// ===== 現在地表示 + 移動経路の記録 =====
// Geolocation API による現在地マーカー + 精度円。
// 表示中(setCurrentLocationVisible(true))は watchPosition で位置を追跡し、
// 停止時は明示クリアする。
// 記録中(startTrackRecording 後)は、位置更新ごとに軌跡(ポリライン + 通過点マーカー)を追加する。
let currentLocationMarker = null;
let currentLocationCircle = null;
let geoWatchId = null;
// 現在地表示中(移動経路を記録 ON)の間、地図を現在地に追従させるか
let followCurrentLocation = false;

// トラック(移動経路)
// 「移動した」の判定: 直近の記録点から 20m 以上離れたか、1 分以上経過した場合に記録
const TRACK_MIN_DISTANCE_M = 20;
const TRACK_MIN_INTERVAL_MS = 60 * 1000;
let isRecordingTrack = false;
let trackPolyline = null;
let trackPointMarkers = [];
let trackStyle = null;
let lastTrackLatLng = null;
let lastTrackTimeMs = 0;

export function setTrackStyle(style) {
  trackStyle = style;
  if (trackPolyline) {
    trackPolyline.setStyle({
      color: style?.color || '#000080',
      weight: style?.size || 4
    });
  }
}

export function startTrackRecording() {
  if (!mapInstance) return;
  isRecordingTrack = true;
  if (!trackPolyline) {
    trackPolyline = L.polyline([], {
      color: trackStyle?.color || '#000080',
      weight: trackStyle?.size || 4,
      opacity: 0.85
    }).addTo(mapInstance);
  }
  // 既に現在地が取得済なら、最初の点として打つ(待たずに描画開始する)
  if (currentLocationMarker) {
    const ll = currentLocationMarker.getLatLng();
    appendTrackPoint([ll.lat, ll.lng]);
  }
}

// 移動判定: 直近の記録点から 20m 以上離れた、または 1 分以上経過していれば記録対象
function shouldRecordTrackPoint(latlng, nowMs) {
  if (!lastTrackLatLng) return true;
  const distance = L.latLng(latlng).distanceTo(L.latLng(lastTrackLatLng));
  if (distance >= TRACK_MIN_DISTANCE_M) return true;
  if (nowMs - lastTrackTimeMs >= TRACK_MIN_INTERVAL_MS) return true;
  return false;
}

export function stopTrackRecording() {
  isRecordingTrack = false;
}

// 現在の移動経路の統計(記録地点数・合計移動距離[m])を返す。
// 軌跡が消去(clearTrack)される前に呼ぶこと。
export function getTrackStats() {
  let pointCount = 0;
  let distanceM = 0;
  if (trackPolyline) {
    const latlngs = trackPolyline.getLatLngs();
    pointCount = latlngs.length;
    for (let i = 1; i < latlngs.length; i++) {
      distanceM += latlngs[i - 1].distanceTo(latlngs[i]);
    }
  }
  return { pointCount, distanceM };
}

// トラック表示を全削除(トグル OFF 時に呼び出す)
function clearTrack() {
  isRecordingTrack = false;
  if (trackPolyline) {
    mapInstance.removeLayer(trackPolyline);
    trackPolyline = null;
  }
  for (const m of trackPointMarkers) {
    mapInstance.removeLayer(m);
  }
  trackPointMarkers = [];
  lastTrackLatLng = null;
  lastTrackTimeMs = 0;
}

function appendTrackPoint(latlng) {
  if (!trackPolyline) return;
  trackPolyline.addLatLng(latlng);
  const dot = L.circleMarker(latlng, {
    radius: Math.max(2, Math.round((trackStyle?.size || 4) * 0.6)),
    color: trackStyle?.color || '#000080',
    weight: 1,
    fillColor: trackStyle?.color || '#000080',
    fillOpacity: 0.9
  }).addTo(mapInstance);
  trackPointMarkers.push(dot);
  lastTrackLatLng = Array.isArray(latlng) ? [latlng[0], latlng[1]] : [latlng.lat, latlng.lng];
  lastTrackTimeMs = Date.now();
}

export function setCurrentLocationVisible(visible, { onError } = {}) {
  if (!mapInstance) return;
  if (visible) {
    if (!('geolocation' in navigator)) {
      onError && onError('この端末は位置情報に対応していません');
      return;
    }
    followCurrentLocation = true;
    if (geoWatchId != null) return; // 既に追跡中
    geoWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const latlng = [latitude, longitude];
        // 初回の位置取得かどうか(初回は遠距離になり得るためアニメ無しで移動)
        const isFirstFix = !currentLocationMarker;
        if (!currentLocationMarker) {
          currentLocationMarker = L.circleMarker(latlng, {
            radius: 7,
            color: '#ffffff',
            weight: 2,
            fillColor: '#1d4ed8',
            fillOpacity: 0.95
          }).addTo(mapInstance);
          currentLocationMarker.bindPopup('現在地');
        } else {
          currentLocationMarker.setLatLng(latlng);
        }
        if (Number.isFinite(accuracy)) {
          if (!currentLocationCircle) {
            currentLocationCircle = L.circle(latlng, {
              radius: accuracy,
              color: '#1d4ed8',
              weight: 1,
              fillColor: '#3b82f6',
              fillOpacity: 0.12
            }).addTo(mapInstance);
          } else {
            currentLocationCircle.setLatLng(latlng);
            currentLocationCircle.setRadius(accuracy);
          }
        }
        // 記録中: 直近の記録点から 20m 以上移動、または 1 分以上経過した場合のみ追加
        if (isRecordingTrack && shouldRecordTrackPoint(latlng, Date.now())) {
          appendTrackPoint(latlng);
        }
        // 移動経路を記録 ON の間は現在地が画面中央に来るよう地図を追従させる
        if (followCurrentLocation) {
          if (isFirstFix) mapInstance.setView(latlng, mapInstance.getZoom());
          else mapInstance.panTo(latlng);
        }
      },
      (err) => {
        onError && onError(`位置情報の取得に失敗: ${err.message}`);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  } else {
    followCurrentLocation = false;
    if (geoWatchId != null) {
      navigator.geolocation.clearWatch(geoWatchId);
      geoWatchId = null;
    }
    if (currentLocationMarker) {
      mapInstance.removeLayer(currentLocationMarker);
      currentLocationMarker = null;
    }
    if (currentLocationCircle) {
      mapInstance.removeLayer(currentLocationCircle);
      currentLocationCircle = null;
    }
    // トグル OFF 時は記録済の移動経路も消す
    clearTrack();
  }
}
