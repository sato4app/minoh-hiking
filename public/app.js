// アプリのエントリポイント
// - 地図初期化
// - tile_manifest.json 読込
// - ダウンロード/中断/削除のUI制御
// - 進捗・ストレージ情報の表示
// - マニフェスト更新検知 / 差分DL・全部更新

import {
  initMap,
  loadBuffersLayer, setBuffersVisible,
  loadEmergencyPointsLayer, setEmergencyPointsVisible
} from './map.js';
import { savePackage, listPackages, clearPackages } from './db.js';

// ===== 定数 =====
const TILE_CACHE = 'gsi-std-v1';
const TILE_URL_BASE = 'https://cyberjapandata.gsi.go.jp/xyz/std';
const MANIFEST_URL = 'data/tile_manifest.json';
const BUFFERS_URL = 'data/tile_buffers.geojson';
const EMERGENCY_URL = 'data/minoh-emergency-points.geojson';
const CONCURRENCY = 4;
const MAX_RETRIES = 3;
const AVG_TILE_KB = 12; // 推定容量計算用
const VERSION_STORAGE_KEY = 'minoh-hiking.tile-manifest-version';

// ===== 状態 =====
let manifest = null;
let downloadController = null;   // AbortController(中断/再開で再生成)
let isPaused = false;
let isDownloading = false;

// ===== DOM要素 =====
const el = {
  btnDownloadDefault: document.getElementById('btnDownloadDefault'),
  btnDownloadDetail: document.getElementById('btnDownloadDetail'),
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
  toggleBuffers: document.getElementById('toggleBuffers'),
  toggleEmergencyPoints: document.getElementById('toggleEmergencyPoints'),
  onlineIndicator: document.getElementById('onlineIndicator'),
  updateBanner: document.getElementById('updateBanner'),
  updateBannerMessage: document.getElementById('updateBannerMessage'),
  btnUpdateDiff: document.getElementById('btnUpdateDiff'),
  btnUpdateAll: document.getElementById('btnUpdateAll'),
  btnUpdateLater: document.getElementById('btnUpdateLater'),
  btnUpdateClose: document.getElementById('btnUpdateClose')
};

// ===== 初期化 =====
async function init() {
  // 地図
  initMap('map');
  loadBuffersLayer(BUFFERS_URL);
  loadEmergencyPointsLayer(EMERGENCY_URL);

  // マニフェスト読込
  await loadManifest();

  // SW登録 + 更新検知
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('sw.js');
    } catch (err) {
      console.warn('SW登録失敗:', err);
    }
    navigator.serviceWorker.addEventListener('controllerchange', onSWControllerChange);
  }

  // イベント
  el.btnDownloadDefault.addEventListener('click', () => startDownload(['z17_default']));
  el.btnDownloadDetail.addEventListener('click', () => startDownload(['z17_default', 'z18_optional']));
  el.btnPause.addEventListener('click', pauseDownload);
  el.btnResume.addEventListener('click', resumeDownload);
  el.btnAbort.addEventListener('click', abortDownload);
  el.btnClearCache.addEventListener('click', onClearCache);
  el.toggleBuffers.addEventListener('change', (e) => setBuffersVisible(e.target.checked));
  el.toggleEmergencyPoints.addEventListener('change', (e) => setEmergencyPointsVisible(e.target.checked));

  el.btnUpdateDiff.addEventListener('click', () => startManifestUpdate('diff'));
  el.btnUpdateAll.addEventListener('click', () => startManifestUpdate('all'));
  el.btnUpdateLater.addEventListener('click', hideUpdateBanner);
  el.btnUpdateClose.addEventListener('click', hideUpdateBanner);

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  updateOnlineIndicator();

  await refreshStorageInfo();

  // バージョン比較してバナー表示判定
  evaluateManifestVersion();
}

// ===== マニフェスト読込 =====
async function loadManifest() {
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = await res.json();
  } catch (err) {
    setStatus(`マニフェスト読込失敗: ${err.message}`, 'error');
    el.btnDownloadDefault.disabled = true;
    el.btnDownloadDetail.disabled = true;
  }
}

// SW更新検知時: マニフェスト再読込 + バージョン比較
async function onSWControllerChange() {
  await loadManifest();
  evaluateManifestVersion();
}

// ===== マニフェストバージョン比較 / バナー =====
function getSavedManifestVersion() {
  try {
    return localStorage.getItem(VERSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveManifestVersion() {
  if (!manifest || manifest.version == null) return;
  try {
    localStorage.setItem(VERSION_STORAGE_KEY, String(manifest.version));
  } catch {
    // localStorage 不可: 黙殺(機能低下のみ)
  }
}

function evaluateManifestVersion() {
  if (isDownloading) return;
  if (!manifest || manifest.version == null) return;
  const saved = getSavedManifestVersion();
  // 初回ユーザー(saved 無し)は既存DLボタン誘導のためバナー出さない
  if (!saved) return;
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

// ===== 既存ダウンロード(レイヤーキー指定) =====
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
    // メタデータ保存(レイヤーごとに)
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
      // 全レイヤーをカバーした成功DLならバージョンも保存
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
    // 集合差分: 新マニフェストのURL ∖ 既存キャッシュのURL
    try {
      const cache = await caches.open(TILE_CACHE);
      const keys = await cache.keys();
      const cachedUrls = new Set(keys.map((req) => req.url));
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
    // 差分なし: バージョンだけ進めて終了
    setStatus('追加でダウンロードするタイルはありません。バージョンを更新しました', 'success');
    saveManifestVersion();
    await refreshStorageInfo();
    return;
  }

  const label = mode === 'diff' ? '差分更新' : '全部更新';
  setStatus(`${label}開始: ${jobs.length} タイル`, '');

  const result = await runJobs(jobs, { overwrite });

  if (result.aborted) {
    setStatus(`中断しました(${result.completed}/${result.total} 完了, 失敗 ${result.failed.length})`, 'warning');
    // 中断時は localStorage 更新せず、バナーを再表示して再開を促す
    showUpdateBanner();
  } else if (result.failed.length > 0) {
    setStatus(`${label}完了(失敗 ${result.failed.length} 件あり)`, 'warning');
    // 失敗ありも localStorage 更新せず、再ダウンロードを促す
    showUpdateBanner();
  } else {
    setStatus(`${label}が完了しました`, 'success');
    saveManifestVersion();
  }

  await refreshStorageInfo();
}

// ===== ジョブ実行(共通ワーカーループ) =====
async function runJobs(jobs, { overwrite = false } = {}) {
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

  const cache = await caches.open(TILE_CACHE);

  async function isAlreadyCached(url) {
    const hit = await cache.match(url);
    return !!hit;
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
        ok = await fetchAndCacheTile(cache, url, downloadController.signal);
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

// 1タイル取得 + キャッシュ書込(指数バックオフ最大3回)
async function fetchAndCacheTile(cache, url, signal) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (signal.aborted) return false;
    try {
      const res = await fetch(url, { signal, cache: 'no-store' });
      if (res.status === 403 || res.status === 429) {
        // 指数バックオフ(1s, 2s, 4s)
        await sleep((2 ** attempt) * 1000);
        continue;
      }
      if (!res.ok) {
        return false;
      }
      await cache.put(url, res);
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false;
      // ネットワークエラー: バックオフして再試行
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

// オンライン/オフライン
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
    await caches.delete(TILE_CACHE);
    await clearPackages();
    // バージョンも消去(以後 manifest 比較で「初回ユーザー扱い」に戻す)
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
  // タイル数
  let tileCount = 0;
  try {
    const cache = await caches.open(TILE_CACHE);
    const keys = await cache.keys();
    tileCount = keys.length;
  } catch {
    tileCount = 0;
  }
  el.cachedTileCount.textContent = `${tileCount.toLocaleString()} 枚`;

  // 推定容量
  const estimatedKB = tileCount * AVG_TILE_KB;
  el.estimatedSize.textContent = formatSize(estimatedKB * 1024);

  // 実測容量
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const est = await navigator.storage.estimate();
      el.measuredSize.textContent = `${formatSize(est.usage)} / ${formatSize(est.quota)}`;
      // 残量警告
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

// ===== ユーティリティ =====
function setDownloadButtonsDisabled(disabled) {
  el.btnDownloadDefault.disabled = disabled;
  el.btnDownloadDetail.disabled = disabled;
  el.btnClearCache.disabled = disabled;
  el.btnUpdateDiff.disabled = disabled;
  el.btnUpdateAll.disabled = disabled;
}

function setStatus(text, level) {
  el.statusMessage.textContent = text;
  el.statusMessage.className = 'status-message';
  if (level) el.statusMessage.classList.add(level);
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
