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

function createPointMarker(latlng, style, className = 'custom-marker') {
  const size = Math.max(4, Math.min(80, style?.size || 10));
  const icon = L.divIcon({
    html: shapeToSVG(style?.shape || 'circle', style?.color || '#dc2626', size),
    className,
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

// ===== 通行止め・通行困難地点(closures) =====
// データの取得(同梱ファイル / localStorage / 読み込みファイル)は app.js 側が行い、
// ここでは渡された GeoJSON の描画のみを担う。
// kind で固定スタイルを分ける: closed(通行止め)=赤ひし形 / difficult(通行困難)=橙三角。
const CLOSURE_STYLES = {
  closed: { color: '#DC2626', shape: 'diamond', size: 14 },
  difficult: { color: '#F59E0B', shape: 'triangle', size: 14 }
};
const CLOSURE_KIND_LABELS = { closed: '通行止め', difficult: '通行困難' };

let closureGeoJSON = null;
let closureLayer = null;

// 表示データを差し替える(初回読込・プレビュー・反映・キャンセル時の復元で共通)。
// 表示中だった場合は差し替え後も表示を維持する。null で非表示・破棄。
export function setClosureGeoJSON(geojson) {
  const wasVisible = !!(closureLayer && mapInstance && mapInstance.hasLayer(closureLayer));
  if (closureLayer && mapInstance) mapInstance.removeLayer(closureLayer);
  closureLayer = null;
  closureGeoJSON = geojson;
  if (!closureGeoJSON || !mapInstance) return;
  closureLayer = buildClosureLayer();
  if (wasVisible) closureLayer.addTo(mapInstance);
}

function buildClosureLayer() {
  return L.geoJSON(closureGeoJSON, {
    filter: (feature) => feature.geometry?.type === 'Point',
    pointToLayer: (feature, latlng) => {
      const style = CLOSURE_STYLES[feature.properties?.kind] || CLOSURE_STYLES.closed;
      return createPointMarker(latlng, style, 'custom-marker closure-marker');
    },
    onEachFeature: (feature, layer) => {
      const p = feature.properties || {};
      const kind = CLOSURE_KIND_LABELS[p.kind] || p.kind || '';
      const lines = [`<strong>${escapeHtml(p.name ?? p.id ?? '')}</strong>`];
      if (kind) lines.push(escapeHtml(kind));
      if (p.reason) lines.push(`理由: ${escapeHtml(p.reason)}`);
      if (p.note) lines.push(escapeHtml(p.note));
      if (p.updatedAt) lines.push(`更新日: ${escapeHtml(p.updatedAt)}`);
      layer.bindPopup(lines.join('<br>'));
    }
  });
}

export function setClosuresVisible(visible) {
  if (!mapInstance || !closureLayer) return;
  if (visible) closureLayer.addTo(mapInstance);
  else mapInstance.removeLayer(closureLayer);
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
    // Point 地物は type==='spot' のみ描画する。
    // 同ファイルには緊急ポイントと同座標の 'ポイントGPS' も含まれるが、それらは
    // 緊急ポイントレイヤーが描画するため除外する(二重描画とスポット色の巻き込みを防ぐ)。
    // route(LineString)等の非 Point 地物はそのまま通す。
    filter: (feature) =>
      feature.geometry?.type !== 'Point' || feature.properties?.type === 'spot',
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

// 読み込んだデータの件数を返す(未読込は null)。表示状態に依らず常に実データの件数。
// ポイント=緊急ポイント(Point)、ルート=route、スポット=spot。ルート中間点は数えない。
export function getFeatureCounts() {
  const points = emergencyGeoJSON
    ? emergencyGeoJSON.features.filter((f) => f.geometry?.type === 'Point').length
    : null;
  let routes = null;
  let spots = null;
  if (hikingGeoJSON) {
    routes = hikingGeoJSON.features.filter((f) => f.properties?.type === 'route').length;
    spots = hikingGeoJSON.features.filter((f) => f.properties?.type === 'spot').length;
  }
  return { points, routes, spots };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ===== 現在地表示 + 移動経路の記録 =====
// Geolocation API による現在地マーカー + 精度円。
// 監視(watchPosition)は、マップビュー表示中で「現在地点をマーカー表示」「現在地点は
// 中央に表示」「移動経路の記録」のいずれかが有効なときに動く(refreshLocationWatch が制御)。
// マーカー表示は showCurrentMarker、地図追従は followCurrentLocation で個別に切り替える。
// 記録中(startTrackRecording 後)は、位置更新ごとに軌跡(ポリライン + 通過点マーカー)を追加する。
let currentLocationMarker = null;
let currentLocationCircle = null;
let geoWatchId = null;
// マップビュー表示中か(ビュー外では現在地を監視しない)
let onMapView = false;
// 現在地点をマーカー表示(メニュートグル・既定 ON)
let showCurrentMarker = true;
// 現在地を地図中央に表示=現在地へ追従(メニュートグル・既定 ON)
let followCurrentLocation = true;
// 現在地監視開始後、最初の位置取得を受け取ったか(初回はアニメ無しで移動)
let hasHadFirstFix = false;
// 直近に取得した現在地(トグル切替時の即時反映に使用)
let lastKnownLatLng = null;
// 位置情報エラーの通知コールバックと、監視中に通知済みかのフラグ(連続エラーの抑制)
let locationErrorCb = null;
let locationErrorReported = false;

// トラック(移動経路)
// 「移動した」の判定: 直近の記録点から 20m 以上離れたか、1 分以上経過した場合に記録
const TRACK_MIN_DISTANCE_M = 20;
const TRACK_MIN_INTERVAL_MS = 60 * 1000;
let isRecordingTrack = false;
let trackPolyline = null;        // 記録点を順に結ぶ線(トラック)
let trackStartMarker = null;     // 開始地点マーカー(トラック開始点)
let trackCurrentMarker = null;   // 最終記録地点マーカー(トラック現在地点・進行方向)
let trackStyle = null;           // 線のスタイル(トラック)
let trackStartStyle = null;      // 開始点マーカーのスタイル(トラック開始点)
let trackCurrentStyle = null;    // 現在地点マーカーのスタイル(トラック現在地点)
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

// トラック開始点マーカーのスタイル。既存マーカーがあれば即時反映。
export function setTrackStartStyle(style) {
  trackStartStyle = style;
  if (trackStartMarker) {
    trackStartMarker.setIcon(buildShapeIcon(trackStartStyle, 'square'));
  }
}

// トラック現在地点マーカーのスタイル。既存マーカーがあれば即時反映(進行方向を再計算)。
export function setTrackCurrentStyle(style) {
  trackCurrentStyle = style;
  if (trackCurrentMarker) updateTrackCurrentMarker();
}

// マーカー用 divIcon を生成(rotationDeg を与えると中心まわりに回転)
function buildShapeIcon(style, fallbackShape, rotationDeg = 0) {
  const size = Math.max(4, Math.min(80, style?.size || 8));
  const shape = style?.shape || fallbackShape;
  const color = style?.color || '#000080';
  const svg = shapeToSVG(shape, color, size);
  const html = rotationDeg
    ? `<div style="width:${size}px;height:${size}px;transform:rotate(${rotationDeg}deg);transform-origin:50% 50%;">${svg}</div>`
    : svg;
  return L.divIcon({
    html,
    className: 'custom-marker',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
}

// 2点間の方位角(度・北=0、時計回り)。三角マーカーの回転に用いる。
function bearingDeg(a, b) {
  const toRad = (d) => d * Math.PI / 180;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// 進行方向: 過去最大3点(記録点)の平均座標から、現在位置へ向かう方位。
// current は現在位置(記録中はライブ現在地、停止後は最終記録点)。
// 方向が定まらない(平均と現在が同じ等)場合は 0(北・上向き)を返す。
function computeHeading(latlngs, current) {
  const n = latlngs.length;
  if (n === 0) return 0;
  const k = Math.min(3, n);
  const recent = latlngs.slice(n - k);
  let lat = 0;
  let lng = 0;
  for (const p of recent) { lat += p.lat; lng += p.lng; }
  const avg = { lat: lat / k, lng: lng / k };
  if (Math.abs(avg.lat - current.lat) < 1e-9 && Math.abs(avg.lng - current.lng) < 1e-9) return 0;
  return bearingDeg(avg, current);
}

// 現在地点マーカー(三角)を配置し、進行方向に回転させる。
// liveLatLng を与えると現在地(ライブ)へ、無ければ最終記録点へ配置する。
function updateTrackCurrentMarker(liveLatLng) {
  if (!trackPolyline || !mapInstance) return;
  const latlngs = trackPolyline.getLatLngs();
  if (latlngs.length === 0) return;
  const pos = liveLatLng ? L.latLng(liveLatLng) : latlngs[latlngs.length - 1];
  const icon = buildShapeIcon(trackCurrentStyle, 'triangle', computeHeading(latlngs, pos));
  if (!trackCurrentMarker) {
    trackCurrentMarker = L.marker(pos, { icon }).addTo(mapInstance);
  } else {
    trackCurrentMarker.setLatLng(pos);
    trackCurrentMarker.setIcon(icon);
  }
}

export function startTrackRecording() {
  if (!mapInstance) return;
  isRecordingTrack = true;
  // マーカー表示・追従が両方 OFF でも、記録のため現在地監視を確実に開始する。
  refreshLocationWatch();
  if (!trackPolyline) {
    trackPolyline = L.polyline([], {
      color: trackStyle?.color || '#000080',
      weight: trackStyle?.size || 4,
      opacity: 0.85
    }).addTo(mapInstance);
  }
  // 既に現在地が取得済なら、最初の点として打つ(待たずに描画開始する)。
  // このとき現在地マーカーを青丸から三角(トラック現在地点)へ切り替える。
  if (currentLocationMarker) {
    const ll = currentLocationMarker.getLatLng();
    appendTrackPoint([ll.lat, ll.lng]);
    updateTrackCurrentMarker(ll);
    mapInstance.removeLayer(currentLocationMarker);
    currentLocationMarker = null;
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
  // 三角(現在地点)を最終記録点へスナップして固定する。
  updateTrackCurrentMarker();
  // 記録停止後、マーカー表示 ON なら現在地(青丸)を再表示する。
  if (showCurrentMarker && lastKnownLatLng) showOrUpdateCurrentMarker(lastKnownLatLng);
  // 記録が監視を要求しなくなった場合に備えて監視状態を見直す。
  refreshLocationWatch();
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

// トラック表示(線・開始点・現在地点)を全削除する。
// 「移動経路をクリア」ボタンからのみ呼び出す(トグル OFF では消さない)。
export function clearTrack() {
  isRecordingTrack = false;
  if (trackPolyline) {
    mapInstance.removeLayer(trackPolyline);
    trackPolyline = null;
  }
  if (trackStartMarker) {
    mapInstance.removeLayer(trackStartMarker);
    trackStartMarker = null;
  }
  if (trackCurrentMarker) {
    mapInstance.removeLayer(trackCurrentMarker);
    trackCurrentMarker = null;
  }
  lastTrackLatLng = null;
  lastTrackTimeMs = 0;
}

// 記録点を追加: 線に頂点を足し、最初の点なら開始点マーカー、
// 毎回 現在地点マーカー(進行方向つき)を最終点へ更新する。
function appendTrackPoint(latlng) {
  if (!trackPolyline) return;
  const wasEmpty = trackPolyline.getLatLngs().length === 0;
  trackPolyline.addLatLng(latlng);
  const lat = Array.isArray(latlng) ? latlng[0] : latlng.lat;
  const lng = Array.isArray(latlng) ? latlng[1] : latlng.lng;

  // 開始地点マーカー(最初の記録点のみ)
  if (wasEmpty) {
    if (trackStartMarker) {
      mapInstance.removeLayer(trackStartMarker);
      trackStartMarker = null;
    }
    trackStartMarker = L.marker([lat, lng], {
      icon: buildShapeIcon(trackStartStyle, 'square')
    }).addTo(mapInstance);
  }

  // 現在地点マーカー(三角)の位置・向きは呼び出し側(記録中はライブ現在地)で更新する。
  lastTrackLatLng = [lat, lng];
  lastTrackTimeMs = Date.now();
}

// ===== 現在地監視の制御 =====
// 監視(watchPosition)が必要か: マップビュー表示中で、現在地マーカー表示・
// 現在地追従・移動記録のいずれかが要求しているとき。
function needLocationWatch() {
  return onMapView && (showCurrentMarker || followCurrentLocation || isRecordingTrack);
}

// 必要に応じて監視を開始/停止する。各トグル・記録状態・ビュー切替の後に呼ぶ。
function refreshLocationWatch() {
  if (needLocationWatch()) startGeoWatch();
  else stopGeoWatch();
}

function startGeoWatch() {
  if (!mapInstance || geoWatchId != null) return; // 既に監視中
  if (!('geolocation' in navigator)) {
    reportLocationError('この端末は位置情報に対応していません');
    return;
  }
  locationErrorReported = false;
  geoWatchId = navigator.geolocation.watchPosition(
    onGeoSuccess,
    (err) => reportLocationError(`位置情報の取得に失敗: ${err.message}`),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
}

function stopGeoWatch() {
  hasHadFirstFix = false;
  if (geoWatchId != null) {
    navigator.geolocation.clearWatch(geoWatchId);
    geoWatchId = null;
  }
  removeCurrentMarker();
  removeCurrentCircle();
}

// 位置情報エラーの通知(1回の監視につき最初の1回のみ。連続エラーを抑制)
function reportLocationError(msg) {
  if (locationErrorReported) return;
  locationErrorReported = true;
  locationErrorCb && locationErrorCb(msg);
}

// 位置取得成功時の更新処理(マーカー表示・精度円・記録・地図追従)
function onGeoSuccess(pos) {
  const { latitude, longitude, accuracy } = pos.coords;
  const latlng = [latitude, longitude];
  lastKnownLatLng = latlng;
  // 初回の位置取得かどうか(初回は遠距離になり得るためアニメ無しで移動)
  const isFirstFix = !hasHadFirstFix;
  hasHadFirstFix = true;

  // 現在地マーカー(青丸): 「現在地点をマーカー表示」ON かつ 非記録中のみ表示。
  // 記録中はライブ現在地を三角(トラック現在地点)で表すため青丸は出さない。
  if (showCurrentMarker && !isRecordingTrack) {
    showOrUpdateCurrentMarker(latlng);
  } else {
    removeCurrentMarker();
  }

  // 精度円: 「現在地点をマーカー表示」ON のとき現在地へ追従表示。
  if (showCurrentMarker && Number.isFinite(accuracy)) {
    showOrUpdateCurrentCircle(latlng, accuracy);
  } else {
    removeCurrentCircle();
  }

  // 記録中: 条件を満たせば記録点を追加し、三角をライブ現在地へ追従(進行方向つき)
  if (isRecordingTrack) {
    if (shouldRecordTrackPoint(latlng, Date.now())) appendTrackPoint(latlng);
    updateTrackCurrentMarker(latlng);
  }

  // 「現在地点は中央に表示」ON のとき、現在地が画面中央に来るよう地図を追従させる
  if (followCurrentLocation) {
    if (isFirstFix) mapInstance.setView(latlng, mapInstance.getZoom());
    else mapInstance.panTo(latlng);
  }
}

// 現在地マーカー(青丸)の生成・更新
function showOrUpdateCurrentMarker(latlng) {
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
}

function removeCurrentMarker() {
  if (currentLocationMarker) {
    mapInstance.removeLayer(currentLocationMarker);
    currentLocationMarker = null;
  }
}

// 精度円の生成・更新
function showOrUpdateCurrentCircle(latlng, accuracy) {
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

function removeCurrentCircle() {
  if (currentLocationCircle) {
    mapInstance.removeLayer(currentLocationCircle);
    currentLocationCircle = null;
  }
}

// マップビューの出入りで現在地監視を制御する。
// active=true でマップ表示中とみなして必要なら監視開始、false で監視停止・マーカー除去。
// onError は位置情報取得失敗時の通知に使う(指定時に記憶し、以降の監視でも使用)。
export function setLocationActiveForMapView(active, { onError } = {}) {
  onMapView = active;
  if (onError) locationErrorCb = onError;
  refreshLocationWatch();
}

// 「現在地点をマーカー表示」トグル。OFF で青丸・精度円を消す。
// ON にした直後は、直近の取得位置があれば即座にマーカーを再表示する。
export function setCurrentMarkerVisible(on) {
  showCurrentMarker = on;
  if (!on) {
    removeCurrentMarker();
    removeCurrentCircle();
  } else if (lastKnownLatLng && !isRecordingTrack) {
    showOrUpdateCurrentMarker(lastKnownLatLng);
  }
  refreshLocationWatch();
}

// 「現在地点は中央に表示」トグル。ON にした直後、直近の取得位置があれば即追従。
export function setFollowCurrentLocation(on) {
  followCurrentLocation = on;
  if (on && lastKnownLatLng && mapInstance) {
    mapInstance.panTo(lastKnownLatLng);
  }
  refreshLocationWatch();
}
