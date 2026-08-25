// 現在地表示 + 移動記録(移動経路の記録)モジュール(map.js から分離)
// Geolocation API による現在地マーカー + 精度円(現在地点を中心とする円)。
// 精度円は常時表示せず、マップ表示への切替時・「現在地点をマーカー表示」ON 時に
// 3秒間だけ表示する(requestCurrentCircleFlash / showTemporaryCircle)。
// 監視(watchPosition)は、記録中は常に、それ以外はマップビュー表示中で
// 「現在地点をマーカー表示」「現在地点は中央に表示」のいずれかが有効なときに動く
// (refreshLocationWatch が制御)。記録中に起動時画面へ移動しても記録は継続する。
// マーカー表示は showCurrentMarker、地図追従は followCurrentLocation で個別に切り替える。
// 記録中(startTrackRecording 後)は、位置更新ごとに軌跡(ポリライン + 通過点マーカー)を追加する。
// 記録点は「20m 以上移動」または「60秒以上経過」で追加するため、その間は経路の先端が
// 現在地に届かない。そこで最終記録地点から現在地点までを同じスタイルの線でつなぐ。
// 移動経路(経路)は複数保持できる。1回の記録、および読み込んだGPXの1セグメントが
// それぞれ1本の経路になり、経路ごとに開始点・終了点のマーカーを持つ。
// 記録中は画面スリープを防止し(Screen Wake Lock API)、他アプリへの切替などで
// ページが非表示になった場合は、復帰時に監視の張り直しと現在地の取得を行う。
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
// 次に地図を現在地へ寄せるとき、アニメ無しで一気に移動するか。
// 追従を ON にした直後は現在地が画面外(遠距離)のこともあるため、最初の1回はアニメ無しで寄せる。
// 実際に地図を動かしたときだけ倒すので、追従 OFF のあいだに位置を取得しても倒れない。
let recenterWithoutAnimation = true;
// 直近に取得した現在地(トグル切替時の即時反映に使用)
let lastKnownLatLng = null;
// 直近に取得した位置精度[m](円の即時表示に使用)
let lastKnownAccuracy = null;
// 直近の位置を取得した時刻[ms]。監視を止めているあいだ位置は更新されず古くなるため、
// トグル切替時の即時反映では鮮度を確かめてから使う(isLastFixFresh)
let lastKnownAtMs = 0;
// 直近の位置を「現在地」として即時反映してよい上限。これより古い位置は使わず次の取得を待つ。
// 監視は両トグル OFF・マップ画面を離れたときに止まるため、再開直後の直近位置は
// 何分も前の地点でありうる。そこへ地図を寄せると現在地から離れた場所が表示されてしまう
const LAST_FIX_MAX_AGE_MS = 30 * 1000;
// 位置情報エラーの通知コールバックと、監視中に通知済みかのフラグ(連続エラーの抑制)
let locationErrorCb = null;
let locationErrorReported = false;

// 移動記録(移動経路)
// 「移動した」の判定: 直近の記録点から 20m 以上離れたか、1 分以上経過した場合に記録
const TRACK_MIN_DISTANCE_M = 20;
const TRACK_MIN_INTERVAL_MS = 60 * 1000;
let isRecordingTrack = false;
// 移動経路(経路)の一覧。1本 = 1回の記録、または読み込んだGPXの1セグメント。
// 各要素は次の形: {
//   polyline:    記録点を順に結ぶ線(移動記録経路)
//   startMarker: 開始点マーカー(最初の記録点)
//   endMarker:   終了点マーカー(最終記録点・進行方向つき。記録中はライブ現在地)
//   times:       各記録点の記録時刻(ms)。polyline の頂点と同順で保持し、
//                GPX出力の <time> と、出力ファイル名の日付の決定に使う
// }
let tracks = [];
// 記録中の経路(常に tracks の末尾)。記録していないときは null。
let recordingTrack = null;
// 最終記録地点と現在地点(ライブ)を結ぶ線。記録条件(20m/60秒)を満たすまでは
// 記録点が増えないため、この線が無いと経路が現在地まで届かず途切れて見える。
// 移動記録経路と同じスタイルで描き、記録停止・クリア時は消す。
let trackLeadLine = null;
let trackStyle = null;           // 線のスタイル(移動記録経路)
let trackStartStyle = null;      // 開始点マーカーのスタイル(移動記録開始点)
let trackCurrentStyle = null;    // 終了点マーカーのスタイル(移動記録現在地点)
// 記録中の経路について、直近に記録した地点と時刻(記録条件の判定に使う)。
// 経路を新しく作るたびにリセットし、新しい経路の1点目は必ず記録する。
let lastTrackLatLng = null;
let lastTrackTimeMs = 0;

// 移動記録経路(線)の描画オプション。経路本体と、現在地点までを結ぶ線で共用する。
function trackLineOptions() {
  return {
    color: trackStyle?.color || '#000080',
    weight: trackStyle?.size || 4,
    opacity: 0.85
  };
}

export function setTrackStyle(style) {
  trackStyle = style;
  const { color, weight } = trackLineOptions();
  for (const track of tracks) track.polyline.setStyle({ color, weight });
  if (trackLeadLine) trackLeadLine.setStyle({ color, weight });
}

// 移動記録開始点マーカーのスタイル。全経路の既存マーカーへ即時反映。
export function setTrackStartStyle(style) {
  trackStartStyle = style;
  const icon = buildShapeIcon(trackStartStyle, 'square');
  for (const track of tracks) {
    if (track.startMarker) track.startMarker.setIcon(icon);
  }
}

// 移動記録現在地点(終了点)マーカーのスタイル。全経路の既存マーカーへ即時反映
// (進行方向を再計算。記録中の経路はライブ現在地の位置を保つ)。
export function setTrackCurrentStyle(style) {
  trackCurrentStyle = style;
  for (const track of tracks) {
    if (!track.endMarker) continue;
    updateTrackEndMarker(track, track === recordingTrack ? lastKnownLatLng : null);
  }
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

// 経路の終了点マーカー(三角)を配置し、進行方向に回転させる。
// liveLatLng を与えると現在地(ライブ)へ、無ければ最終記録点へ配置する。
function updateTrackEndMarker(track, liveLatLng) {
  const map = getMap();
  if (!track || !map) return;
  const latlngs = track.polyline.getLatLngs();
  if (latlngs.length === 0) return;
  const pos = liveLatLng ? L.latLng(liveLatLng) : latlngs[latlngs.length - 1];
  const icon = buildShapeIcon(trackCurrentStyle, 'triangle', computeHeading(latlngs, pos));
  if (!track.endMarker) {
    track.endMarker = L.marker(pos, { icon }).addTo(map);
  } else {
    track.endMarker.setLatLng(pos);
    track.endMarker.setIcon(icon);
  }
}

// 記録中の経路をライブ現在地へ追従させる(終了点マーカーと、最終記録点からの線)。
function updateRecordingLive(latlng) {
  if (!recordingTrack) return;
  updateTrackEndMarker(recordingTrack, latlng);
  updateTrackLeadLine(recordingTrack, latlng);
}

// 最終記録地点 → 現在地点(ライブ)を結ぶ線を更新する。
// live が null(記録停止時など)のとき、また現在地が最終記録地点とほぼ同じ位置の
// ときは線を消す(長さ 0 の線が点として残るのを避けるため)。
function updateTrackLeadLine(track, live) {
  const map = getMap();
  const latlngs = track ? track.polyline.getLatLngs() : [];
  if (!map || !live || latlngs.length === 0) {
    removeTrackLeadLine();
    return;
  }
  const last = latlngs[latlngs.length - 1];
  if (last.distanceTo(live) < 0.5) {
    removeTrackLeadLine();
    return;
  }
  if (!trackLeadLine) {
    trackLeadLine = L.polyline([last, live], trackLineOptions()).addTo(map);
  } else {
    trackLeadLine.setLatLngs([last, live]);
  }
}

function removeTrackLeadLine() {
  if (trackLeadLine) {
    getMap()?.removeLayer(trackLeadLine);
    trackLeadLine = null;
  }
}

// 移動記録を開始する。1回の記録が1本の経路になる。
// append=false: 表示中の経路をすべてクリアしてから記録する
// append=true : 表示中の経路を残し、新しい経路として追加で記録する
export function startTrackRecording({ append = false } = {}) {
  const map = getMap();
  if (!map) return;
  if (!append) clearTrack();
  isRecordingTrack = true;
  // 記録中は画面を消灯させない(消灯するとページが停止し記録が途切れるため)
  requestWakeLock();
  // マーカー表示・追従が両方 OFF でも、記録のため現在地監視を確実に開始する。
  refreshLocationWatch();
  recordingTrack = createTrack();
  // 既に現在地が取得済なら、最初の点として打つ(待たずに描画開始する)。
  // このとき現在地マーカーを青丸から三角(移動記録現在地点)へ切り替える。
  if (currentLocationMarker) {
    const ll = currentLocationMarker.getLatLng();
    appendTrackPoint(recordingTrack, [ll.lat, ll.lng]);
    updateRecordingLive(ll);
    map.removeLayer(currentLocationMarker);
    currentLocationMarker = null;
  }
}

// 空の経路を1本作って一覧の末尾に追加する。
// 記録条件の判定用の直近地点もリセットし、この経路の1点目を必ず記録させる。
function createTrack() {
  const track = {
    polyline: L.polyline([], trackLineOptions()).addTo(getMap()),
    startMarker: null,
    endMarker: null,
    times: []
  };
  tracks.push(track);
  lastTrackLatLng = null;
  lastTrackTimeMs = 0;
  return track;
}

// 経路の表示物(線・開始点・終了点)を地図から取り除く
function removeTrackLayers(track) {
  const map = getMap();
  if (!map || !track) return;
  map.removeLayer(track.polyline);
  if (track.startMarker) map.removeLayer(track.startMarker);
  if (track.endMarker) map.removeLayer(track.endMarker);
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
  // 記録が終わったら画面スリープ防止を解除する(電池消費を元に戻す)
  releaseWakeLock();
  if (recordingTrack) {
    if (recordingTrack.polyline.getLatLngs().length === 0) {
      // 位置が一度も取得できずに終わった経路は、地点数0の経路として残さず破棄する
      removeTrackLayers(recordingTrack);
      tracks = tracks.filter((tr) => tr !== recordingTrack);
    } else {
      // 三角(終了点)を最終記録点へスナップして固定する。
      updateTrackEndMarker(recordingTrack);
    }
  }
  removeTrackLeadLine();
  recordingTrack = null;
  // 記録停止後、マーカー表示 ON なら現在地(青丸)を再表示する。
  if (showCurrentMarker && lastKnownLatLng) showOrUpdateCurrentMarker(lastKnownLatLng);
  // 記録が監視を要求しなくなった場合に備えて監視状態を見直す。
  refreshLocationWatch();
}

// 1本の経路の統計(記録地点数・移動距離[m])
function statsOfTrack(track) {
  const latlngs = track.polyline.getLatLngs();
  let distanceM = 0;
  for (let i = 1; i < latlngs.length; i++) {
    distanceM += latlngs[i - 1].distanceTo(latlngs[i]);
  }
  return { pointCount: latlngs.length, distanceM };
}

// 経路ごとの統計を、表示順(記録・読み込みの順)で返す。
// 軌跡が消去(clearTrack)される前に呼ぶこと。
export function getTrackStatsList() {
  return tracks.map(statsOfTrack);
}

// 全経路を合わせた統計(記録地点数・合計移動距離[m])を返す。
// 軌跡が消去(clearTrack)される前に呼ぶこと。
export function getTrackStats() {
  return getTrackStatsList().reduce(
    (acc, s) => ({ pointCount: acc.pointCount + s.pointCount, distanceM: acc.distanceM + s.distanceM }),
    { pointCount: 0, distanceM: 0 }
  );
}

// 記録済みの移動経路を、経路ごとの点列({lat, lng, timeMs})の配列で返す(GPX出力に使用)。
// 軌跡が消去(clearTrack)される前に呼ぶこと。
export function getTrackSegments() {
  return tracks.map((track) => track.polyline.getLatLngs().map((ll, i) => ({
    lat: ll.lat,
    lng: ll.lng,
    timeMs: track.times[i] ?? null
  })));
}

// 外部から読み込んだ移動経路を、記録済みの経路として描画する。
// segments は経路ごとの点列({lat, lng, timeMs})の配列で、1セグメントが1本の経路になる。
// append=false: 表示中の経路をすべてクリアして置き換える
// append=true : 表示中の経路を残し、続きの経路として追加する
// (いずれも記録中は呼ばない。呼び出し側で抑止すること)
// 記録時刻はファイルの値をそのまま保持するため、読み込んだ経路をそのまま
// 「出力」で再出力できる。描画できた地点数の合計を返す。
export function loadTrackSegments(segments, { append = false } = {}) {
  const map = getMap();
  if (!map) return 0;
  const validSegments = (segments || [])
    .map((seg) => (seg || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)))
    .filter((seg) => seg.length > 0);
  if (validSegments.length === 0) return 0;

  if (!append) clearTrack();

  let loaded = 0;
  for (const seg of validSegments) {
    const track = createTrack();
    track.polyline.setLatLngs(seg.map((p) => [p.lat, p.lng]));
    track.times = seg.map((p) => (Number.isFinite(p.timeMs) ? p.timeMs : null));
    track.startMarker = L.marker([seg[0].lat, seg[0].lng], {
      icon: buildShapeIcon(trackStartStyle, 'square')
    }).addTo(map);
    // 終了点マーカー(三角)は最終地点へ。ライブ現在地は渡さないので中間線も出ない。
    updateTrackEndMarker(track);
    loaded += seg.length;
  }
  onTrackPointAppended?.();
  return loaded;
}

// 表示中の移動経路(全経路)の全体が収まるよう地図を合わせる(読み込み直後に使う)
export function fitMapToTrack() {
  const map = getMap();
  if (!map || tracks.length === 0) return;
  const bounds = tracks.reduce((acc, track) => acc.extend(track.polyline.getBounds()), L.latLngBounds([]));
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30] });
}

// 移動記録の表示(全経路の線・開始点・終了点)を全削除する。
// 「移動経路をクリア」ボタンと、記録・読み込みでの置き換え時に呼び出す
// (トグル OFF では消さない)。
export function clearTrack() {
  isRecordingTrack = false;
  releaseWakeLock();
  for (const track of tracks) removeTrackLayers(track);
  tracks = [];
  recordingTrack = null;
  removeTrackLeadLine();
  lastTrackLatLng = null;
  lastTrackTimeMs = 0;
}

// 記録点追加時の通知先(app.js がパネル内の統計表の更新に使用)
let onTrackPointAppended = null;
export function setOnTrackPointAppended(fn) { onTrackPointAppended = fn; }

// 記録点を追加: 経路の線に頂点を足し、最初の点なら開始点マーカーを置く。
function appendTrackPoint(track, latlng) {
  if (!track) return;
  const wasEmpty = track.polyline.getLatLngs().length === 0;
  track.polyline.addLatLng(latlng);
  const lat = Array.isArray(latlng) ? latlng[0] : latlng.lat;
  const lng = Array.isArray(latlng) ? latlng[1] : latlng.lng;

  // 開始地点マーカー(この経路の最初の記録点のみ)
  if (wasEmpty) {
    track.startMarker = L.marker([lat, lng], {
      icon: buildShapeIcon(trackStartStyle, 'square')
    }).addTo(getMap());
  }

  // 終了点マーカー(三角)の位置・向きは呼び出し側(記録中はライブ現在地)で更新する。
  lastTrackLatLng = [lat, lng];
  lastTrackTimeMs = Date.now();
  track.times.push(lastTrackTimeMs);
  onTrackPointAppended?.();
}

// ===== 画面スリープの防止(Screen Wake Lock API) =====
// 移動記録中は画面を消灯させない。消灯するとブラウザがページの実行を止めてしまい、
// 位置の監視(watchPosition)が動かず中間点が記録されないため。
// 非対応の端末・ブラウザ(iOS 16.3 以前など)や、省電力モード等で取得できない場合は
// 記録自体はそのまま続け、その旨を通知する(notifyTrack)。
let wakeLockSentinel = null;
// スリープ防止を取得できなかったことを一度だけ通知するためのフラグ(記録ごとにリセット)
let wakeLockNotified = false;

async function requestWakeLock() {
  if (wakeLockSentinel) return;
  if (!('wakeLock' in navigator)) {
    notifyWakeLockUnavailable();
    return;
  }
  try {
    wakeLockSentinel = await navigator.wakeLock.request('screen');
    // 非表示になる等で OS 側が解除したときは保持を破棄する
    // (復帰時に visibilitychange で取り直す)
    wakeLockSentinel.addEventListener('release', () => { wakeLockSentinel = null; });
  } catch {
    wakeLockSentinel = null;
    notifyWakeLockUnavailable();
  }
}

function notifyWakeLockUnavailable() {
  if (wakeLockNotified) return;
  wakeLockNotified = true;
  notifyTrack(t('track.wakeLockUnavailable'));
}

function releaseWakeLock() {
  const sentinel = wakeLockSentinel;
  wakeLockSentinel = null;
  wakeLockNotified = false;
  if (sentinel) sentinel.release().catch(() => { /* 既に解除済み */ });
}

// ===== バックグラウンド復帰時の処理 =====
// 他アプリへの切替や画面消灯でページが非表示になると、ブラウザは位置の監視を
// 停止・間引きする(Web の仕様上、完全なバックグラウンド測位はできない)。
// 復帰したら「スリープ防止の取り直し」「監視の張り直し」「現在地の即時取得」を行い、
// 非表示だった区間の記録の途切れをできるだけ短くする。
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (!isRecordingTrack) return;
  requestWakeLock();
  restartGeoWatch();
  captureCurrentPositionForTrack();
});

// 監視を張り直す(非表示中に OS/ブラウザ側で止められている場合への対処)。
// stopGeoWatch と違いマーカーは消さない。
function restartGeoWatch() {
  if (geoWatchId != null) {
    navigator.geolocation.clearWatch(geoWatchId);
    geoWatchId = null;
  }
  refreshLocationWatch();
}

// 復帰直後の現在地を1点だけ取得して記録に反映する(watchPosition の初回通知を待たない)。
// 記録条件(20m 以上 or 1分以上)は onGeoSuccess 側の判定をそのまま使う。
function captureCurrentPositionForTrack() {
  if (!('geolocation' in navigator)) return;
  navigator.geolocation.getCurrentPosition(
    onGeoSuccess,
    () => { /* 失敗しても watchPosition 側で通知されるためここでは何もしない */ },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
  );
}

// 移動記録に関する通知先(app.js が履歴・トーストへの出力に使用)
let onTrackNotice = null;
export function setOnTrackNotice(fn) { onTrackNotice = fn; }
function notifyTrack(msg) { onTrackNotice && onTrackNotice(msg); }

// ===== 現在地監視の制御 =====
// 監視(watchPosition)が必要か:
// - 移動記録中: 画面(ビュー)に関わらず常に必要。起動時画面へ移動しても記録を続けるため。
// - それ以外: マップビュー表示中で、現在地マーカー表示・現在地追従のいずれかが要求しているとき。
function needLocationWatch() {
  if (isRecordingTrack) return true;
  return onMapView && (showCurrentMarker || followCurrentLocation);
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
  lastKnownAtMs = Date.now();

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
  if (isRecordingTrack && recordingTrack) {
    if (shouldRecordTrackPoint(latlng, Date.now())) appendTrackPoint(recordingTrack, latlng);
    updateRecordingLive(latlng);
  }

  // 「現在地点は中央に表示」ON のとき、現在地が画面中央に来るよう地図を追従させる。
  // 記録中は起動時画面でも監視が続くため、マップ表示中に限って地図を動かす。
  if (followCurrentLocation && onMapView) moveMapToCurrentLocation(latlng);
}

// 直近の位置が「現在地」として使えるほど新しいか。
// 監視を止めているあいだは位置が更新されないため、再開直後は古い位置が残っている
function isLastFixFresh() {
  return !!lastKnownLatLng && (Date.now() - lastKnownAtMs) <= LAST_FIX_MAX_AGE_MS;
}

// 地図を現在地が中央に来る位置へ動かす。
// 追従を始めてからの1回目は現在地が画面外のこともあるためアニメ無しで一気に寄せ、
// 2回目以降(移動にともなう更新)はアニメ付きで滑らかに追従する
function moveMapToCurrentLocation(latlng) {
  const map = getMap();
  if (!map) return;
  if (recenterWithoutAnimation) map.setView(latlng, map.getZoom(), { animate: false });
  else map.panTo(latlng);
  recenterWithoutAnimation = false;
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
// 円の一時表示を要求する。新しい位置が分かっていれば即表示し、
// 未取得・古い位置しか無いなら次に位置を取得したとき(onGeoSuccess)に表示する。
// マップ表示中でマーカー表示 ON のときのみ有効。
function requestCurrentCircleFlash() {
  if (!getMap() || !onMapView || !showCurrentMarker) return;
  if (isLastFixFresh() && Number.isFinite(lastKnownAccuracy)) {
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
// ON にした直後は、直近の取得位置が新しければ即座にマーカーを再表示し、
// あわせて現在地点を中心とする円を3秒間だけ表示する。
// 古い位置しか無いときは表示せず次の取得を待つ(実際とは違う地点に青丸を出さない)。
export function setCurrentMarkerVisible(on) {
  showCurrentMarker = on;
  if (!on) {
    removeCurrentMarker();
    removeCurrentCircle();
  } else {
    if (isLastFixFresh() && !isRecordingTrack) {
      showOrUpdateCurrentMarker(lastKnownLatLng);
    }
    // ON にしたら現在地点を中心とする円を3秒間だけ表示する
    // (マップ表示中のみ。位置未取得なら初回取得時に表示)
    requestCurrentCircleFlash();
  }
  refreshLocationWatch();
}

// 「現在地点は中央に表示」トグル。
// ON にした直後は、直近の取得位置が新しければ即座に現在地を中央へ寄せる。
// 古い位置しか無いときは寄せずに次の取得を待つ。監視は両トグル OFF・マップ画面を
// 離れているあいだ止まるため、そこへ寄せると現在地から離れた地点が中央に表示されてしまう。
// 地図を動かすのはマップ画面表示中のみ(記録中は起動時画面でも監視が続くため)。
export function setFollowCurrentLocation(on) {
  followCurrentLocation = on;
  if (on) {
    // 追従を始めてからの1回目はアニメ無しで寄せる(現在地が画面外のこともあるため)
    recenterWithoutAnimation = true;
    if (onMapView && isLastFixFresh()) moveMapToCurrentLocation(lastKnownLatLng);
  }
  refreshLocationWatch();
}
