// アプリのエントリポイント
// - SPA ビュー切替(home / map / nav / collect / messages)+ 設定モーダル
// - 地理院タイルのオフラインDL(差分/全部更新含む)
// - マニフェスト version 比較によるバナー表示
// - メッセージ履歴の蓄積

import {
  initMap, resizeMap,
  loadBuffersLayer, setBuffersVisible,
  loadEmergencyPointsLayer, setEmergencyPointsVisible
} from './map.js';
import { savePackage, listPackages, clearPackages } from './db.js';

// ===== 定数 =====
// タイルキャッシュ名は `gsi-std-{version}` 形式(version は tile_manifest.json から)。
// 旧 version のキャッシュは保持し、SW・アプリ双方で全 gsi-std-* を横断参照する。
const TILE_CACHE_PREFIX = 'gsi-std-';
const TILE_URL_BASE = 'https://cyberjapandata.gsi.go.jp/xyz/std';
const MANIFEST_URL = 'data/tile_manifest.json';
const BUFFERS_URL = 'data/tile_buffers.geojson';
const EMERGENCY_URL = 'data/minoh-emergency-points.geojson';
const CONCURRENCY = 4;
const MAX_RETRIES = 3;
const AVG_TILE_KB = 12;
const VERSION_STORAGE_KEY = 'minoh-hiking.tile-manifest-version';
const MESSAGE_LOG_KEY = 'minoh-hiking.message-log';
const MESSAGE_LOG_MAX = 100;

// ===== 状態 =====
let manifest = null;
let downloadController = null;
let isPaused = false;
let isDownloading = false;
let mapInitialized = false;
let currentView = 'home';

// ===== DOM要素 =====
const el = {
  // ビュー
  views: {
    home: document.getElementById('viewHome'),
    map: document.getElementById('viewMap'),
    nav: document.getElementById('viewNav'),
    collect: document.getElementById('viewCollect'),
    messages: document.getElementById('viewMessages')
  },
  onlineIndicator: document.getElementById('onlineIndicator'),

  // ホーム
  btnOpenSettings: document.getElementById('btnOpenSettings'),

  // マップ
  btnMapLayers: document.getElementById('btnMapLayers'),
  mapLayerPanel: document.getElementById('mapLayerPanel'),
  toggleBuffers: document.getElementById('toggleBuffers'),
  toggleEmergencyPoints: document.getElementById('toggleEmergencyPoints'),

  // メッセージ履歴
  messageList: document.getElementById('messageList'),
  messageEmpty: document.getElementById('messageEmpty'),
  btnClearMessages: document.getElementById('btnClearMessages'),

  // 設定モーダル
  settingsModal: document.getElementById('settingsModal'),
  toggleDetail: document.getElementById('toggleDetail'),
  btnDownloadMap: document.getElementById('btnDownloadMap'),
  btnPause: document.getElementById('btnPause'),
  btnResume: document.getElementById('btnResume'),
  btnAbort: document.getElementById('btnAbort'),
  btnClearCache: document.getElementById('btnClearCache'),
  progressArea: document.getElementById('progressArea'),
  progressFill: document.getElementById('progressFill'),
  progressText: document.getElementById('progressText'),
  statusMessage: document.getElementById('statusMessage'),
  cachedTileCount: document.getElementById('cachedTileCount'),
  estimatedSize: document.getElementById('estimatedSize'),
  measuredSize: document.getElementById('measuredSize'),

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
  renderMessageList();
  updateOnlineIndicator();
  await refreshStorageInfo();
  evaluateManifestVersion();

  // 初期表示はホーム
  showView('home');
}

function bindEvents() {
  // ホームメニュー: data-view 属性でビュー切替
  for (const btn of document.querySelectorAll('[data-view]')) {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  }
  el.btnOpenSettings.addEventListener('click', openSettings);

  // 設定モーダル
  for (const elem of document.querySelectorAll('[data-close-modal]')) {
    elem.addEventListener('click', closeSettings);
  }
  el.btnDownloadMap.addEventListener('click', onDownloadMap);
  el.btnPause.addEventListener('click', pauseDownload);
  el.btnResume.addEventListener('click', resumeDownload);
  el.btnAbort.addEventListener('click', abortDownload);
  el.btnClearCache.addEventListener('click', onClearCache);

  // マップ表示設定
  el.btnMapLayers.addEventListener('click', () => {
    el.mapLayerPanel.hidden = !el.mapLayerPanel.hidden;
  });
  el.toggleBuffers.addEventListener('change', (e) => setBuffersVisible(e.target.checked));
  el.toggleEmergencyPoints.addEventListener('change', (e) => setEmergencyPointsVisible(e.target.checked));

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

  if (name === 'map') {
    ensureMapInitialized();
    // 表示直後にサイズ再計算(Leaflet は hidden 時に正しく計測できない)
    requestAnimationFrame(() => resizeMap());
  } else if (name === 'messages') {
    renderMessageList();
  }
}

function ensureMapInitialized() {
  if (mapInitialized) return;
  initMap('map');
  loadBuffersLayer(BUFFERS_URL);
  loadEmergencyPointsLayer(EMERGENCY_URL).then(() => {
    // 緊急ポイントは既定で表示(README の共通機能)
    setEmergencyPointsVisible(el.toggleEmergencyPoints.checked);
  });
  setBuffersVisible(el.toggleBuffers.checked);
  mapInitialized = true;
}

// ===== 設定モーダル =====
function openSettings() {
  el.settingsModal.hidden = false;
  refreshStorageInfo();
}

function closeSettings() {
  el.settingsModal.hidden = true;
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

// 全 gsi-std-* キャッシュにキャッシュ済みのURL集合
async function getCachedTileUrlSet() {
  const set = new Set();
  for (const name of await listTileCacheNames()) {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    for (const req of keys) set.add(req.url);
  }
  return set;
}

// ===== 設定モーダル: ダウンロード =====
async function onDownloadMap() {
  // トグル: Off → z17_default のみ、On → z17_default + z18_optional
  const layerKeys = el.toggleDetail.checked
    ? ['z17_default', 'z18_optional']
    : ['z17_default'];
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
    for (const key of layerKeys) {
      const layer = manifest.layers[key];
      if (!layer) continue;
      const layerFailed = result.failed.filter(([z]) => z === layer.z);
      await savePackage({
        packageId: `${key}-${Date.now()}`,
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

  // 進捗表示のため設定モーダルを開く
  openSettings();

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
  isPaused = false;
  downloadController = new AbortController();

  setDownloadButtonsDisabled(true);
  el.btnPause.hidden = false;
  el.btnAbort.hidden = false;
  el.btnResume.hidden = true;
  el.progressArea.hidden = false;

  const startedAt = Date.now();
  let completed = 0;
  const failed = [];
  const queueIndex = { i: 0 };

  // 書込先は現 version のキャッシュ。重複判定は全 gsi-std-* を横断。
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
      while (isPaused && !downloadController.signal.aborted) {
        await sleep(300);
      }
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
      updateProgress(completed, jobs.length, failed.length, startedAt);
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  const aborted = downloadController.signal.aborted;
  isDownloading = false;
  setDownloadButtonsDisabled(false);
  el.btnPause.hidden = true;
  el.btnResume.hidden = true;
  el.btnAbort.hidden = true;

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

function pauseDownload() {
  if (!isDownloading) return;
  isPaused = true;
  el.btnPause.hidden = true;
  el.btnResume.hidden = false;
  setStatus('一時停止中', 'warning');
}

function resumeDownload() {
  if (!isDownloading) return;
  isPaused = false;
  el.btnPause.hidden = false;
  el.btnResume.hidden = true;
  setStatus('再開しました', '');
}

function abortDownload() {
  if (!isDownloading || !downloadController) return;
  downloadController.abort();
  isPaused = false;
}

// ===== オンライン/オフライン =====
function handleOnline() {
  updateOnlineIndicator();
  if (isDownloading && isPaused) {
    setStatus('オンラインに復帰しました。再開ボタンを押してください', 'warning');
  }
}

function handleOffline() {
  updateOnlineIndicator();
  if (isDownloading && !isPaused) {
    pauseDownload();
    setStatus('ネットワーク切断のため一時停止しました', 'warning');
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

// ===== ストレージ情報 =====
async function refreshStorageInfo() {
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
  el.cachedTileCount.textContent = `${tileCount.toLocaleString()} 枚`;

  const estimatedKB = tileCount * AVG_TILE_KB;
  el.estimatedSize.textContent = formatSize(estimatedKB * 1024);

  if (navigator.storage && navigator.storage.estimate) {
    try {
      const est = await navigator.storage.estimate();
      el.measuredSize.textContent = `${formatSize(est.usage)} / ${formatSize(est.quota)}`;
      if (est.quota && est.usage / est.quota > 0.9) {
        setStatus('ストレージ残量が少なくなっています', 'warning');
      }
    } catch {
      el.measuredSize.textContent = '取得不可';
    }
  } else {
    el.measuredSize.textContent = '非対応';
  }
}

// ===== 進捗表示 =====
function updateProgress(completed, total, failedCount, startedAt) {
  const ratio = completed / total;
  el.progressFill.style.width = `${(ratio * 100).toFixed(1)}%`;

  const elapsed = (Date.now() - startedAt) / 1000;
  const rate = completed / Math.max(elapsed, 0.001);
  const remaining = (total - completed) / Math.max(rate, 0.001);

  const failedText = failedCount > 0 ? ` / 失敗 ${failedCount}` : '';
  el.progressText.textContent =
    `${completed.toLocaleString()} / ${total.toLocaleString()} ` +
    `(${(ratio * 100).toFixed(1)}%${failedText}) ・ 残り ${formatDuration(remaining)}`;
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

function formatSize(bytes) {
  if (bytes == null || isNaN(bytes)) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatDuration(seconds) {
  if (!isFinite(seconds) || seconds <= 0) return '計算中';
  if (seconds < 60) return `${Math.ceil(seconds)}秒`;
  const m = Math.floor(seconds / 60);
  const s = Math.ceil(seconds % 60);
  return `${m}分${s}秒`;
}

// 起動
init();
