// オフライン地図(タイル)モジュール
// - タイル一覧(タイルマニフェスト)の保持とバージョン比較・更新バナー
//   一覧は公開API から配信で受け取る(取得・キャッシュは published-data.js が担い、
//   ここへは setTileManifest() で渡される)
// - 地理院タイルのダウンロード(基本/詳細、差分/全部更新)
// - タイルキャッシュ(gsi-{version})の参照・削除と、ダウンロードサイズの概算
// タイルキャッシュ名は `gsi-{version}` 形式。旧 version のキャッシュは保持し、
// 全 gsi-* を横断参照する(version 変更後も旧タイルを活用)。

import {
  TILE_CACHE_PREFIX, TILE_URL_BASE,
  CONCURRENCY, MAX_RETRIES, VERSION_STORAGE_KEY,
  TILE_AVG_KB_BY_Z, TILE_AVG_KB_FALLBACK
} from './config.js';
import { savePackage, listPackages, clearPackages, deletePackage } from './db.js';
import { logHistory } from './messages.js';
import { t } from './i18n.js';

// ===== 状態 =====
let manifest = null;
let downloadController = null;
let isDownloading = false;
// ダウンロードモーダルを開いた時点のキャッシュ済みタイルURL集合。サイズ行の
// 「更新分」を求めるために使う。全 gsi-* の走査は重いので、モーダルを開いたとき・
// ダウンロード完了時・クリア時にだけ取り直し、詳細トグルの切替ではこの集合を
// 使い回す(走査できなかったときは null にして「更新分」を出さない)。
let cachedTileUrls = null;

// ===== DOM要素 =====
const el = {
  statusMessage: document.getElementById('statusMessage'),
  downloadModal: document.getElementById('downloadModal'),
  toggleDetail: document.getElementById('toggleDetail'),
  btnDownloadMap: document.getElementById('btnDownloadMap'),
  btnClearCache: document.getElementById('btnClearCache'),
  downloadVersionValue: document.getElementById('downloadVersionValue'),
  downloadSizeValue: document.getElementById('downloadSizeValue'),
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
  // 対象レイヤーが変わるとサイズも変わる(キャッシュ済み集合は取り直さない)
  el.toggleDetail.addEventListener('change', updateSizeRow);
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
  if (!saved) return; // 初回ユーザーは起動時画面の「地図データのダウンロード」から誘導する
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
  refreshDownloadInfo();
}

// 「詳細地図データ(Z=18)を含む」トグルで決まるダウンロード対象レイヤー。
// Off(既定) → z14〜17(基本)、On → z14〜18(詳細を含む)
const BASE_LAYER_KEYS = ['z14_default', 'z15_default', 'z16_default', 'z17_default'];
const DETAIL_LAYER_KEY = 'z18_optional';

function selectedLayerKeys() {
  return el.toggleDetail.checked
    ? [...BASE_LAYER_KEYS, DETAIL_LAYER_KEY]
    : [...BASE_LAYER_KEYS];
}

async function onDownloadMap() {
  await startDownload(selectedLayerKeys());
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
      // 地図のバージョンは詳細地図データの有無とは無関係なので、選んだ対象を
      // 取り切れた時点で保存する(基本レイヤーだけのダウンロードでも確定する)
      saveManifestVersion();
      evaluateManifestVersion();
    }
  }

  await refreshDownloadInfo();
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
    await refreshDownloadInfo();
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

  await refreshDownloadInfo();
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
    await refreshDownloadInfo();
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

// ===== バージョン行・サイズ行 =====
// ダウンロードモーダルの表示を最新にする。キャッシュ済みタイルの走査は重いので
// ここでだけ行い、詳細トグルの切替(updateSizeRow)では走査済みの集合を使い回す。
export async function refreshDownloadInfo() {
  updateVersionRow();
  try {
    cachedTileUrls = await getCachedTileUrlSet();
  } catch {
    // 走査できないときは「更新分」を出さず、合計だけを表示する
    cachedTileUrls = null;
  }
  updateSizeRow();
}

// 端末に保存済みの版と配信中の最新版を、状態別に表示する。
// 未ダウンロード / 最新 / 更新あり の3状態で文言を変え、更新があるときだけ色を付ける。
function updateVersionRow() {
  const saved = getSavedManifestVersion();
  const latest = getManifestVersion();
  const target = el.downloadVersionValue;

  target.classList.remove('is-update');

  if (!latest) {
    // 配信中の一覧をまだ受け取れていない(オフラインでの初回起動など)
    target.textContent = saved || t('download.notDownloaded');
    return;
  }
  if (!saved) {
    target.textContent = `${t('download.notDownloaded')} ⇒ ${latest}`;
    target.classList.add('is-update');
    return;
  }
  if (saved === latest) {
    target.textContent = t('download.versionUpToDate', { version: latest });
    return;
  }
  target.textContent = `${saved} ⇒ ${latest}`;
  target.classList.add('is-update');
}

// 選択中レイヤーの合計サイズと、まだ端末に無い分(更新分)の概算を表示する。
// 合計＝更新分(未ダウンロード)のときは同じ数値が並ぶだけなので合計のみを出す。
function updateSizeRow() {
  const jobs = buildJobs(selectedLayerKeys());
  if (jobs.length === 0) {
    el.downloadSizeValue.textContent = '-';
    return;
  }

  const total = formatMB(estimateMB(jobs));
  const pending = cachedTileUrls
    ? jobs.filter((job) => !cachedTileUrls.has(tileUrl(job)))
    : jobs;

  if (pending.length === jobs.length) {
    el.downloadSizeValue.textContent = t('download.sizeTotal', { total });
  } else if (pending.length === 0) {
    el.downloadSizeValue.textContent = t('download.sizeNoDelta', { total });
  } else {
    el.downloadSizeValue.textContent = t('download.sizeWithDelta', {
      total, delta: formatMB(estimateMB(pending))
    });
  }
}

// ジョブ配列の合計サイズ(MB)。1タイルあたりの容量はズームレベルで大きく違う
// (z15=64.2KB / z18=6.1KB)ため、一律の平均ではなく z 別の実測平均で積み上げる。
function estimateMB(jobs) {
  let kb = 0;
  for (const job of jobs) {
    kb += TILE_AVG_KB_BY_Z[job.z] ?? TILE_AVG_KB_FALLBACK;
  }
  return kb / 1024;
}

function formatMB(mb) {
  return mb.toFixed(1);
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
  // 実行中に対象が変わるとサイズ行と実際に走っている内容が食い違うため止める
  el.toggleDetail.disabled = disabled;
  el.btnUpdateDiff.disabled = disabled;
  el.btnUpdateAll.disabled = disabled;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
