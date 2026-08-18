// Leaflet 地図表示モジュール
// - 地図の初期化と共有インスタンスの提供(getMap)
// - オーバーレイ(緊急ポイント / ハイキングルート+スポット / 通行止め)の描画・スタイル
// 表示データはすべて published-data.js が公開API から取得して渡す(本モジュールは描画専用)。
// 現在地表示・移動経路の記録は geolocation.js に分離している。
// leaflet-src.esm.js は名前空間exportのため `* as L` で受ける(default exportではない)
import * as L from 'leaflet';
import { t } from './i18n.js';

const GSI_TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png';
const GSI_ATTRIBUTION =
  '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>';

// 起動時の中心は箕面ビジターセンター、z=15(ホーム/マップビュー共通の単一マップ)
const INITIAL_CENTER = [34.85839, 135.4788];

const INITIAL_ZOOM = 15;
const MIN_ZOOM = 10;
const MAX_ZOOM = 18;

let mapInstance = null;

// 地図データ(mapdata): 緊急ポイント・ルート・スポットを1本の FeatureCollection で受け取り、
// properties.type で振り分けて2つのレイヤー(緊急ポイント / ハイキング)を作る。
// 取得は published-data.js が行い、ここでは描画のみを担う。
let mapdataGeoJSON = null;

// 緊急ポイント: レイヤーと現在のスタイルを保持
let emergencyLayer = null;
let emergencyStyle = null;

// ハイキング(ルート+スポット): レイヤーと、ルート/スポット双方のスタイルを保持
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

// 共有の地図インスタンスを返す(未初期化なら null)。
// 現在地・移動経路記録(geolocation.js)など他モジュールからの参照用。
export function getMap() {
  return mapInstance;
}

// ===== 現在のズームレベル表示(ズームボタンの左に配置) =====
// 表示/非表示は設定の「ズームレベルを表示」トグルで切り替える(既定は表示)。
let zoomDisplayEl = null;

const ZoomDisplayControl = L.Control.extend({
  onAdd(map) {
    const div = L.DomUtil.create('div', 'zoom-display');
    const update = () => { div.textContent = `z=${map.getZoom()}`; };
    update();
    map.on('zoomend', update);
    zoomDisplayEl = div;
    return div;
  }
});

// ズームレベル表示の ON/OFF(設定モーダルの「ズームレベルを表示」から呼ぶ)
export function setZoomDisplayVisible(on) {
  if (zoomDisplayEl) zoomDisplayEl.hidden = !on;
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
    case 'x': {
      // ✖(バツ)。他形状の白縁取りに合わせ、白の太線を下に敷いてから色線を重ねる
      const w = Math.max(2, Math.round(s / 5));
      const lines = (sw, col) =>
        `<line x1="1" y1="1" x2="${s - 1}" y2="${s - 1}" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"/>` +
        `<line x1="${s - 1}" y1="1" x2="1" y2="${s - 1}" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"/>`;
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}">${lines(w + 2, stroke)}${lines(w, color)}</svg>`;
    }
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

// マーカー用 divIcon を生成する共通関数(ポイント系・移動記録系マーカーで共用)。
// style の欠損値は fallback で補い、rotationDeg を与えると中心まわりに回転する。
export function buildMarkerIcon(style, {
  fallbackShape = 'circle',
  fallbackColor = '#dc2626',
  fallbackSize = 10,
  rotationDeg = 0,
  className = 'custom-marker'
} = {}) {
  const size = Math.max(4, Math.min(80, style?.size || fallbackSize));
  const svg = shapeToSVG(style?.shape || fallbackShape, style?.color || fallbackColor, size);
  const html = rotationDeg
    ? `<div style="width:${size}px;height:${size}px;transform:rotate(${rotationDeg}deg);transform-origin:50% 50%;">${svg}</div>`
    : svg;
  return L.divIcon({
    html,
    className,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
}

function createPointMarker(latlng, style, className = 'custom-marker') {
  return L.marker(latlng, { icon: buildMarkerIcon(style, { className }) });
}

// ===== レイヤー共通処理 =====
// レイヤーの表示/非表示を切り替える(未生成・地図未初期化時は何もしない)
function setLayerVisible(layer, visible) {
  if (!mapInstance || !layer) return;
  if (visible) layer.addTo(mapInstance);
  else mapInstance.removeLayer(layer);
}

// 旧レイヤーを取り除き、build() で作り直したレイヤーを返す。
// 旧レイヤーが表示中だった場合は差し替え後も表示を維持する。
function replaceLayer(oldLayer, build) {
  const wasVisible = !!(oldLayer && mapInstance && mapInstance.hasLayer(oldLayer));
  if (oldLayer && mapInstance) mapInstance.removeLayer(oldLayer);
  const next = build();
  if (next && wasVisible) next.addTo(mapInstance);
  return next;
}

// ===== 地図データ(緊急ポイント + ハイキングルート・スポット) =====
// 表示データを差し替える(キャッシュからの初期描画・公開データ更新時の再描画で共通)。
// 表示中だった場合は差し替え後も表示を維持する。null で非表示・破棄。
export function setMapdataGeoJSON(geojson) {
  mapdataGeoJSON = geojson;
  rebuildEmergencyLayer();
  rebuildHikingLayer();
}

// ===== 緊急ポイント =====
function buildEmergencyLayer() {
  return L.geoJSON(mapdataGeoJSON, {
    // 同じデータに含まれる route・spot は別レイヤーが描画するため除外する
    filter: (feature) => feature.properties?.type === 'ポイントGPS',
    pointToLayer: (feature, latlng) => createPointMarker(latlng, emergencyStyle),
    onEachFeature: (feature, layer) => {
      const p = feature.properties || {};
      const id = p.id ?? '';
      const name = p.name ?? '';
      layer.bindPopup(`<strong>${escapeHtml(id)}</strong><br>${escapeHtml(name)}`);
    }
  });
}

export function setEmergencyStyle(style) {
  emergencyStyle = style;
  rebuildEmergencyLayer();
}

function rebuildEmergencyLayer() {
  if (!mapInstance) return;
  emergencyLayer = replaceLayer(emergencyLayer, () => (mapdataGeoJSON ? buildEmergencyLayer() : null));
}

export function setEmergencyPointsVisible(visible) {
  setLayerVisible(emergencyLayer, visible);
}

// ===== 通行止め・通行困難地点(closures) =====
// データの取得(公開API `/api/closures`)は published-data.js 側が行い、
// ここでは渡された GeoJSON の描画のみを担う。
// kind でスタイルを分ける: closed(通行止め)=赤✖ / difficult(通行困難)=橙三角(既定)。
// スタイルはマーカー設定で変更可能(setClosureClosedStyle / setClosureDifficultStyle)。
const CLOSURE_FALLBACK_STYLES = {
  closed: { color: '#DC2626', shape: 'x', size: 10 },
  difficult: { color: '#F59E0B', shape: 'triangle', size: 16 }
};
// kind → ポップアップ表示名の翻訳キー(表示名は i18n.js の辞書で管理)
const CLOSURE_KIND_KEYS = { closed: 'closure.kindClosed', difficult: 'closure.kindDifficult' };

let closureGeoJSON = null;
let closureLayer = null;
let closureClosedStyle = null;
let closureDifficultStyle = null;

// 表示データを差し替える(初回読込・プレビュー・反映・キャンセル時の復元で共通)。
// 表示中だった場合は差し替え後も表示を維持する。null で非表示・破棄。
export function setClosureGeoJSON(geojson) {
  closureGeoJSON = geojson;
  closureLayer = replaceLayer(closureLayer, () =>
    (closureGeoJSON && mapInstance) ? buildClosureLayer() : null
  );
}

function buildClosureLayer() {
  return L.geoJSON(closureGeoJSON, {
    filter: (feature) => feature.geometry?.type === 'Point',
    pointToLayer: (feature, latlng) => {
      // kind が difficult 以外(closed・不明)は通行止めスタイルで描画する
      const style = feature.properties?.kind === 'difficult'
        ? (closureDifficultStyle || CLOSURE_FALLBACK_STYLES.difficult)
        : (closureClosedStyle || CLOSURE_FALLBACK_STYLES.closed);
      return createPointMarker(latlng, style, 'custom-marker closure-marker');
    },
    onEachFeature: (feature, layer) => {
      const p = feature.properties || {};
      const kind = CLOSURE_KIND_KEYS[p.kind] ? t(CLOSURE_KIND_KEYS[p.kind]) : (p.kind || '');
      const lines = [`<strong>${escapeHtml(p.name ?? p.id ?? '')}</strong>`];
      if (kind) lines.push(escapeHtml(kind));
      if (p.reason) lines.push(t('closure.popupReason', { reason: escapeHtml(p.reason) }));
      if (p.note) lines.push(escapeHtml(p.note));
      if (p.updatedAt) lines.push(t('closure.popupUpdated', { date: escapeHtml(p.updatedAt) }));
      layer.bindPopup(lines.join('<br>'));
    }
  });
}

export function setClosuresVisible(visible) {
  setLayerVisible(closureLayer, visible);
}

// 通行止め(kind=closed)マーカーのスタイル。表示中なら即時反映。
export function setClosureClosedStyle(style) {
  closureClosedStyle = style;
  rebuildClosureLayer();
}

// 通行困難地点(kind=difficult)マーカーのスタイル。表示中なら即時反映。
export function setClosureDifficultStyle(style) {
  closureDifficultStyle = style;
  rebuildClosureLayer();
}

function rebuildClosureLayer() {
  if (!closureGeoJSON || !mapInstance) return;
  closureLayer = replaceLayer(closureLayer, buildClosureLayer);
}

// ===== ハイキング(ルート+スポット) =====
function sameCoord(a, b) {
  return !!a && !!b && a[0] === b[0] && a[1] === b[1];
}

// ルート線を「開始ポイント → 中間点 → 終了ポイント」で結ぶため、
// LineString の先頭に開始ポイント、末尾に終了ポイントの座標を補う。
// 端点座標は配信データの startPointGPS / endPointGPS をそのまま使う(null は補わない)。
// 元データは変更せず、表示用に座標を拡張したコピーを返す。
function withRouteEndpoints(gj) {
  if (!gj) return gj;
  const features = gj.features.map((f) => {
    const p = f.properties;
    if (p?.type !== 'route' || f.geometry?.type !== 'LineString') return f;
    const coords = f.geometry.coordinates.slice();
    const start = p.startPointGPS;
    const end = p.endPointGPS;
    if (start && !sameCoord(start, coords[0])) coords.unshift(start);
    if (end && !sameCoord(end, coords[coords.length - 1])) coords.push(end);
    return { ...f, geometry: { ...f.geometry, coordinates: coords } };
  });
  return { ...gj, features };
}

function buildHikingLayer() {
  // ルートに開始/終了ポイントを補ったコピーを描画する
  const data = withRouteEndpoints(mapdataGeoJSON);
  return L.geoJSON(data, {
    // 描画するのは route(線)と spot(点)のみ。緊急ポイント('ポイントGPS')は
    // 緊急ポイントレイヤーが描画するため除外する(二重描画とスポット色の巻き込みを防ぐ)。
    filter: (feature) =>
      feature.properties?.type === 'route' || feature.properties?.type === 'spot',
    style: () => ({
      color: hikingRouteStyle?.color || '#ea580c',
      weight: hikingRouteStyle?.size || 3,
      opacity: 0.85
    }),
    pointToLayer: (feature, latlng) => createPointMarker(latlng, hikingSpotStyle),
    // ポップアップはスポットのみ。ルート(線・中間点)は表示しない。
    // 配信データのスポットは名称と座標だけを持つ(id は編集用のため公開されない)。
    onEachFeature: (feature, layer) => {
      const p = feature.properties || {};
      if (p.type !== 'spot') return;
      layer.bindPopup(`<strong>${escapeHtml(p.name ?? '')}</strong>`);
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
  if (!mapInstance) return;
  hikingLayer = replaceLayer(hikingLayer, () => (mapdataGeoJSON ? buildHikingLayer() : null));
}

export function setHikingRoutesVisible(visible) {
  setLayerVisible(hikingLayer, visible);
}

// 読み込んだデータの件数を返す(未読込は null)。表示状態に依らず常に実データの件数。
// ポイント=ポイントGPS(緊急ポイント)、ルート=route、スポット=spot。ルート中間点は数えない。
export function getFeatureCounts() {
  if (!mapdataGeoJSON) return { points: null, routes: null, spots: null };
  const countByType = (type) => mapdataGeoJSON.features.filter((f) => f.properties?.type === type).length;
  return {
    points: countByType('ポイントGPS'),
    routes: countByType('route'),
    spots: countByType('spot')
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
