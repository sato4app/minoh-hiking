// オフライン地図(タイル)モジュール
// - タイル一覧(タイルマニフェスト)の保持とバージョン比較・更新バナー
//   一覧は公開API から配信で受け取る(取得・キャッシュは published-data.js が担い、
//   ここへは setTileManifest() で渡される)
// - 地理院タイルのダウンロード(基本/詳細、差分/全部更新)
// - タイルキャッシュ(gsi-{version})の参照・削除・サイズ集計
// タイルキャッシュ名は `gsi-{version}` 形式。旧 version のキャッシュは保持し、
// 全 gsi-* を横断参照する(version 変更後も旧タイルを活用)。

import {
  TILE_CACHE_PREFIX, TILE_URL_BASE,
  CONCURRENCY, MAX_RETRIES, AVG_TILE_KB, VERSION_STORAGE_KEY
} from './config.js';
import { savePackage, listPackages, clearPackages, deletePackage } from './db.js';
import { logHistory } from './messages.js';
import { t } from './i18n.js';

// ===== 状態 =====
let manifest = null;
let downloadController = null;
let isDownloading = false;

// ===== DOM要素 =====
const el = {
  statusMessage: document.getElementById('statusMessage'),
  downloadModal: document.getElementById('downloadModal'),
  toggleDetail: document.getElementById('toggleDetail'),
  btnDownloadMap: document.getElementById('btnDownloadMap'),
  btnClearCache: document.getElementById('btnClearCache'),
  downloadedVersion: document.getElementById('downloadedVersion'),
  downloadedSizeMB: document.getElementById('downloadedSizeMB'),
  updateBanner: document.getElementById('updateBanner'),
  updateBannerMessage: document.getElementById('updateBannerMessage'),
  btnUpdateDiff: document.getElementById('btnUpdateDiff'),
  btnUpdateAll: document.getElementById('btnUpdateAll'),
  btnUpdateLater: document.getElementById('btnUpdateLater'),
  btnUpdateClose: document.getElementById('btnUpdateClose')
};

// 初期化時にダウンロード/更新バナー/オフラインのイベントを束ねて登録する
export function initTilesEvents() {
  el.btnDownloadMap.addEventListener('click', onDownloadMap);
  el.btnClearCache.addEventListener('click', onClearCache);
  el.btnUpdateDiff.addEventListener('click', () => startManifestUpdate('diff'));
  el.btnUpdateAll.addEventListener('click', () => startManifestUpdate('all'));
  el.btnUpdateLater.addEventListener('click', hideUpdateBanner);
  el.btnUpdateClose.addEventListener('click', hideUpdateBanner);
  window.addEventListener('offline', handleOffline);
}

// ===== マニフェストの受け取り / バージョン比較 =====
// 配信データ(published-data.js)から渡される。オフラインでは前回取得分が渡る。
export function setTileManifest(data) {
  manifest = data;
}

// 現在のマニフェスト version(無ければ null)
export function getManifestVersion() {
  return (manifest && manifest.version != null) ? String(manifest.version) : null;
}

export function getSavedManifestVersion() {
  try { return localStorage.getItem(VERSION_STORAGE_KEY); } catch { return null; }
}

function saveManifestVersion() {
  if (!manifest || manifest.version == null) return;
  try { localStorage.setItem(VERSION_STORAGE_KEY, String(manifest.version)); } catch { /* noop */ }
}

// 保存済み version とマニフェスト version を比較し、不一致なら更新バナーを表示
export function evaluateManifestVersion() {
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
    t('banner.tilesUpdated', { version: manifest.version });
  el.updateBanner.hidden = false;
}

function hideUpdateBanner() {
  el.updateBanner.hidden = true;
}

// ===== ジョブ構築 =====
// 指定レイヤーキー群のタイルを取得ジョブ配列に展開する。
// layerKeys を省略するとマニフェストの全レイヤーを対象にする。
function buildJobs(layerKeys) {
  const jobs = [];
  if (!manifest || !manifest.layers) return jobs;
  const keys = layerKeys || Object.keys(manifest.layers);
  for (const key of keys) {
    const layer = manifest.layers[key];
    if (!layer) continue;
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

// ===== ダウンロードモーダル =====
export function openDownloadModal() {
  el.downloadModal.hidden = false;
  refreshStorageInfo();
}

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
    setStatus(t('download.noLayers'), 'error');
    return;
  }

  const jobs = buildJobs(layerKeys);
  if (jobs.length === 0) {
    setStatus(t('download.noTargets'), 'warning');
    return;
  }

  hideUpdateBanner();
  setStatus(t('download.started', { n: jobs.length }), '');

  const result = await runJobs(jobs);

  if (result.aborted) {
    setStatus(t('download.abortedStatus', {
      completed: result.completed, total: result.total, failed: result.failed.length
    }), 'warning');
    logHistory(t('download.abortedLog', {
      completed: result.completed, total: result.total
    }), 'warning');
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
      setStatus(t('download.doneWithFailures', { failed: result.failed.length }), 'warning');
      logHistory(t('download.doneWithFailuresLog', { failed: result.failed.length }), 'warning');
      evaluateManifestVersion();
    } else {
      setStatus(t('download.done'), 'success');
      logHistory(t('download.doneLog'), 'success');
      const allLayerKeys = Object.keys(manifest.layers);
      const coversAll = allLayerKeys.every((k) => layerKeys.includes(k));
      if (coversAll) saveManifestVersion();
      evaluateManifestVersion();
    }
  }

  await refreshStorageInfo();
}

// ===== マニフェスト更新DL(差分 / 全部) =====
// 更新バナーのボタンからのみ呼ばれる(モジュール内で完結)
async function startManifestUpdate(mode) {
  if (!manifest || isDownloading) return;
  if (!manifest.layers) {
    setStatus(t('download.noLayers'), 'error');
    return;
  }

  const allJobs = buildJobs();
  let jobs = allJobs;
  let overwrite = false;

  if (mode === 'diff') {
    try {
      const cachedUrls = await getCachedTileUrlSet();
      jobs = allJobs.filter((j) => !cachedUrls.has(tileUrl(j)));
    } catch (err) {
      setStatus(t('download.cacheReadFailed', { message: err.message }), 'error');
      return;
    }
  } else if (mode === 'all') {
    overwrite = true;
  }

  hideUpdateBanner();

  if (jobs.length === 0) {
    setStatus(t('download.upToDate'), 'success');
    logHistory(t('download.upToDateLog'), 'success');
    saveManifestVersion();
    await refreshStorageInfo();
    return;
  }

  // 進捗表示のためダウンロードモーダルを開く
  openDownloadModal();

  // 呼び名(差分更新/全部更新)は全文キーの {label} に埋め込む(日英で語順が変わるため)
  const label = t(mode === 'diff' ? 'download.diffLabel' : 'download.allLabel');
  setStatus(t('download.updateStarted', { label, n: jobs.length }), '');

  const result = await runJobs(jobs, { overwrite });

  if (result.aborted) {
    setStatus(t('download.abortedStatus', {
      completed: result.completed, total: result.total, failed: result.failed.length
    }), 'warning');
    logHistory(t('download.updateAbortedLog', {
      label, completed: result.completed, total: result.total
    }), 'warning');
    showUpdateBanner();
  } else if (result.failed.length > 0) {
    setStatus(t('download.updateDoneWithFailures', { label, failed: result.failed.length }), 'warning');
    logHistory(t('download.updateDoneWithFailuresLog', { label, failed: result.failed.length }), 'warning');
    showUpdateBanner();
  } else {
    setStatus(t('download.updateDone', { label }), 'success');
    logHistory(t('download.updateDoneLog', { label }), 'success');
    saveManifestVersion();
  }

  await refreshStorageInfo();
}

// ===== ジョブ実行(共通ワーカーループ) =====
async function runJobs(jobs, { overwrite = false } = {}) {
  const writeCacheName = currentTileCacheName();
  if (!writeCacheName) {
    setStatus(t('download.noVersion'), 'error');
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
        setStatus(t('download.progress', { completed, total: jobs.length }), '');
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

// ネットワーク切断時、ダウンロード中なら警告を表示する
function handleOffline() {
  if (isDownloading) {
    setStatus(t('download.offlineWarning'), 'warning');
  }
}

// ===== キャッシュ削除 =====
async function onClearCache() {
  if (isDownloading) {
    setStatus(t('download.cannotClearWhileDownloading'), 'warning');
    return;
  }
  if (!confirm(t('download.clearConfirm'))) return;

  try {
    for (const name of await listTileCacheNames()) {
      await caches.delete(name);
    }
    await clearPackages();
    try { localStorage.removeItem(VERSION_STORAGE_KEY); } catch { /* noop */ }
    hideUpdateBanner();
    setStatus(t('download.cleared'), 'success');
    await refreshStorageInfo();
  } catch (err) {
    setStatus(t('download.clearFailed', { message: err.message }), 'error');
  }
}

// 旧形式の packageId(layerKey-timestamp)を一度きり整理する。
// 同一バージョン×同レイヤーで複数行できないように、最新の downloadedAt を残して残りを削除。
export async function migrateLegacyPackages() {
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
export async function refreshStorageInfo() {
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
        setStatus(t('download.lowStorage'), 'warning');
      }
    } catch { /* noop */ }
  }
  if (bytes == null) bytes = tileCount * AVG_TILE_KB * 1024;

  el.downloadedSizeMB.textContent =
    tileCount > 0 ? (bytes / (1024 * 1024)).toFixed(1) : '0';
}

// ===== ステータス表示 =====
// ダウンロードモーダルのステータス行を更新する(履歴には残さない)
export function setStatus(text, level) {
  el.statusMessage.textContent = text;
  el.statusMessage.className = 'status-message';
  if (level) el.statusMessage.classList.add(level);
}

function setDownloadButtonsDisabled(disabled) {
  el.btnDownloadMap.disabled = disabled;
  el.btnClearCache.disabled = disabled;
  el.btnUpdateDiff.disabled = disabled;
  el.btnUpdateAll.disabled = disabled;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
