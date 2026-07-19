// 現在地表示 + 移動記録(移動経路の記録)モジュール(map.js から分離)
// Geolocation API による現在地マーカー + 精度円(現在地点を中心とする円)。
// 精度円は常時表示せず、マップ表示への切替時・「現在地点をマーカー表示」ON 時に
// 3秒間だけ表示する(requestCurrentCircleFlash / showTemporaryCircle)。
// 監視(watchPosition)は、マップビュー表示中で「現在地点をマーカー表示」「現在地点は
// 中央に表示」「移動経路の記録」のいずれかが有効なときに動く(refreshLocationWatch が制御)。
// マーカー表示は showCurrentMarker、地図追従は followCurrentLocation で個別に切り替える。
// 記録中(startTrackRecording 後)は、位置更新ごとに軌跡(ポリライン + 通過点マーカー)を追加する。
// 地図インスタンスは map.js の getMap() を通じて共有する。
import * as L from 'leaflet';
import { getMap, buildMarkerIcon } from './map.js';
import { t } from './i18n.js';

let currentLocationMarker = null;
let currentLocationCircle = null;
// 現在地点を中心とする円は常時表示せず、マップ表示への切替時・
// 「現在地点をマーカー表示」ON 時に3秒間だけ表示する。
const CURRENT_CIRCLE_DURATION_MS = 3000;
let circleHideTimerId = null;   // 円を自動で消すタイマー(3秒)
let pendingCircleShow = false;  // 位置未取得時: 次の取得で円を表示する要求
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
// 直近に取得した位置精度[m](円の即時表示に使用)
let lastKnownAccuracy = null;
// 位置情報エラーの通知コールバックと、監視中に通知済みかのフラグ(連続エラーの抑制)
let locationErrorCb = null;
let locationErrorReported = false;

// 移動記録(移動経路)
// 「移動した」の判定: 直近の記録点から 20m 以上離れたか、1 分以上経過した場合に記録
const TRACK_MIN_DISTANCE_M = 20;
const TRACK_MIN_INTERVAL_MS = 60 * 1000;
let isRecordingTrack = false;
let trackPolyline = null;        // 記録点を順に結ぶ線(移動記録経路)
let trackStartMarker = null;     // 開始地点マーカー(移動記録開始点)
let trackCurrentMarker = null;   // 最終記録地点マーカー(移動記録現在地点・進行方向)
let trackStyle = null;           // 線のスタイル(移動記録経路)
let trackStartStyle = null;      // 開始点マーカーのスタイル(移動記録開始点)
let trackCurrentStyle = null;    // 現在地点マーカーのスタイル(移動記録現在地点)
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

// 移動記録開始点マーカーのスタイル。既存マーカーがあれば即時反映。
export function setTrackStartStyle(style) {
  trackStartStyle = style;
  if (trackStartMarker) {
    trackStartMarker.setIcon(buildShapeIcon(trackStartStyle, 'square'));
  }
}

// 移動記録現在地点マーカーのスタイル。既存マーカーがあれば即時反映(進行方向を再計算)。
export function setTrackCurrentStyle(style) {
  trackCurrentStyle = style;
  if (trackCurrentMarker) updateTrackCurrentMarker();
}

// 移動記録系マーカー用 divIcon を生成(map.js の共通関数に既定値を渡す薄いラッパー)
function buildShapeIcon(style, fallbackShape, rotationDeg = 0) {
  return buildMarkerIcon(style, {
    fallbackShape,
    fallbackColor: '#000080',
    fallbackSize: 8,
    rotationDeg
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
  const map = getMap();
  if (!trackPolyline || !map) return;
  const latlngs = trackPolyline.getLatLngs();
  if (latlngs.length === 0) return;
  const pos = liveLatLng ? L.latLng(liveLatLng) : latlngs[latlngs.length - 1];
  const icon = buildShapeIcon(trackCurrentStyle, 'triangle', computeHeading(latlngs, pos));
  if (!trackCurrentMarker) {
    trackCurrentMarker = L.marker(pos, { icon }).addTo(map);
  } else {
    trackCurrentMarker.setLatLng(pos);
    trackCurrentMarker.setIcon(icon);
  }
}

export function startTrackRecording() {
  const map = getMap();
  if (!map) return;
  isRecordingTrack = true;
  // マーカー表示・追従が両方 OFF でも、記録のため現在地監視を確実に開始する。
  refreshLocationWatch();
  if (!trackPolyline) {
    trackPolyline = L.polyline([], {
      color: trackStyle?.color || '#000080',
      weight: trackStyle?.size || 4,
      opacity: 0.85
    }).addTo(map);
  }
  // 既に現在地が取得済なら、最初の点として打つ(待たずに描画開始する)。
  // このとき現在地マーカーを青丸から三角(移動記録現在地点)へ切り替える。
  if (currentLocationMarker) {
    const ll = currentLocationMarker.getLatLng();
    appendTrackPoint([ll.lat, ll.lng]);
    updateTrackCurrentMarker(ll);
    map.removeLayer(currentLocationMarker);
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

// 移動記録の表示(線・開始点・現在地点)を全削除する。
// 「移動経路をクリア」ボタンからのみ呼び出す(トグル OFF では消さない)。
export function clearTrack() {
  const map = getMap();
  isRecordingTrack = false;
  if (trackPolyline) {
    map.removeLayer(trackPolyline);
    trackPolyline = null;
  }
  if (trackStartMarker) {
    map.removeLayer(trackStartMarker);
    trackStartMarker = null;
  }
  if (trackCurrentMarker) {
    map.removeLayer(trackCurrentMarker);
    trackCurrentMarker = null;
  }
  lastTrackLatLng = null;
  lastTrackTimeMs = 0;
}

// 記録点追加時の通知先(app.js がパネル内の統計表の更新に使用)
let onTrackPointAppended = null;
export function setOnTrackPointAppended(fn) { onTrackPointAppended = fn; }

// 記録点を追加: 線に頂点を足し、最初の点なら開始点マーカー、
// 毎回 現在地点マーカー(進行方向つき)を最終点へ更新する。
function appendTrackPoint(latlng) {
  if (!trackPolyline) return;
  const map = getMap();
  const wasEmpty = trackPolyline.getLatLngs().length === 0;
  trackPolyline.addLatLng(latlng);
  const lat = Array.isArray(latlng) ? latlng[0] : latlng.lat;
  const lng = Array.isArray(latlng) ? latlng[1] : latlng.lng;

  // 開始地点マーカー(最初の記録点のみ)
  if (wasEmpty) {
    if (trackStartMarker) {
      map.removeLayer(trackStartMarker);
      trackStartMarker = null;
    }
    trackStartMarker = L.marker([lat, lng], {
      icon: buildShapeIcon(trackStartStyle, 'square')
    }).addTo(map);
  }

  // 現在地点マーカー(三角)の位置・向きは呼び出し側(記録中はライブ現在地)で更新する。
  lastTrackLatLng = [lat, lng];
  lastTrackTimeMs = Date.now();
  onTrackPointAppended?.();
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
  if (!getMap() || geoWatchId != null) return; // 既に監視中
  if (!('geolocation' in navigator)) {
    reportLocationError(t('geo.notSupported'));
    return;
  }
  locationErrorReported = false;
  geoWatchId = navigator.geolocation.watchPosition(
    onGeoSuccess,
    (err) => reportLocationError(t('geo.fetchFailed', { message: err.message })),
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
  const map = getMap();
  const { latitude, longitude, accuracy } = pos.coords;
  const latlng = [latitude, longitude];
  lastKnownLatLng = latlng;
  // 初回の位置取得かどうか(初回は遠距離になり得るためアニメ無しで移動)
  const isFirstFix = !hasHadFirstFix;
  hasHadFirstFix = true;

  // 現在地マーカー(青丸): 「現在地点をマーカー表示」ON かつ 非記録中のみ表示。
  // 記録中はライブ現在地を三角(移動記録現在地点)で表すため青丸は出さない。
  if (showCurrentMarker && !isRecordingTrack) {
    showOrUpdateCurrentMarker(latlng);
  } else {
    removeCurrentMarker();
  }

  lastKnownAccuracy = Number.isFinite(accuracy) ? accuracy : null;

  // 精度円(現在地点を中心とする円): 常時表示はしない。
  // マップ表示への切替時・「現在地点をマーカー表示」ON 時に3秒間だけ表示する。
  // - pendingCircleShow: 表示要求済みで位置が未取得だった → 取得できたので3秒間の表示を開始
  // - 表示中(タイマー作動中): 現在地へ追従する(タイマーは延長しない)
  if (showCurrentMarker && Number.isFinite(accuracy)) {
    if (pendingCircleShow) {
      showTemporaryCircle(latlng, accuracy);
    } else if (currentLocationCircle) {
      showOrUpdateCurrentCircle(latlng, accuracy);
    }
  } else {
    removeCurrentCircle();
    pendingCircleShow = false;
  }

  // 記録中: 条件を満たせば記録点を追加し、三角をライブ現在地へ追従(進行方向つき)
  if (isRecordingTrack) {
    if (shouldRecordTrackPoint(latlng, Date.now())) appendTrackPoint(latlng);
    updateTrackCurrentMarker(latlng);
  }

  // 「現在地点は中央に表示」ON のとき、現在地が画面中央に来るよう地図を追従させる
  if (followCurrentLocation) {
    if (isFirstFix) map.setView(latlng, map.getZoom());
    else map.panTo(latlng);
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
    }).addTo(getMap());
    currentLocationMarker.bindPopup('現在地');
  } else {
    currentLocationMarker.setLatLng(latlng);
  }
}

function removeCurrentMarker() {
  if (currentLocationMarker) {
    getMap().removeLayer(currentLocationMarker);
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
    }).addTo(getMap());
  } else {
    currentLocationCircle.setLatLng(latlng);
    currentLocationCircle.setRadius(accuracy);
  }
}

function removeCurrentCircle() {
  if (circleHideTimerId != null) {
    clearTimeout(circleHideTimerId);
    circleHideTimerId = null;
  }
  if (currentLocationCircle) {
    getMap().removeLayer(currentLocationCircle);
    currentLocationCircle = null;
  }
}

// ===== 現在地点を中心とする円の一時表示(3秒) =====
// 円の一時表示を要求する。位置が分かっていれば即表示し、
// 未取得なら次に位置を取得したとき(onGeoSuccess)に表示する。
// マップ表示中でマーカー表示 ON のときのみ有効。
function requestCurrentCircleFlash() {
  if (!getMap() || !onMapView || !showCurrentMarker) return;
  if (lastKnownLatLng && Number.isFinite(lastKnownAccuracy)) {
    showTemporaryCircle(lastKnownLatLng, lastKnownAccuracy);
  } else {
    pendingCircleShow = true;
  }
}

// 円を表示し、3秒後に自動で消すタイマーを(再)設定する
function showTemporaryCircle(latlng, accuracy) {
  pendingCircleShow = false;
  if (circleHideTimerId != null) clearTimeout(circleHideTimerId);
  showOrUpdateCurrentCircle(latlng, accuracy);
  circleHideTimerId = setTimeout(removeCurrentCircle, CURRENT_CIRCLE_DURATION_MS);
}

// マップビューの出入りで現在地監視を制御する。
// active=true でマップ表示中とみなして必要なら監視開始、false で監視停止・マーカー除去。
// onError は位置情報取得失敗時の通知に使う(指定時に記憶し、以降の監視でも使用)。
export function setLocationActiveForMapView(active, { onError } = {}) {
  onMapView = active;
  if (onError) locationErrorCb = onError;
  refreshLocationWatch();
  // マップ表示に切り替えたら、現在地点を中心とする円を3秒間だけ表示する
  // (マーカー表示 ON のときのみ。位置未取得なら初回取得時に表示)
  if (active) requestCurrentCircleFlash();
}

// 「現在地点をマーカー表示」トグル。OFF で青丸・精度円を消す。
// ON にした直後は、直近の取得位置があれば即座にマーカーを再表示し、
// あわせて現在地点を中心とする円を3秒間だけ表示する。
export function setCurrentMarkerVisible(on) {
  showCurrentMarker = on;
  if (!on) {
    removeCurrentMarker();
    removeCurrentCircle();
  } else {
    if (lastKnownLatLng && !isRecordingTrack) {
      showOrUpdateCurrentMarker(lastKnownLatLng);
    }
    // ON にしたら現在地点を中心とする円を3秒間だけ表示する
    // (マップ表示中のみ。位置未取得なら初回取得時に表示)
    requestCurrentCircleFlash();
  }
  refreshLocationWatch();
}

// 「現在地点は中央に表示」トグル。ON にした直後、直近の取得位置があれば即追従。
export function setFollowCurrentLocation(on) {
  followCurrentLocation = on;
  const map = getMap();
  if (on && lastKnownLatLng && map) {
    map.panTo(lastKnownLatLng);
  }
  refreshLocationWatch();
}
