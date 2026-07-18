// アプリのエントリポイント
// - SPA ビュー切替(home / map / nav)+ 各モーダル
// - 現在地・移動記録(移動経路の記録)の操作の取りまとめ
// - 各機能モジュールの初期化と連携
//
// 機能別の実装は以下のモジュールに分離している:
//   tiles.js          … オフライン地図のDL・マニフェスト・更新バナー
//   update.js         … アプリシェルの更新確認
//   messages.js       … メッセージ履歴・トースト
//   marker-settings.js… マーカーの色・形状・サイズ設定
//   map.js            … Leaflet 地図・オーバーレイ
//   geolocation.js    … 現在地表示・移動経路の記録
//   closures.js       … 通行止め・通行困難地点の表示・編集・公開

import {
  initMap, resizeMap,
  loadEmergencyPointsLayer, setEmergencyPointsVisible,
  loadHikingRoutesLayer, setHikingRoutesVisible,
  setClosuresVisible, setClosureClosedStyle, setClosureDifficultStyle,
  getFeatureCounts
} from './map.js';
import {
  setLocationActiveForMapView, setCurrentMarkerVisible, setFollowCurrentLocation,
  setTrackStyle, setTrackStartStyle, setTrackCurrentStyle,
  startTrackRecording, stopTrackRecording, getTrackStats, clearTrack
} from './geolocation.js';
import {
  initClosures, applyClosureFlag, loadClosures,
  getClosureVersion, getClosureCount, autoCancelOnLeaveMap
} from './closures.js';
import { EMERGENCY_URL, HIKING_ROUTES_URL, LANGUAGE_KEY } from './config.js';
import { logHistory, renderMessageList, clearMessageLog, showToast } from './messages.js';
import {
  checkAppShellUpdate, promptAppShellUpdate, promptMapTileUpdate,
  readStartupUpdateCheckEnabled, writeStartupUpdateCheckEnabled,
  getCachedAppShellVersion
} from './update.js';
import {
  loadManifest, getManifestVersion, getSavedManifestVersion,
  evaluateManifestVersion, onSWControllerChange,
  openDownloadModal, refreshStorageInfo,
  migrateLegacyPackages, initTilesEvents, setStatus
} from './tiles.js';
import { readMarkerSettings, initMarkerSettings } from './marker-settings.js';

// ===== 状態 =====
let currentView = 'home';

// ===== DOM要素 =====
const el = {
  // ビュー
  views: {
    home: document.getElementById('viewHome'),
    map: document.getElementById('viewMap'),
    nav: document.getElementById('viewNav')
  },

  // ホーム
  btnOpenDownload: document.getElementById('btnOpenDownload'),
  btnOpenSettingsInfo: document.getElementById('btnOpenSettingsInfo'),

  // バージョン情報等モーダル(起動画面の「バージョン情報等」から表示)
  infoSettingsModal: document.getElementById('infoSettingsModal'),
  languageSelect: document.getElementById('languageSelect'),
  toggleStartupUpdateCheck: document.getElementById('toggleStartupUpdateCheck'),
  toggleInfoVersion: document.getElementById('toggleInfoVersion'),
  infoVersionBody: document.getElementById('infoVersionBody'),
  toggleInfoMessages: document.getElementById('toggleInfoMessages'),
  infoMessagesBody: document.getElementById('infoMessagesBody'),
  toggleInfoAbout: document.getElementById('toggleInfoAbout'),
  infoAboutBody: document.getElementById('infoAboutBody'),
  versionManifest: document.getElementById('versionManifest'),
  versionAppShell: document.getElementById('versionAppShell'),
  // 通行止め・通行困難地点のバージョン表示欄(バージョン情報内)
  versionClosures: document.getElementById('versionClosures'),
  btnClearMessages: document.getElementById('btnClearMessages'),

  // マップ
  btnMapLayers: document.getElementById('btnMapLayers'),
  mapLayerPanel: document.getElementById('mapLayerPanel'),
  mapClock: document.getElementById('mapClock'),
  toggleClock: document.getElementById('toggleClock'),
  // データ件数表示(ポイント/ルート/スポット/通行止め)
  countPoints: document.getElementById('countPoints'),
  countRoutes: document.getElementById('countRoutes'),
  countSpots: document.getElementById('countSpots'),
  countClosures: document.getElementById('countClosures'),
  // 現在地点の表示・地図追従トグル(移動経路を記録の上に配置)
  toggleCurrentMarker: document.getElementById('toggleCurrentMarker'),
  toggleCenterCurrent: document.getElementById('toggleCenterCurrent'),
  toggleTrackRecording: document.getElementById('toggleTrackRecording'),
  // 移動経路を記録 ON のとき表示する操作ボタン群(記録開始・停止トグル/写真撮影)
  mapTrackActions: document.getElementById('mapTrackActions'),
  btnTrackToggle: document.getElementById('btnTrackToggle'),
  btnTrackPhoto: document.getElementById('btnTrackPhoto'),
  // レイヤーパネル内: 移動経路の統計表示(サイズ)・クリア
  btnTrackStats: document.getElementById('btnTrackStats'),
  btnTrackClear: document.getElementById('btnTrackClear'),

  // マーカーの設定モーダル
  settingsModal: document.getElementById('settingsModal'),

  // マップ画面メニュー内の設定ショートカット
  btnMapOpenMarkerSettings: document.getElementById('btnMapOpenMarkerSettings')
};

// ===== 初期化 =====
async function init() {
  // MapGPS からの起動フラグはネットワークに依存しないため最初に反映する
  applyClosureFlag();
  await loadManifest();

  // SW 登録 + 更新検知
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('service-worker.js');
    } catch (err) {
      console.warn('SW登録失敗:', err);
    }
    navigator.serviceWorker.addEventListener('controllerchange', onSWControllerChange);
  }

  bindEvents();
  initTilesEvents();
  initClosures({ showView, isMapView: () => currentView === 'map' });
  initMarkerSettings();
  renderMessageList();
  await migrateLegacyPackages();
  await refreshStorageInfo();
  evaluateManifestVersion();
  // 起動時に確認したバージョンを履歴に残す
  logStartupVersionCheck();
  // service-worker.js の SHELL_CACHE とキャッシュ済みバージョンを比較し
  // 不一致なら confirm を出してアプリ全体を最新に更新
  // (「起動時にアプリの更新版を確認」が ON のときのみ)
  if (readStartupUpdateCheckEnabled()) checkAppShellUpdate();

  // 共有地図を初期化(箕面大滝中心 / z=15、ホーム/マップで共通)
  initMap('map');
  // 各オーバーレイはバックグラウンドで読込み、map ビュー時のみ表示。
  // マーカースタイルは保存済み設定(無ければ config.js の既定値)を初期描画に反映。
  const markerSettings = readMarkerSettings();
  loadEmergencyPointsLayer(EMERGENCY_URL, markerSettings.emergency).then(() => {
    if (currentView === 'map') setEmergencyPointsVisible(true);
    updateFeatureCounts();
  });
  loadHikingRoutesLayer(HIKING_ROUTES_URL, markerSettings.hikingRoute, markerSettings.spot).then(() => {
    if (currentView === 'map') setHikingRoutesVisible(true);
    updateFeatureCounts();
  });
  // 通行止め・通行困難地点のマーカースタイルは読込前に設定しておく
  // (setClosureGeoJSON でのレイヤー構築時に反映される)
  setClosureClosedStyle(markerSettings.closureClosed);
  setClosureDifficultStyle(markerSettings.closureDifficult);
  loadClosures().then(() => {
    if (currentView === 'map') setClosuresVisible(true);
    updateFeatureCounts();
  });
  setTrackStyle(markerSettings.track);
  setTrackStartStyle(markerSettings.trackStart);
  setTrackCurrentStyle(markerSettings.trackCurrent);

  // 初期表示はホーム(オーバーレイは非表示のまま)
  showView('home');
  requestAnimationFrame(() => resizeMap());
}

function bindEvents() {
  // ホームメニュー: data-view 属性でビュー切替
  for (const btn of document.querySelectorAll('[data-view]')) {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  }
  el.btnOpenDownload.addEventListener('click', openDownloadModal);
  // 起動画面の「バージョン情報等」ボタンはバージョン情報等モーダルを表示
  el.btnOpenSettingsInfo.addEventListener('click', openSettingsInfoModal);

  // 言語/Language: 選択値を保存する(表示言語の切替は今後実装)
  el.languageSelect.addEventListener('change', (e) => writeLanguage(e.target.value));
  // 設定: 起動時の更新確認トグル(localStorage に保存)
  el.toggleStartupUpdateCheck.addEventListener('change', (e) => {
    writeStartupUpdateCheckEnabled(e.target.checked);
  });

  // 情報: 各トグルで内容領域の表示/非表示を切替
  el.toggleInfoVersion.addEventListener('change', (e) => {
    el.infoVersionBody.hidden = !e.target.checked;
  });
  el.toggleInfoMessages.addEventListener('change', (e) => {
    el.infoMessagesBody.hidden = !e.target.checked;
    if (e.target.checked) renderMessageList();
  });
  el.toggleInfoAbout.addEventListener('change', (e) => {
    el.infoAboutBody.hidden = !e.target.checked;
  });

  // モーダル閉じる(各モーダル内の [data-close-modal] が、その親モーダルを閉じる)
  for (const elem of document.querySelectorAll('[data-close-modal]')) {
    elem.addEventListener('click', () => {
      const modal = elem.closest('.modal');
      if (modal) modal.hidden = true;
      // 設定モーダルを閉じた後、現在のビュー状態(マップ画面の戻る/メニュー
      // ボタン等)を正規化して表示崩れを防ぐ
      if (modal && modal.id === 'settingsModal' && currentView === 'map') {
        showView('map');
      }
    });
  }

  // マップ表示設定
  el.btnMapLayers.addEventListener('click', () => {
    el.mapLayerPanel.hidden = !el.mapLayerPanel.hidden;
  });
  // 地図部分(#map)クリックでメニューを閉じる(マップ画面でメニュー表示中のみ)
  const mapEl = document.getElementById('map');
  if (mapEl) {
    mapEl.addEventListener('click', () => {
      if (currentView === 'map' && !el.mapLayerPanel.hidden) {
        el.mapLayerPanel.hidden = true;
      }
    });
  }
  // 時刻表示トグル(「バージョン情報等」内): ON でメニューボタンの左に現在時刻を表示
  el.toggleClock.addEventListener('change', (e) => setClockVisible(e.target.checked));
  // 現在地点をマーカー表示: 現在地マーカー(青丸)・精度円の表示/非表示を切替
  el.toggleCurrentMarker.addEventListener('change', (e) => setCurrentMarkerVisible(e.target.checked));
  // 現在地点は中央に表示: 地図を現在地へ追従させるか切替
  el.toggleCenterCurrent.addEventListener('change', (e) => setFollowCurrentLocation(e.target.checked));
  el.toggleTrackRecording.addEventListener('change', (e) => {
    const on = e.target.checked;
    if (!on) {
      // OFF: 軌跡が消去される前に終了処理(統計の出力)を行う
      finishTrackRecording();
    }
    // 記録操作ボタン群(記録開始/停止・写真撮影)の表示を切替。
    // 現在地の監視は「現在地点をマーカー表示」等のトグルが管理するため、ここでは触らない。
    updateTrackButtonState(on);
  });

  // 記録開始・停止トグルボタン: 移動経路を記録トグル ON のときのみ表示・操作可。
  // 記録中なら停止、停止中なら開始する(押下ごとにアイコンが切り替わる)。
  el.btnTrackToggle.addEventListener('click', () => {
    // ボタンが表示されている(=移動経路を記録 ON で現在地表示が有効)ときのみ動作。
    // checked の値に依存すると、位置情報エラーで checked が戻されたとき無言で
    // 効かなくなるため、ボタン自身の表示状態で判定する。
    if (el.mapTrackActions.hidden) return;
    if (isTrackRecording) finishTrackRecording();
    else beginTrackRecording();
  });
  // 写真撮影ボタン(端末のカメラ/写真選択を起動)
  el.btnTrackPhoto.addEventListener('click', () => {
    if (el.mapTrackActions.hidden) return;
    capturePhoto();
  });

  // サイズ: 現在の移動経路の統計(記録地点数・写真枚数・移動距離)を表示
  el.btnTrackStats.addEventListener('click', () => {
    showToast(formatTrackSummary(getTrackStats()));
  });

  // クリア: 記録した移動経路(線・開始点・現在地点)を消去
  el.btnTrackClear.addEventListener('click', () => {
    const stats = getTrackStats();
    if (stats.pointCount === 0) {
      showToast('クリアする移動経路がありません');
      return;
    }
    if (!confirm('記録した移動経路をクリアします。よろしいですか?')) return;
    clearTrack();
    isTrackRecording = false;
    setTrackRecordingActive(false);
    trackPhotoCount = 0;
    logHistory('移動経路をクリアしました', '');
    showToast('移動経路をクリアしました');
  });

  // マップ画面メニューから「マーカーの設定」モーダルを開く
  el.btnMapOpenMarkerSettings.addEventListener('click', () => {
    el.mapLayerPanel.hidden = true;
    openMarkerSettingsModal();
  });

  // メッセージ履歴
  el.btnClearMessages.addEventListener('click', clearMessageLog);
}

// ===== 時刻表示 =====
let clockTimerId = null;

// 現在時刻を HH:MM 形式で時刻表示要素に反映
function updateClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  el.mapClock.textContent = `${hh}:${mm}`;
}

// 時刻表示の ON/OFF。ON で要素を表示し1秒ごとに更新、OFF で停止・非表示
function setClockVisible(on) {
  if (clockTimerId !== null) {
    clearInterval(clockTimerId);
    clockTimerId = null;
  }
  if (on) {
    updateClock();
    clockTimerId = setInterval(updateClock, 1000);
    el.mapClock.hidden = false;
  } else {
    el.mapClock.hidden = true;
  }
}

// ===== データ件数表示 =====
// 読み込んだポイント/ルート/スポット/通行止めの件数を
// 「バージョン情報等」のバージョン情報内に横一列で反映(未読込は "-")。
function updateFeatureCounts() {
  const c = getFeatureCounts();
  el.countPoints.textContent = c.points == null ? '-' : String(c.points);
  el.countRoutes.textContent = c.routes == null ? '-' : String(c.routes);
  el.countSpots.textContent = c.spots == null ? '-' : String(c.spots);
  // 通行止め・通行困難地点: 現在反映されているデータの件数
  const closures = getClosureCount();
  el.countClosures.textContent = closures == null ? '-' : String(closures);
}

// ===== ビュー切替 =====
function showView(name) {
  if (!el.views[name]) return;
  for (const [key, view] of Object.entries(el.views)) {
    view.hidden = (key !== name);
  }
  currentView = name;

  // ビュー名を body クラスに反映(地図コントロールの表示/非表示などで使用)
  for (const cls of [...document.body.classList]) {
    if (cls.startsWith('view-state-')) document.body.classList.remove(cls);
  }
  document.body.classList.add(`view-state-${name}`);

  if (name === 'map') {
    // マップビュー: メニューボタンを確実に表示(モーダル閉じ後等の表示崩れ対策)
    el.btnMapLayers.hidden = false;
    el.btnMapLayers.style.display = '';

    // マップビュー: 緊急ポイント・ハイキングルート・通行止め等を常に表示
    setEmergencyPointsVisible(true);
    setHikingRoutesVisible(true);
    setClosuresVisible(true);
    // マップビューに入ったら現在地監視を開始。表示/追従はメニュートグルの状態に従う。
    // 先に監視を有効化してから各トグル状態を反映する(再表示の無駄打ちを避ける)。
    setLocationActiveForMapView(true, {
      onError: (msg) => {
        // 位置情報が取得できない場合(非HTTPS環境・権限拒否など)は現在地を表示できない。
        // 原因が分かるよう履歴・ステータスに出力する(連続エラーは geolocation.js 側で抑制)。
        setStatus(msg, 'error');
        logHistory(msg, 'error');
      }
    });
    setCurrentMarkerVisible(el.toggleCurrentMarker.checked);
    setFollowCurrentLocation(el.toggleCenterCurrent.checked);
    // 移動経路を記録トグルの状態に応じて操作ボタン群(記録開始/写真撮影/記録停止)の表示を更新
    updateTrackButtonState(el.toggleTrackRecording.checked);
    // 時刻表示トグルの状態に従って時刻を表示
    setClockVisible(el.toggleClock.checked);
    requestAnimationFrame(() => resizeMap());
  } else if (name === 'home' || name === 'nav') {
    // 通行止め・通行困難地点の編集中にマップ画面を離れたら自動キャンセルする
    autoCancelOnLeaveMap();
    // ホーム/ナビ: 全オーバーレイを非表示にして地理院地図のみ表示
    setEmergencyPointsVisible(false);
    setHikingRoutesVisible(false);
    setClosuresVisible(false);
    // 軌跡が消去される前に終了処理(統計の出力)を行ってから現在地監視を停止
    finishTrackRecording();
    setLocationActiveForMapView(false);
    updateTrackButtonState(false);
    // マップ以外では時刻表示を停止・非表示(トグル状態は保持)
    setClockVisible(false);
    requestAnimationFrame(() => resizeMap());
  }
}

// ===== 言語設定 =====
// 「言語/Language」の選択値(ja=日本語・既定 / en=English)。
// 現状は選択値の保存のみで、表示言語の切替は今後実装する。
function readLanguage() {
  try { return localStorage.getItem(LANGUAGE_KEY) || 'ja'; } catch { return 'ja'; }
}

function writeLanguage(lang) {
  try { localStorage.setItem(LANGUAGE_KEY, lang); } catch { /* noop */ }
}

// ===== モーダル =====
// バージョン情報等モーダル(起動画面の「バージョン情報等」から表示)。
// 言語選択・時刻表示・更新確認の設定を上、情報(バージョン情報・
// メッセージ履歴・このアプリについて)を下に配置する。
async function openSettingsInfoModal() {
  // 言語・起動時の更新確認トグルを現在の設定値で初期化
  el.languageSelect.value = readLanguage();
  el.toggleStartupUpdateCheck.checked = readStartupUpdateCheckEnabled();

  // --- 情報: トグルを既定状態(バージョン情報のみオン)にリセット ---
  el.toggleInfoVersion.checked = true;
  el.infoVersionBody.hidden = false;
  el.toggleInfoMessages.checked = false;
  el.infoMessagesBody.hidden = true;
  el.toggleInfoAbout.checked = false;
  el.infoAboutBody.hidden = true;

  // バージョン情報を反映
  el.versionManifest.textContent = getManifestVersion() || '不明';
  const shell = (await getCachedAppShellVersion()) || '不明';
  el.versionAppShell.textContent = shell;
  // 通行止め・通行困難地点: 現在反映されているデータのバージョン
  el.versionClosures.textContent = getClosureVersion() || '-';
  // データ件数(ポイント/ルート/スポット/通行止め)を開いた時点の最新値で反映
  updateFeatureCounts();

  // 履歴は開いたときにすぐ見えるよう事前に描画しておく
  renderMessageList();

  el.infoSettingsModal.hidden = false;

  // バージョン情報トグルがオンなら、地図/アプリの更新有無を確認して
  // 新しいものがあれば更新の confirm を表示する
  checkUpdatesFromInfoModal();
}

// 「バージョン情報等」モーダルを開いたときの更新チェック。
// 「バージョン情報」トグルがオンのとき、地図タイルとアプリ(アプリシェル)の
// バージョンをサイトの最新と比較し、新しいものがあればそれぞれ別の confirm で案内する。
// メッセージ表示・更新処理は update.js に集約している。
async function checkUpdatesFromInfoModal() {
  if (!el.toggleInfoVersion.checked) return;

  // 地図タイル → アプリの順に確認する。アプリ更新は OK で即再読み込みするため最後に確認する
  // (先に出すと地図タイルの案内が表示される前に画面が再読込される)。

  // 地図タイル: ダウンロード済みバージョン vs サイト最新マニフェスト
  // (オフライン地図を未ダウンロードの場合は saved が無く、対象外)。案内のみで自動更新はしない。
  const savedMap = getSavedManifestVersion();
  const latestMap = getManifestVersion();
  if (savedMap && latestMap && savedMap !== latestMap) {
    promptMapTileUpdate(savedMap, latestMap);
  }

  // アプリ: キャッシュ済みアプリシェル vs サイトの service-worker.js。OK なら再読み込みして更新。
  await promptAppShellUpdate();
}

// マーカーの設定モーダルを開く(マップ画面メニューから)
function openMarkerSettingsModal() {
  el.settingsModal.hidden = false;
}

// ===== 移動記録の取りまとめ =====
// 移動経路を記録トグルの状態に応じて、操作ボタン群(記録開始/写真撮影/記録停止)の表示を切替
function updateTrackButtonState(enabled) {
  if (el.mapTrackActions) el.mapTrackActions.hidden = !enabled;
  // ON のときはパネルを左にずらし、操作ボタン群のアイコンが見えるようにする
  if (el.mapLayerPanel) el.mapLayerPanel.classList.toggle('track-active', enabled);
  if (!enabled) {
    // OFF に戻したら記録状態も初期化(記録開始を操作可能・記録停止を無効に)
    setTrackRecordingActive(false);
  }
}

// 記録中フラグに応じてトグルボタンのアイコン(開始▶/停止■)とラベルを切り替える
function setTrackRecordingActive(active) {
  el.btnTrackToggle.classList.toggle('is-recording', active);
  const label = active ? '記録停止' : '記録開始';
  el.btnTrackToggle.setAttribute('aria-label', label);
  el.btnTrackToggle.setAttribute('title', label);
}

// 実際に移動記録中かどうか(開始ボタン押下〜停止まで)
let isTrackRecording = false;
// 今回の記録中に撮影した写真の枚数
let trackPhotoCount = 0;

// 記録地点数・写真枚数・移動距離の統計文言(「サイズ」表示と記録終了時で共通)
function formatTrackSummary(stats) {
  const km = (stats.distanceM / 1000).toFixed(2);
  return `記録地点 ${stats.pointCount} 点 / 写真 ${trackPhotoCount} 枚 / 移動距離 ${km} km`;
}

// 移動記録を開始(記録開始ボタン)。開始を履歴に残す。
// 写真枚数や軌跡は「クリア」まで移動記録と共に保持するため、ここではリセットしない。
function beginTrackRecording() {
  startTrackRecording();
  setTrackRecordingActive(true);
  isTrackRecording = true;
  logHistory('移動記録を開始しました', 'success');
  showToast('移動記録を開始しました');
}

// 移動記録を終了(記録停止/トグルOFF/画面遷移)。記録中だったときのみ、
// 記録地点数・撮影写真枚数・合計移動距離を履歴(メッセージ)に出力する。
// 軌跡が消去される前に統計を取得する必要がある点に注意。
function finishTrackRecording() {
  const wasRecording = isTrackRecording;
  const stats = getTrackStats();
  stopTrackRecording();
  setTrackRecordingActive(false);
  isTrackRecording = false;
  if (wasRecording) {
    const summary = `移動記録を終了しました(${formatTrackSummary(stats)})`;
    logHistory(summary, 'success');
    showToast(summary);
  }
  // 写真枚数・軌跡は「クリア」まで保持するため、ここではリセットしない。
}

// 写真撮影: 端末のカメラ/写真選択ダイアログを起動(取得後の保存処理は今後実装)
function capturePhoto() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment';
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    // TODO: 撮影した写真の保存・記録への紐付けは今後実装
    if (file) {
      // 記録中の撮影枚数をカウント(終了時の統計メッセージに使用)
      if (isTrackRecording) trackPhotoCount++;
      console.log('写真を取得:', file.name);
    }
  });
  input.click();
}

// ===== 起動時のバージョン確認(履歴記録) =====
// 起動時に確認したバージョン(地図/アプリ)を履歴に残す
async function logStartupVersionCheck() {
  const v = getManifestVersion();
  const mv = v ? `v${v}` : '不明';
  const shell = (await getCachedAppShellVersion()) || '不明';
  logHistory(`起動時のバージョン確認: 地図 ${mv} / アプリ ${shell}`, '');
}

// 起動
init();
