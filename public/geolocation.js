// 現在地表示 + 移動記録(移動経路の記録)モジュール(map.js から分離)
// Geolocation API による現在地マーカー(青丸)。測位精度(accuracy)を半径とする
// 精度円は表示しない(大きさが測位状況で変わり、意味が伝わらないため)。
// 現在地点表示ボタンは、現在地を画面中央へ寄せたうえで現在地点を中心とする
// 薄い青の図形を出し、端末の向きが取れていれば扇形にしてから縮めて消す
// (showCurrentLocationSpot。方位は orientation.js から受け取る)。
// 監視(watchPosition)は、記録中は常に、それ以外はマップビュー表示中で
// 「現在地点をマーカー表示」「現在地点は中央に表示」のいずれかが有効なときに動く
// (refreshLocationWatch が制御)。記録中に起動時画面へ移動しても記録は継続する。
// マーカー表示は showCurrentMarker、地図追従は followCurrentLocation で切り替える。
// 地図追従は「現在地点をマーカー表示」も ON のときだけ働く(shouldFollowMap)。
// マーカーが出ていないのに地図だけが動くと、何に追従しているのかが画面から分からないため。
// 記録中(startTrackRecording 後)は、位置更新ごとに軌跡(ポリライン + 通過点マーカー)を追加する。
// 記録点は「20m 以上移動」または「60秒以上経過」で追加するため、その間は経路の先端が
// 現在地に届かない。そこで最終記録地点から現在地点までを同じスタイルの線でつなぐ。
// 移動経路(経路)は複数保持できる。1回の記録、および読み込んだGPXの1セグメントが
// それぞれ1本の経路になり、経路ごとに開始点・終了点のマーカーを持つ。
// 記録中は画面スリープを防止し(Screen Wake Lock API)、他アプリへの切替などで
// ページが非表示になった場合は、復帰時に監視の張り直しと現在地の取得を行う。
// 地図インスタンスは map.js の getMap() を通じて共有する。
import * as L from 'leaflet';
import { getMap, buildMarkerIcon, ensureMapSize } from './map.js';
import { t } from './i18n.js';
import { getHeading } from './orientation.js';

let currentLocationMarker = null;
let geoWatchId = null;
// マップビュー表示中か(ビュー外では現在地を監視しない)
let onMapView = false;
// 現在地点をマーカー表示(メニュートグル・既定 ON)
let showCurrentMarker = true;
// 現在地を地図中央に表示=現在地へ追従(メニュートグル・既定 ON)。
// 実際に地図を動かす条件は shouldFollowMap()(マーカー表示 ON かつマップ画面表示中)。
let followCurrentLocation = true;
// 次に地図を現在地へ寄せるとき、アニメ無しで一気に移動するか。
// 追従を ON にした直後(およびマーカー表示を ON に戻した直後)は現在地が画面外のこともあるため、
// 最初の1回はアニメ無しで寄せる。
// 実際に地図を動かしたときだけ倒すので、地図が動かない条件のあいだに位置を取得しても倒れない。
let recenterWithoutAnimation = true;
// 直近に取得した現在地(トグル切替時の即時反映に使用)
let lastKnownLatLng = null;
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
  // 青丸は消さない。表示するかは「現在地点をマーカー表示」トグルだけで決まる。
  if (currentLocationMarker) {
    const ll = currentLocationMarker.getLatLng();
    appendTrackPoint(recordingTrack, [ll.lat, ll.lng]);
    updateRecordingLive(ll);
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
  // マーカー表示 ON なら現在地(青丸)を最新位置に合わせておく
  // (記録中も出しているので通常は既にあるが、無ければここで出す)。
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

// ===== 画面の向き・表示領域が変わったときの処理 =====
// 回転などで地図の大きさが変わったら測り直し、追従中なら現在地へ寄せ直す。
//
// iOS は回転直後の resize でまだ回転前の大きさを返すことがあり、Leaflet の
// 自動計測(trackResize)がその値で確定してしまう。以降 resize は来ないため、
// 縦画面なのに横画面の幅で中央を計算し続け、現在地が画面の外に出たままになる。
// そこで確定を待つ意味で「直後・次の描画・0.3秒後」の3回測り直し、
// 実際に大きさが変わっていたときだけ寄せ直す。
// (ページのピンチズームでは visualViewport だけが変わりコンテナの大きさは変わらないため、
//  ensureMapSize が false を返して寄せ直さない=勝手に地図が動かない)
function handleViewportChange() {
  const apply = () => {
    if (!ensureMapSize()) return;
    if (!shouldFollowMap() || !isLastFixFresh()) return;
    // 回転後は現在地が画面外にあることもあるため、アニメ無しで一気に寄せる
    recenterWithoutAnimation = true;
    moveMapToCurrentLocation(lastKnownLatLng);
  };
  apply();
  requestAnimationFrame(apply);
  setTimeout(apply, 300);
}

window.addEventListener('orientationchange', handleViewportChange);
window.addEventListener('resize', handleViewportChange);
window.visualViewport?.addEventListener('resize', handleViewportChange);

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
//
// 「現在地点は中央に表示」だけが ON のとき(マーカー表示は OFF)、地図は動かず
// (shouldFollowMap)、マーカーも出ないため画面上は何も起きない。それでも
// 監視を続けるのは意図した選択で、直近の測位を新しく保つため。
// 止めてしまうと、マーカー表示を ON に戻したときに直近位置が古すぎて
// (LAST_FIX_MAX_AGE_MS 超え)使えず、次の測位まで現在地が出ない・地図も寄らない。
// 「何も表示していないのに測位している」のは不具合ではないので、電池優先に振るとき以外は
// この条件を狭めないこと。
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
}

// 位置情報エラーの通知(1回の監視につき最初の1回のみ。連続エラーを抑制)
function reportLocationError(msg) {
  if (locationErrorReported) return;
  locationErrorReported = true;
  locationErrorCb && locationErrorCb(msg);
}

// 位置取得成功時の更新処理(マーカー表示・記録・地図追従)
function onGeoSuccess(pos) {
  const { latitude, longitude } = pos.coords;
  const latlng = [latitude, longitude];
  lastKnownLatLng = latlng;
  lastKnownAtMs = Date.now();

  // 現在地マーカー(青丸): 「現在地点をマーカー表示」ON なら表示する。
  // 記録中も出す(ライブ現在地は三角でも示すが、青丸を消す理由にはしない)。
  if (showCurrentMarker) {
    showOrUpdateCurrentMarker(latlng);
  } else {
    removeCurrentMarker();
  }

  // 記録中: 条件を満たせば記録点を追加し、三角をライブ現在地へ追従(進行方向つき)
  if (isRecordingTrack && recordingTrack) {
    if (shouldRecordTrackPoint(latlng, Date.now())) appendTrackPoint(recordingTrack, latlng);
    updateRecordingLive(latlng);
  }

  // 「現在地点は中央に表示」ON のとき、現在地が画面中央に来るよう地図を追従させる。
  // 記録中は起動時画面でも監視が続くため、マップ表示中に限って地図を動かす。
  if (shouldFollowMap()) moveMapToCurrentLocation(latlng);
}

// いま地図を現在地へ寄せてよいか。
// 「現在地点は中央に表示」に加えて「現在地点をマーカー表示」も ON であることを要求する。
// マーカーを出していないのに地図だけが動くと、何に追従しているのかが画面から分からず、
// 地図を自分で動かしても引き戻される理由が読めなくなるため。
// 地図を動かすのはマップ画面表示中のみ(記録中は起動時画面でも監視が続く)。
function shouldFollowMap() {
  return followCurrentLocation && showCurrentMarker && onMapView;
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
  // 寄せる前に地図の大きさを測り直す。覚え違いのまま寄せると、Leaflet が中央だと
  // 思う座標が実際の中央からずれ、現在地が画面の外に置かれる(ensureMapSize 参照)。
  // 回転時のイベントを取りこぼしても、次の位置更新でここが直してくれる。
  ensureMapSize();
  if (recenterWithoutAnimation) map.setView(latlng, map.getZoom(), { animate: false });
  else map.panTo(latlng);
  recenterWithoutAnimation = false;
}

// 現在地マーカー(青丸)の見た目。
const CURRENT_MARKER_STYLE = {
  radius: 7,
  color: '#ffffff',
  weight: 2,
  fillColor: '#1d4ed8',
  fillOpacity: 0.95
};

// 現在地マーカー(青丸)の生成・更新
function showOrUpdateCurrentMarker(latlng) {
  if (!currentLocationMarker) {
    currentLocationMarker = L.circleMarker(latlng, CURRENT_MARKER_STYLE).addTo(getMap());
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

// ===== 現在地点表示ボタン(ズームボタンの上)の単発表示 =====
// 押すと現在地を画面中央へ寄せ、現在地点を中心とする薄い青の図形を出して消す、単発の操作。
// 図形は次の順に変わる:
//   1. 円で出す
//   2. 端末の向き(方位)が取れていれば、1秒かけて円をその方位の扇形へすぼめる(開き40度)
//   3. 3秒かけて縮めてから消す
// 方位が取れない端末(PC・許可が下りなかった場合)は 2 を飛ばし、円のまま 3 だけ行う。
//
// 大きさは地図の縮尺ではなく画面の大きさで決める(地図の短辺に対する割合)。直径は
// 短辺の70% から 短辺の10% まで一定の速さで縮む。半径をメートルで指定する L.circle は
// 使えないため、毎フレーム画面座標で頂点を作って緯度経度へ戻した L.polygon で描く
// (円も「開き360度の扇形」として同じ経路で描くので、円 → 扇形が途切れずつながる)。
//
// 扇形は方位を**その場で**読み直しながら描くため、表示中に端末を回すと追従する。
//
// 青丸(現在地マーカー)はこのボタンでは出し分けない。メニューの
// 「現在地点をマーカー表示」が ON なら現在地へ青丸を出し、OFF なら出さない
// (このボタン専用の青丸を持つと、トグル OFF のときだけ青丸が出る・消えるといった
//  トグルと食い違う見え方になるため、表示の可否はトグルに一本化する)。
const SPOT_CIRCLE_DURATION_MS = 3000;   // 縮小にかける時間
const SPOT_CIRCLE_START_RATIO = 0.70;   // 表示開始時の直径 / 地図の短辺
const SPOT_CIRCLE_END_RATIO = 0.10;     // 縮小後の直径 / 地図の短辺
const SPOT_FAN_MORPH_MS = 1000;         // 円 → 扇形にすぼめるのにかける時間
const SPOT_FAN_ANGLE_DEG = 40;          // 扇形の開き
const SPOT_ARC_STEP_DEG = 4;            // 円弧を折れ線で描くきざみ
// 薄い青の円。地図の記載が透けて読めるよう塗りは薄くする
const SPOT_CIRCLE_STYLE = {
  color: '#60a5fa',
  weight: 2,
  opacity: 0.8,
  fillColor: '#93c5fd',
  fillOpacity: 0.2,
  // 地図上の他の線(ルート・移動経路)と見分けるための目印
  className: 'current-spot-shape'
};

let spotShape = null;           // 表示中の円/扇形
let spotAnimFrameId = null;     // アニメーションの requestAnimationFrame ID
let spotEndCb = null;           // 終了(表示しきった・測位失敗)をボタンへ知らせる

// 現在地点表示ボタンが押されたときの処理。
// 直近の測位が新しければ即座に、そうでなければ1回だけ測位してから表示する
// (監視は両トグル OFF のあいだ止まっているため、古い位置を現在地として出さない)。
// onEnd は表示が終わったとき(3秒経過・測位失敗)に呼ぶ。ボタンを灰色へ戻すのに使う。
export function showCurrentLocationSpot({ onEnd } = {}) {
  const map = getMap();
  if (!map) { onEnd?.(); return; }
  // 連打されたら前回の表示を畳んでから出し直す(アニメーションの取り違えを避ける)
  clearCurrentLocationSpot();
  spotEndCb = onEnd;

  if (isLastFixFresh()) {
    renderCurrentLocationSpot(lastKnownLatLng);
    return;
  }
  if (!('geolocation' in navigator)) {
    reportLocationError(t('geo.notSupported'));
    endCurrentLocationSpot();
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      lastKnownLatLng = [latitude, longitude];
      lastKnownAtMs = Date.now();
      renderCurrentLocationSpot(lastKnownLatLng);
    },
    (err) => {
      reportLocationError(t('geo.fetchFailed', { message: err.message }));
      endCurrentLocationSpot();
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
}

// 現在地を画面中央へ寄せてから円を出す。
function renderCurrentLocationSpot(latlng) {
  const map = getMap();
  if (!map) { endCurrentLocationSpot(); return; }
  // 先に地図を動かす。現在地が画面外のこともあるためアニメ無しで一気に寄せる
  // (追従(setFollowCurrentLocation)とは別系統なので recenterWithoutAnimation は触らない)。
  // 寄せる前に大きさを測り直す(中央がずれるのを防ぐ。円の大きさも短辺から決めるため)。
  ensureMapSize();
  map.setView(latlng, map.getZoom(), { animate: false });
  // 青丸は「現在地点をマーカー表示」に従う。OFF のときは出さない(3秒後も触らない)
  if (showCurrentMarker) showOrUpdateCurrentMarker(latlng);
  startSpotCircle(latlng);
}

// 扇形(開きが360度なら円)の頂点を作る。
// 大きさを画面の大きさで決めるため、いったん画面座標で頂点を置いてから緯度経度へ戻す。
// headingDeg は扇形の中心が向く方位(真北=0・東回り)、sweepDeg は開き。
function spotShapePoints(center, radiusPx, headingDeg, sweepDeg) {
  const map = getMap();
  const origin = map.latLngToLayerPoint(center);
  const isFull = sweepDeg >= 360;
  const steps = Math.max(8, Math.round(sweepDeg / SPOT_ARC_STEP_DEG));
  const from = isFull ? 0 : headingDeg - sweepDeg / 2;
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const rad = (from + (sweepDeg * i) / steps) * Math.PI / 180;
    // 方位(北=0・東回り)を画面座標へ。北は上(-y)、東は右(+x)
    points.push(map.layerPointToLatLng(L.point(
      origin.x + radiusPx * Math.sin(rad),
      origin.y - radiusPx * Math.cos(rad)
    )));
  }
  // 扇形は中心へ戻して閉じる(円は外周だけでよい)
  if (!isFull) points.push(center);
  return points;
}

// 現在地点を中心に、地図の短辺の70%の大きさで出す。
// 方位が取れていれば 1秒かけて扇形へすぼめ、そのあと 3秒かけて10%まで縮めて消す。
function startSpotCircle(latlng) {
  const map = getMap();
  const size = map.getSize();
  const shortSide = Math.min(size.x, size.y);
  // 指定は直径なので半分にして半径[px]にする
  const startRadius = shortSide * SPOT_CIRCLE_START_RATIO / 2;
  const endRadius = shortSide * SPOT_CIRCLE_END_RATIO / 2;
  const center = L.latLng(latlng);

  // 方位が取れる端末でだけ扇形にする。取れなければ従来どおり円のまま縮める。
  // 表示中に方位が失われることはない(受信を止めても直近の値は残る)ため、開始時に決めてよい
  const useFan = getHeading() !== null;
  const morphMs = useFan ? SPOT_FAN_MORPH_MS : 0;
  const totalMs = morphMs + SPOT_CIRCLE_DURATION_MS;

  spotShape = L.polygon(
    spotShapePoints(center, startRadius, 0, 360),
    SPOT_CIRCLE_STYLE
  ).addTo(map);

  const startedAt = performance.now();
  const step = (now) => {
    if (!spotShape) return;   // 連打・画面切替で片付け済み
    const elapsed = now - startedAt;
    let radius;
    let sweep;
    if (elapsed < morphMs) {
      // 1) 円 → 扇形。大きさは変えず、開きだけ 360度 から 40度 へすぼめる
      radius = startRadius;
      sweep = 360 + (SPOT_FAN_ANGLE_DEG - 360) * (elapsed / morphMs);
    } else {
      // 2) 縮小。扇形になっていれば開きは保ったまま小さくする
      const progress = Math.min(1, (elapsed - morphMs) / SPOT_CIRCLE_DURATION_MS);
      radius = startRadius + (endRadius - startRadius) * progress;
      sweep = useFan ? SPOT_FAN_ANGLE_DEG : 360;
    }
    // 方位は毎フレーム読み直す(表示中に端末を回しても扇形が追従する)
    const heading = useFan ? (getHeading() ?? 0) : 0;
    spotShape.setLatLngs(spotShapePoints(center, radius, heading, sweep));
    if (elapsed < totalMs) {
      spotAnimFrameId = requestAnimationFrame(step);
    } else {
      // 出しきったら消し、ボタンを灰色へ戻す
      spotAnimFrameId = null;
      endCurrentLocationSpot();
    }
  };
  spotAnimFrameId = requestAnimationFrame(step);
}

// 3秒経過・測位失敗の後片付け。ボタンを灰色へ戻すため onEnd を必ず呼ぶ。
function endCurrentLocationSpot() {
  clearCurrentLocationSpot();
  const cb = spotEndCb;
  spotEndCb = null;
  cb?.();
}

// このボタンが出した円/扇形だけを消す(現在地マーカーには触れない)
function clearCurrentLocationSpot() {
  if (spotAnimFrameId != null) {
    cancelAnimationFrame(spotAnimFrameId);
    spotAnimFrameId = null;
  }
  if (spotShape) {
    getMap()?.removeLayer(spotShape);
    spotShape = null;
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

// 「現在地点をマーカー表示」トグル。OFF で青丸を消す。
// ON にした直後は、直近の取得位置が新しければ即座にマーカーを再表示する。
// 古い位置しか無いときは表示せず次の取得を待つ(実際とは違う地点に青丸を出さない)。
// このトグルは地図追従の前提でもある(shouldFollowMap)。OFF のあいだは
// 「現在地点は中央に表示」が ON でも地図は動かず、ON に戻した時点で追従を再開する。
export function setCurrentMarkerVisible(on) {
  showCurrentMarker = on;
  if (!on) {
    removeCurrentMarker();
  } else {
    if (isLastFixFresh()) {
      showOrUpdateCurrentMarker(lastKnownLatLng);
    }
    // 追従が ON なら、ここで初めて条件がそろう。次の測位を待たずに寄せる
    // (「現在地点は中央に表示」を ON にしたときと同じ振る舞いにそろえる)。
    // OFF のあいだは地図を自由に動かせるため現在地が画面外のこともある。
    // 1回目はアニメ無しで一気に寄せる。
    if (shouldFollowMap()) {
      recenterWithoutAnimation = true;
      if (isLastFixFresh()) moveMapToCurrentLocation(lastKnownLatLng);
    }
  }
  refreshLocationWatch();
}

// 「現在地点は中央に表示」トグル。
// ON にした直後は、直近の取得位置が新しければ即座に現在地を中央へ寄せる。
// 古い位置しか無いときは寄せずに次の取得を待つ。監視は両トグル OFF・マップ画面を
// 離れているあいだ止まるため、そこへ寄せると現在地から離れた地点が中央に表示されてしまう。
// ただし「現在地点をマーカー表示」が OFF のあいだは、このトグルを ON にしても地図は
// 動かない(shouldFollowMap)。マーカーを ON に戻した時点で追従が始まる。
export function setFollowCurrentLocation(on) {
  followCurrentLocation = on;
  if (on) {
    // 追従を始めてからの1回目はアニメ無しで寄せる(現在地が画面外のこともあるため)
    recenterWithoutAnimation = true;
    if (shouldFollowMap() && isLastFixFresh()) moveMapToCurrentLocation(lastKnownLatLng);
  }
  refreshLocationWatch();
}
