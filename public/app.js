// アプリのエントリポイント
// - SPA ビュー切替(home / map / nav / collect / messages)+ 設定モーダル
// - 地理院タイルのオフラインDL(差分/全部更新含む)
// - マニフェスト version 比較によるバナー表示
// - メッセージ履歴の蓄積

import {
  initMap, resizeMap,
  loadEmergencyPointsLayer, setEmergencyPointsVisible, setEmergencyStyle,
  loadHikingRoutesLayer, setHikingRoutesVisible, setHikingRouteStyle, setHikingSpotStyle,
  setCurrentLocationVisible,
  setTrackStyle, startTrackRecording, stopTrackRecording
} from './map.js';
import { savePackage, listPackages, clearPackages, deletePackage } from './db.js';
import {
  MARKER_SETTINGS_KEY,
  MARKER_TYPES,
  MARKER_SHAPES
} from './config.js';

// ===== 定数 =====
// タイルキャッシュ名は `gsi-{version}` 形式(version は tile_manifest.json から)。
// 旧 version のキャッシュは保持し、SW・アプリ双方で全 gsi-* を横断参照する。
const TILE_CACHE_PREFIX = 'gsi-';
const TILE_URL_BASE = 'https://cyberjapandata.gsi.go.jp/xyz/std';
const MANIFEST_URL = 'data/tile_manifest.json';
const EMERGENCY_URL = 'data/minoh-emergency-points.geojson';
const HIKING_ROUTES_URL = 'data/minoh-hiking-routes-spots.geojson';
const CONCURRENCY = 4;
const MAX_RETRIES = 3;
const AVG_TILE_KB = 12;
const VERSION_STORAGE_KEY = 'minoh-hiking.tile-manifest-version';
const MESSAGE_LOG_KEY = 'minoh-hiking.message-log';
const MESSAGE_LOG_MAX = 100;
// マーカー設定の既定値・選択肢・localStorage キーは ./config.js から import

// ===== 状態 =====
let manifest = null;
let downloadController = null;
let isDownloading = false;
let currentView = 'home';

// ===== DOM要素 =====
const el = {
  // ビュー
  views: {
    home: document.getElementById('viewHome'),
    map: document.getElementById('viewMap'),
    nav: document.getElementById('viewNav'),
    messages: document.getElementById('viewMessages')
  },

  // ホーム
  btnOpenDownload: document.getElementById('btnOpenDownload'),
  btnOpenSettings: document.getElementById('btnOpenSettings'),

  // バージョン情報モーダル
  versionModal: document.getElementById('versionModal'),
  versionManifest: document.getElementById('versionManifest'),
  versionAppShell: document.getElementById('versionAppShell'),

  // マップ
  btnMapLayers: document.getElementById('btnMapLayers'),
  mapLayerPanel: document.getElementById('mapLayerPanel'),
  toggleEmergencyPoints: document.getElementById('toggleEmergencyPoints'),
  toggleHikingRoutes: document.getElementById('toggleHikingRoutes'),
  toggleTrackRecording: document.getElementById('toggleTrackRecording'),
  // 移動経路を記録 ON のとき表示する操作ボタン群(記録開始/写真撮影/記録停止)
  mapTrackActions: document.getElementById('mapTrackActions'),
  btnTrackStart: document.getElementById('btnTrackStart'),
  btnTrackPhoto: document.getElementById('btnTrackPhoto'),
  btnTrackStop: document.getElementById('btnTrackStop'),

  // メッセージ履歴
  messageList: document.getElementById('messageList'),
  messageEmpty: document.getElementById('messageEmpty'),
  btnClearMessages: document.getElementById('btnClearMessages'),

  // ダウンロードモーダル
  downloadModal: document.getElementById('downloadModal'),
  toggleDetail: document.getElementById('toggleDetail'),
  btnDownloadMap: document.getElementById('btnDownloadMap'),
  btnClearCache: document.getElementById('btnClearCache'),
  statusMessage: document.getElementById('statusMessage'),
  downloadedVersion: document.getElementById('downloadedVersion'),
  downloadedSizeMB: document.getElementById('downloadedSizeMB'),

  // 設定モーダル
  settingsModal: document.getElementById('settingsModal'),
  settingsTitle: document.getElementById('settingsTitle'),
  markerSettingsList: document.getElementById('markerSettingsList'),
  btnResetMarkerSettings: document.getElementById('btnResetMarkerSettings'),

  // マップ画面メニュー内の設定ショートカット
  btnMapOpenMarkerSettings: document.getElementById('btnMapOpenMarkerSettings'),
  btnMapOpenImageSettings: document.getElementById('btnMapOpenImageSettings'),

  // 更新バナー
  updateBanner: document.getElementById('updateBanner'),
  updateBannerMessage: document.getElementById('updateBannerMessage'),
  btnUpdateDiff: document.getElementById('btnUpdateDiff'),
  btnUpdateAll: document.getElementById('btnUpdateAll'),
  btnUpdateLater: document.getElementById('btnUpdateLater'),
  btnUpdateClose: document.getElementById('btnUpdateClose')
};

// ===== 初期化 =====
async function init() {
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
  renderMarkerSettings();
  renderMessageList();
  updateOnlineIndicator();
  await migrateLegacyPackages();
  await refreshStorageInfo();
  evaluateManifestVersion();
  // service-worker.js の SHELL_CACHE とキャッシュ済みバージョンを比較し
  // 不一致なら confirm を出してアプリ全体を最新に更新
  checkAppShellUpdate();

  // 共有地図を初期化(箕面大滝中心 / z=15、ホーム/マップで共通)
  initMap('map');
  // 各オーバーレイはバックグラウンドで読込み、map ビュー時のみ表示。
  // マーカースタイルは保存済み設定(無ければ config.js の既定値)を初期描画に反映。
  const markerSettings = readMarkerSettings();
  loadEmergencyPointsLayer(EMERGENCY_URL, markerSettings.emergency).then(() => {
    if (currentView === 'map') setEmergencyPointsVisible(el.toggleEmergencyPoints.checked);
  });
  loadHikingRoutesLayer(HIKING_ROUTES_URL, markerSettings.hikingRoute, markerSettings.spot).then(() => {
    if (currentView === 'map') setHikingRoutesVisible(el.toggleHikingRoutes.checked);
  });
  setTrackStyle(markerSettings.track);

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
  // 起動画面の「設定」ボタンはバージョン情報を表示
  // (マーカー/画像解像度の設定はハイキングマップ画面のメニュー(≡)から開く)
  el.btnOpenSettings.addEventListener('click', openVersionModal);

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
  el.btnDownloadMap.addEventListener('click', onDownloadMap);
  el.btnClearCache.addEventListener('click', onClearCache);

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
  el.toggleEmergencyPoints.addEventListener('change', (e) => setEmergencyPointsVisible(e.target.checked));
  el.toggleHikingRoutes.addEventListener('change', (e) => setHikingRoutesVisible(e.target.checked));
  el.toggleTrackRecording.addEventListener('change', (e) => {
    const on = e.target.checked;
    setCurrentLocationVisible(on, {
      onError: (msg) => {
        setStatus(msg, 'error');
        el.toggleTrackRecording.checked = false;
        updateTrackButtonState(false);
      }
    });
    if (!on) {
      // OFF: 記録中だった場合も停止し、ボタンを「開始」(無効)に戻す
      stopTrackRecording();
    }
    updateTrackButtonState(on);
  });

  // 記録開始/記録停止ボタン: 移動経路を記録トグル ON のときのみ表示・操作可
  el.btnTrackStart.addEventListener('click', () => {
    if (!el.toggleTrackRecording.checked) return;
    startTrackRecording();
    setTrackRecordingActive(true);
  });
  el.btnTrackStop.addEventListener('click', () => {
    if (!el.toggleTrackRecording.checked) return;
    stopTrackRecording();
    setTrackRecordingActive(false);
  });
  // 写真撮影ボタン(端末のカメラ/写真選択を起動)
  el.btnTrackPhoto.addEventListener('click', () => {
    if (!el.toggleTrackRecording.checked) return;
    capturePhoto();
  });

  // マーカー設定: 規定値に戻す
  el.btnResetMarkerSettings.addEventListener('click', resetMarkerSettings);

  // マップ画面メニューから設定モーダルを直接開く(起動画面に戻る必要なし)
  el.btnMapOpenMarkerSettings.addEventListener('click', () => {
    el.mapLayerPanel.hidden = true;
    openSettingsModal('marker');
  });
  el.btnMapOpenImageSettings.addEventListener('click', () => {
    el.mapLayerPanel.hidden = true;
    openSettingsModal('image');
  });

  // メッセージ履歴
  el.btnClearMessages.addEventListener('click', clearMessageLog);

  // 更新バナー
  el.btnUpdateDiff.addEventListener('click', () => startManifestUpdate('diff'));
  el.btnUpdateAll.addEventListener('click', () => startManifestUpdate('all'));
  el.btnUpdateLater.addEventListener('click', hideUpdateBanner);
  el.btnUpdateClose.addEventListener('click', hideUpdateBanner);

  // オンライン状態
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
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

    // マップビュー: 緊急ポイント・ハイキングルートを表示(トグル状態に従う)
    setEmergencyPointsVisible(el.toggleEmergencyPoints.checked);
    setHikingRoutesVisible(el.toggleHikingRoutes.checked);
    setCurrentLocationVisible(el.toggleTrackRecording.checked, {
      onError: (msg) => {
        setStatus(msg, 'error');
        el.toggleTrackRecording.checked = false;
        updateTrackButtonState(false);
      }
    });
    // 移動経路を記録トグルの状態に応じて操作ボタン群(記録開始/写真撮影/記録停止)の表示を更新
    updateTrackButtonState(el.toggleTrackRecording.checked);
    requestAnimationFrame(() => resizeMap());
  } else if (name === 'home' || name === 'nav') {
    // ホーム/ナビ: 全オーバーレイを非表示にして地理院地図のみ表示
    setEmergencyPointsVisible(false);
    setHikingRoutesVisible(false);
    setCurrentLocationVisible(false);
    stopTrackRecording();
    updateTrackButtonState(false);
    requestAnimationFrame(() => resizeMap());
  } else if (name === 'messages') {
    renderMessageList();
  }
}

// ===== モーダル =====
function openDownloadModal() {
  el.downloadModal.hidden = false;
  refreshStorageInfo();
}

// バージョン情報モーダル(起動画面の「設定」から表示)
async function openVersionModal() {
  // タイルマニフェストの version
  const mv = (manifest && manifest.version != null) ? String(manifest.version) : '不明';
  el.versionManifest.textContent = mv;

  // アプリシェルのキャッシュ名(service-worker.js の SHELL_CACHE)
  const shell = (await getCachedAppShellVersion()) || '不明';
  el.versionAppShell.textContent = shell;

  el.versionModal.hidden = false;

  // モーダル表示のタイミングでも最新版チェックを実行
  checkAppShellUpdate();
}

// キャッシュ済みアプリシェルのバージョン(app-shell-<ver> の <ver>)
async function getCachedAppShellVersion() {
  try {
    if (!('caches' in self)) return null;
    const keys = await caches.keys();
    const found = keys.find((k) => k.startsWith('app-shell-'));
    return found ? found.replace(/^app-shell-/, '') : null;
  } catch {
    return null;
  }
}

// service-worker.js を取得し SHELL_CACHE のバージョンを抽出
async function fetchServiceWorkerShellVersion() {
  try {
    const res = await fetch('service-worker.js', { cache: 'no-store' });
    if (!res.ok) return null;
    const text = await res.text();
    const m = text.match(/SHELL_CACHE\s*=\s*['"]app-shell-([^'"]+)['"]/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

let appShellUpdatePromptShown = false;
async function checkAppShellUpdate() {
  if (appShellUpdatePromptShown) return;
  const [cached, latest] = await Promise.all([
    getCachedAppShellVersion(),
    fetchServiceWorkerShellVersion()
  ]);
  // 初回(キャッシュ無し)や取得失敗時は何もしない
  if (!cached || !latest) return;
  if (cached === latest) return;
  appShellUpdatePromptShown = true;
  const ok = confirm(
    `アプリの新しいバージョンが利用可能です。\n` +
    `現在: ${cached}\n` +
    `最新: ${latest}\n\n` +
    `アプリを最新の状態に更新しますか?(再読み込みされます)`
  );
  if (!ok) return;
  await updateAppToLatest();
}

// アプリシェルキャッシュを破棄し、SW を更新して再読み込み
async function updateAppToLatest() {
  try {
    // app-shell-* のみ削除(タイル gsi-* は保持)
    if ('caches' in self) {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('app-shell-')).map((k) => caches.delete(k))
      );
    }
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.update();
        if (reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      }
    }
  } catch (err) {
    console.warn('アプリ更新失敗:', err);
  }
  location.reload();
}

// section を指定するとそのセクションのみ表示(未指定なら全セクション)
function openSettingsModal(section) {
  const sections = el.settingsModal.querySelectorAll('.settings-section');
  for (const s of sections) {
    s.hidden = section ? (s.dataset.section !== section) : false;
  }
  if (el.settingsTitle) {
    if (section === 'marker') el.settingsTitle.textContent = 'マーカーの設定';
    else if (section === 'image') el.settingsTitle.textContent = '撮影画像の解像度の設定';
    else el.settingsTitle.textContent = '設定';
  }
  el.settingsModal.hidden = false;
}

// ===== マーカー設定 =====
function readMarkerSettings() {
  let saved = {};
  try {
    const raw = localStorage.getItem(MARKER_SETTINGS_KEY);
    if (raw) saved = JSON.parse(raw) || {};
  } catch { /* noop */ }
  // 既定値で埋めて返す
  const merged = {};
  for (const m of MARKER_TYPES) {
    const s = saved[m.key] || {};
    merged[m.key] = {
      color: s.color || m.color,
      shape: s.shape || m.shape,
      size: Number.isFinite(s.size) ? s.size : m.size
    };
  }
  return merged;
}

function writeMarkerSettings(settings) {
  try { localStorage.setItem(MARKER_SETTINGS_KEY, JSON.stringify(settings)); } catch { /* noop */ }
}

function renderMarkerSettings() {
  if (!el.markerSettingsList) return;
  const settings = readMarkerSettings();
  el.markerSettingsList.innerHTML = '';

  for (const m of MARKER_TYPES) {
    const cur = settings[m.key];

    const row = document.createElement('div');
    row.className = 'marker-row';

    const label = document.createElement('span');
    label.className = 'marker-label';
    label.textContent = m.label;
    row.appendChild(label);

    const controls = document.createElement('div');
    controls.className = 'marker-controls';

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'marker-color';
    colorInput.value = cur.color;
    colorInput.setAttribute('aria-label', `${m.label} 色`);
    colorInput.addEventListener('input', () => updateMarkerSetting(m.key, 'color', colorInput.value));
    controls.appendChild(colorInput);

    const shapeSelect = document.createElement('select');
    shapeSelect.className = 'marker-shape';
    shapeSelect.setAttribute('aria-label', `${m.label} 形状`);
    for (const s of MARKER_SHAPES) {
      const opt = document.createElement('option');
      opt.value = s.value;
      opt.textContent = s.label;
      if (s.value === cur.shape) opt.selected = true;
      shapeSelect.appendChild(opt);
    }
    shapeSelect.addEventListener('change', () => updateMarkerSetting(m.key, 'shape', shapeSelect.value));
    controls.appendChild(shapeSelect);

    const sizeInput = document.createElement('input');
    sizeInput.type = 'number';
    sizeInput.className = 'marker-size';
    sizeInput.min = '1';
    sizeInput.max = '50';
    sizeInput.value = String(cur.size);
    sizeInput.setAttribute('aria-label', `${m.label} サイズ`);
    sizeInput.addEventListener('change', () => {
      const v = parseInt(sizeInput.value, 10);
      if (Number.isFinite(v) && v > 0) updateMarkerSetting(m.key, 'size', v);
    });
    controls.appendChild(sizeInput);

    const unit = document.createElement('span');
    unit.className = 'marker-size-unit';
    unit.textContent = 'px';
    controls.appendChild(unit);

    row.appendChild(controls);
    el.markerSettingsList.appendChild(row);
  }
}

function updateMarkerSetting(key, attr, value) {
  const settings = readMarkerSettings();
  if (!settings[key]) return;
  settings[key][attr] = value;
  writeMarkerSettings(settings);
  applyMarkerSettingToMap(key, settings[key]);
}

// 設定変更を地図側へ反映(未実装の種別は noop)
function applyMarkerSettingToMap(key, style) {
  if (key === 'emergency') setEmergencyStyle(style);
  else if (key === 'hikingRoute') setHikingRouteStyle(style);
  else if (key === 'spot') setHikingSpotStyle(style);
  else if (key === 'track') setTrackStyle(style);
  // routeGuide / photoLocation はレイヤー未実装のため反映先なし
}

// 移動経路を記録トグルの状態に応じて、操作ボタン群(記録開始/写真撮影/記録停止)の表示を切替
function updateTrackButtonState(enabled) {
  if (el.mapTrackActions) el.mapTrackActions.hidden = !enabled;
  if (!enabled) {
    // OFF に戻したら記録状態も初期化(記録開始を操作可能・記録停止を無効に)
    setTrackRecordingActive(false);
  }
}

// 記録中フラグに応じて記録開始/記録停止ボタンの有効・無効を切り替える
function setTrackRecordingActive(active) {
  el.btnTrackStart.disabled = active;
  el.btnTrackStop.disabled = !active;
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
    if (file) console.log('写真を取得:', file.name);
  });
  input.click();
}

// 規定値に戻す: config.js の MARKER_TYPES の値で localStorage を上書きし、
// UI と地図の両方に反映する
function resetMarkerSettings() {
  if (!confirm('マーカーの設定を規定値に戻します。よろしいですか?')) return;
  const defaults = {};
  for (const m of MARKER_TYPES) {
    defaults[m.key] = { color: m.color, shape: m.shape, size: m.size };
  }
  writeMarkerSettings(defaults);
  renderMarkerSettings();
  for (const m of MARKER_TYPES) {
    applyMarkerSettingToMap(m.key, defaults[m.key]);
  }
}

// ===== マニフェスト読込 / バージョン比較 =====
async function loadManifest() {
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = await res.json();
  } catch (err) {
    setStatus(`マニフェスト読込失敗: ${err.message}`, 'error');
  }
}

async function onSWControllerChange() {
  await loadManifest();
  evaluateManifestVersion();
}

function getSavedManifestVersion() {
  try { return localStorage.getItem(VERSION_STORAGE_KEY); } catch { return null; }
}

function saveManifestVersion() {
  if (!manifest || manifest.version == null) return;
  try { localStorage.setItem(VERSION_STORAGE_KEY, String(manifest.version)); } catch { /* noop */ }
}

function evaluateManifestVersion() {
  if (isDownloading) return;
  if (!manifest || manifest.version == null) return;
  const saved = getSavedManifestVersion();
  if (!saved) return; // 初回ユーザーは設定モーダル経由のDL誘導
  if (String(manifest.version) !== saved) {
    showUpdateBanner();
  } else {
    hideUpdateBanner();
  }
}

function showUpdateBanner() {
  if (!manifest || manifest.version == null) return;
  el.updateBannerMessage.textContent =
    `タイル情報が更新されました(${manifest.version})。新しい範囲のオフライン地図をダウンロードできます。`;
  el.updateBanner.hidden = false;
}

function hideUpdateBanner() {
  el.updateBanner.hidden = true;
}

// ===== ジョブ構築 =====
function buildJobsByLayers(layerKeys) {
  const jobs = [];
  if (!manifest || !manifest.layers) return jobs;
  for (const key of layerKeys) {
    const layer = manifest.layers[key];
    if (!layer) continue;
    for (const [x, y] of layer.tiles) {
      jobs.push({ z: layer.z, x, y, layerKey: key });
    }
  }
  return jobs;
}

function buildAllJobs() {
  const jobs = [];
  if (!manifest || !manifest.layers) return jobs;
  for (const [key, layer] of Object.entries(manifest.layers)) {
    for (const [x, y] of layer.tiles) {
      jobs.push({ z: layer.z, x, y, layerKey: key });
    }
  }
  return jobs;
}

function tileUrl(job) {
  return `${TILE_URL_BASE}/${job.z}/${job.x}/${job.y}.png`;
}

// ===== タイルキャッシュ名解決 =====
// 現マニフェストの version に対応する書込先キャッシュ名(version 不明時は null)
function currentTileCacheName() {
  if (!manifest || manifest.version == null) return null;
  return TILE_CACHE_PREFIX + manifest.version;
}

// 既存の全タイルキャッシュ名(過去 version 含む)
async function listTileCacheNames() {
  const keys = await caches.keys();
  return keys.filter((k) => k.startsWith(TILE_CACHE_PREFIX));
}

// 全 gsi-* キャッシュにキャッシュ済みのURL集合
async function getCachedTileUrlSet() {
  const set = new Set();
  for (const name of await listTileCacheNames()) {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    for (const req of keys) set.add(req.url);
  }
  return set;
}

// ===== ダウンロードモーダル: ダウンロード =====
async function onDownloadMap() {
  // トグル: Off → z14〜17(基本)、On → z14〜18(詳細含む)
  const baseKeys = ['z14_default', 'z15_default', 'z16_default', 'z17_default'];
  const layerKeys = el.toggleDetail.checked
    ? [...baseKeys, 'z18_optional']
    : baseKeys;
  await startDownload(layerKeys);
}

async function startDownload(layerKeys) {
  if (!manifest || isDownloading) return;
  if (!manifest.layers) {
    setStatus('マニフェストにレイヤー情報がありません', 'error');
    return;
  }

  const jobs = buildJobsByLayers(layerKeys);
  if (jobs.length === 0) {
    setStatus('ダウンロード対象がありません', 'warning');
    return;
  }

  hideUpdateBanner();
  setStatus(`ダウンロード開始: ${jobs.length} タイル`, '');

  const result = await runJobs(jobs);

  if (result.aborted) {
    setStatus(`中断しました(${result.completed}/${result.total} 完了, 失敗 ${result.failed.length})`, 'warning');
    evaluateManifestVersion();
  } else {
    // packageId は「バージョン + レイヤー」で決定的にする。
    // 同じバージョンで同レイヤーを再ダウンロードしても upsert になり、履歴が重複しない。
    const version = manifest.version != null ? String(manifest.version) : 'unknown';
    for (const key of layerKeys) {
      const layer = manifest.layers[key];
      if (!layer) continue;
      const layerFailed = result.failed.filter(([z]) => z === layer.z);
      await savePackage({
        packageId: `${version}-${key}`,
        version,
        layerKey: key,
        downloadedAt: new Date().toISOString(),
        tileCount: layer.tile_count,
        failedTiles: layerFailed
      });
    }
    if (result.failed.length > 0) {
      setStatus(`完了(失敗 ${result.failed.length} 件あり)`, 'warning');
      evaluateManifestVersion();
    } else {
      setStatus('ダウンロード完了', 'success');
      const allLayerKeys = Object.keys(manifest.layers);
      const coversAll = allLayerKeys.every((k) => layerKeys.includes(k));
      if (coversAll) saveManifestVersion();
      evaluateManifestVersion();
    }
  }

  await refreshStorageInfo();
}

// ===== マニフェスト更新DL(差分 / 全部) =====
async function startManifestUpdate(mode) {
  if (!manifest || isDownloading) return;
  if (!manifest.layers) {
    setStatus('マニフェストにレイヤー情報がありません', 'error');
    return;
  }

  const allJobs = buildAllJobs();
  let jobs = allJobs;
  let overwrite = false;

  if (mode === 'diff') {
    try {
      const cachedUrls = await getCachedTileUrlSet();
      jobs = allJobs.filter((j) => !cachedUrls.has(tileUrl(j)));
    } catch (err) {
      setStatus(`キャッシュ参照失敗: ${err.message}`, 'error');
      return;
    }
  } else if (mode === 'all') {
    overwrite = true;
  }

  hideUpdateBanner();

  if (jobs.length === 0) {
    setStatus('追加でダウンロードするタイルはありません。バージョンを更新しました', 'success');
    saveManifestVersion();
    await refreshStorageInfo();
    return;
  }

  // 進捗表示のためダウンロードモーダルを開く
  openDownloadModal();

  const label = mode === 'diff' ? '差分更新' : '全部更新';
  setStatus(`${label}開始: ${jobs.length} タイル`, '');

  const result = await runJobs(jobs, { overwrite });

  if (result.aborted) {
    setStatus(`中断しました(${result.completed}/${result.total} 完了, 失敗 ${result.failed.length})`, 'warning');
    showUpdateBanner();
  } else if (result.failed.length > 0) {
    setStatus(`${label}完了(失敗 ${result.failed.length} 件あり)`, 'warning');
    showUpdateBanner();
  } else {
    setStatus(`${label}が完了しました`, 'success');
    saveManifestVersion();
  }

  await refreshStorageInfo();
}

// ===== ジョブ実行(共通ワーカーループ) =====
async function runJobs(jobs, { overwrite = false } = {}) {
  const writeCacheName = currentTileCacheName();
  if (!writeCacheName) {
    setStatus('マニフェストの version が不明なため開始できません', 'error');
    return { aborted: true, completed: 0, failed: [], total: jobs.length };
  }

  isDownloading = true;
  downloadController = new AbortController();

  setDownloadButtonsDisabled(true);

  let completed = 0;
  const failed = [];
  const queueIndex = { i: 0 };

  // 書込先は現 version のキャッシュ。重複判定は全 gsi-* を横断。
  const writeCache = await caches.open(writeCacheName);
  const readCaches = [];
  for (const name of await listTileCacheNames()) {
    readCaches.push(await caches.open(name));
  }

  async function isAlreadyCached(url) {
    for (const c of readCaches) {
      const hit = await c.match(url);
      if (hit) return true;
    }
    return false;
  }

  async function worker() {
    while (true) {
      if (downloadController.signal.aborted) return;

      const i = queueIndex.i++;
      if (i >= jobs.length) return;

      const job = jobs[i];
      const url = tileUrl(job);

      let ok = false;
      if (!overwrite && (await isAlreadyCached(url))) {
        ok = true;
      } else {
        ok = await fetchAndCacheTile(writeCache, url, downloadController.signal);
      }
      if (!ok) failed.push([job.z, job.x, job.y]);
      completed++;
      if (completed === 1 || completed % 50 === 0 || completed === jobs.length) {
        setStatus(`ダウンロード中... ${completed} / ${jobs.length}`, '');
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  const aborted = downloadController.signal.aborted;
  isDownloading = false;
  setDownloadButtonsDisabled(false);

  return { aborted, completed, failed, total: jobs.length };
}

async function fetchAndCacheTile(cache, url, signal) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (signal.aborted) return false;
    try {
      const res = await fetch(url, { signal, cache: 'no-store' });
      if (res.status === 403 || res.status === 429) {
        await sleep((2 ** attempt) * 1000);
        continue;
      }
      if (!res.ok) return false;
      await cache.put(url, res);
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false;
      if (attempt < MAX_RETRIES - 1) {
        await sleep((2 ** attempt) * 1000);
        continue;
      }
      return false;
    }
  }
  return false;
}

// ===== オンライン/オフライン =====
function handleOnline() {
  updateOnlineIndicator();
}

function handleOffline() {
  updateOnlineIndicator();
  if (isDownloading) {
    setStatus('ネットワーク切断: ダウンロードが失敗する可能性があります', 'warning');
  }
}

function updateOnlineIndicator() {
  if (!el.onlineIndicator) return;
  if (navigator.onLine) {
    el.onlineIndicator.classList.remove('offline');
    el.onlineIndicator.title = 'オンライン';
  } else {
    el.onlineIndicator.classList.add('offline');
    el.onlineIndicator.title = 'オフライン';
  }
}

// ===== キャッシュ削除 =====
async function onClearCache() {
  if (isDownloading) {
    setStatus('ダウンロード中は削除できません', 'warning');
    return;
  }
  if (!confirm('キャッシュ済みのタイルを全て削除します。よろしいですか?')) return;

  try {
    for (const name of await listTileCacheNames()) {
      await caches.delete(name);
    }
    await clearPackages();
    try { localStorage.removeItem(VERSION_STORAGE_KEY); } catch { /* noop */ }
    hideUpdateBanner();
    setStatus('キャッシュを削除しました', 'success');
    await refreshStorageInfo();
  } catch (err) {
    setStatus(`削除失敗: ${err.message}`, 'error');
  }
}

// 旧形式の packageId(layerKey-timestamp)を一度きり整理する。
// 同一バージョン×同レイヤーで複数行できないように、最新の downloadedAt を残して残りを削除。
async function migrateLegacyPackages() {
  try {
    const records = await listPackages();
    if (records.length === 0) return;

    // 旧形式: packageId が "...-<13桁以上のタイムスタンプ>" で終わる
    const legacyRe = /-\d{13,}$/;

    // 「layerKey ごとに最新の 1 件を残し、旧形式の残りを削除」
    const byLayer = new Map();
    for (const r of records) {
      if (!r || !r.layerKey) continue;
      if (!byLayer.has(r.layerKey)) byLayer.set(r.layerKey, []);
      byLayer.get(r.layerKey).push(r);
    }
    for (const list of byLayer.values()) {
      list.sort((a, b) => String(b.downloadedAt).localeCompare(String(a.downloadedAt)));
      // 先頭(最新)以外で旧形式のものは削除
      for (let i = 1; i < list.length; i++) {
        if (legacyRe.test(list[i].packageId)) {
          await deletePackage(list[i].packageId);
        }
      }
    }
  } catch (err) {
    console.warn('旧ダウンロード履歴の整理に失敗:', err);
  }
}

// ===== ストレージ情報 =====
// ダウンロード済みバージョンと、キャッシュ済タイルの推定サイズ(MB)を表示する。
// 実測サイズ(navigator.storage.estimate)が取れる場合はそちらを優先。
async function refreshStorageInfo() {
  // ダウンロード済みバージョン(未ダウンロードなら "-")
  const savedVersion = getSavedManifestVersion();
  el.downloadedVersion.textContent = savedVersion || '-';

  // タイル枚数を集計
  let tileCount = 0;
  try {
    for (const name of await listTileCacheNames()) {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      tileCount += keys.length;
    }
  } catch {
    tileCount = 0;
  }

  // 実測が取れればそれを、無ければ平均タイルサイズから推定
  let bytes = null;
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const est = await navigator.storage.estimate();
      if (Number.isFinite(est.usage)) bytes = est.usage;
      if (est.quota && est.usage / est.quota > 0.9) {
        setStatus('ストレージ残量が少なくなっています', 'warning');
      }
    } catch { /* noop */ }
  }
  if (bytes == null) bytes = tileCount * AVG_TILE_KB * 1024;

  el.downloadedSizeMB.textContent =
    tileCount > 0 ? (bytes / (1024 * 1024)).toFixed(1) : '0';
}

// ===== ステータス + メッセージ履歴 =====
function setStatus(text, level) {
  el.statusMessage.textContent = text;
  el.statusMessage.className = 'status-message';
  if (level) el.statusMessage.classList.add(level);
  appendMessageLog(text, level);
}

function appendMessageLog(text, level) {
  if (!text) return;
  const log = readMessageLog();
  log.push({ t: Date.now(), text, level: level || '' });
  while (log.length > MESSAGE_LOG_MAX) log.shift();
  try { localStorage.setItem(MESSAGE_LOG_KEY, JSON.stringify(log)); } catch { /* noop */ }
  if (currentView === 'messages') renderMessageList();
}

function readMessageLog() {
  try {
    const raw = localStorage.getItem(MESSAGE_LOG_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function renderMessageList() {
  const log = readMessageLog();
  el.messageList.innerHTML = '';
  if (log.length === 0) {
    el.messageEmpty.hidden = false;
    return;
  }
  el.messageEmpty.hidden = true;
  // 新しい順
  for (let i = log.length - 1; i >= 0; i--) {
    const m = log[i];
    const li = document.createElement('li');
    if (m.level) li.classList.add(`level-${m.level}`);
    const time = document.createElement('span');
    time.className = 'msg-time';
    time.textContent = formatLogTime(m.t);
    const text = document.createElement('span');
    text.className = 'msg-text';
    text.textContent = m.text;
    li.appendChild(time);
    li.appendChild(text);
    el.messageList.appendChild(li);
  }
}

function clearMessageLog() {
  if (!confirm('メッセージ履歴を全て削除します。よろしいですか?')) return;
  try { localStorage.removeItem(MESSAGE_LOG_KEY); } catch { /* noop */ }
  renderMessageList();
}

function formatLogTime(ts) {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}`;
}

// ===== ユーティリティ =====
function setDownloadButtonsDisabled(disabled) {
  el.btnDownloadMap.disabled = disabled;
  el.btnClearCache.disabled = disabled;
  el.btnUpdateDiff.disabled = disabled;
  el.btnUpdateAll.disabled = disabled;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 起動
init();
