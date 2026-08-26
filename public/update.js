// アプリシェル更新モジュール
// アプリ本体(HTML/CSS/JS = アプリシェル)の新バージョン検知と更新を担う。
// アプリシェルのキャッシュ名は `app-shell-<version>`(service-worker.js の SHELL_CACHE)。
// キャッシュ済み version と、サイトの service-worker.js 内の version を比較して更新を促す。

import {
  STARTUP_UPDATE_CHECK_KEY, APP_UPDATED_FLAG_KEY,
  APP_UPDATE_DOWNLOAD_TIMEOUT_MS, APP_UPDATE_WORKER_WAIT_MS
} from './config.js';
import { t } from './i18n.js';

// ===== 起動時の更新確認の設定(localStorage) =====
export function readStartupUpdateCheckEnabled() {
  try {
    const v = localStorage.getItem(STARTUP_UPDATE_CHECK_KEY);
    return v === null ? true : v === '1'; // 既定 ON
  } catch {
    return true;
  }
}

export function writeStartupUpdateCheckEnabled(on) {
  try { localStorage.setItem(STARTUP_UPDATE_CHECK_KEY, on ? '1' : '0'); } catch { /* noop */ }
}

// キャッシュ済みアプリシェルのバージョン(app-shell-<ver> の <ver>)
export async function getCachedAppShellVersion() {
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

// 起動時のアプリ更新確認(1セッションにつき1回まで)。
// キャッシュ済みと最新が異なれば confirm を出して更新する。
let appShellUpdatePromptShown = false;
export async function checkAppShellUpdate() {
  if (appShellUpdatePromptShown) return;
  // アプリ更新による再読み込みの直後は、同じ更新確認を再表示しない(1回で十分)。
  // updateAppToLatest() は SW の切替完了を待たずに再読み込みするため、切替が
  // 間に合わないと再読み込み後もバージョンが不一致に見え、confirm が二重に出る。
  // フラグが立っていれば今回の起動確認はスキップし、フラグは消費する。
  try {
    if (sessionStorage.getItem(APP_UPDATED_FLAG_KEY) === '1') {
      sessionStorage.removeItem(APP_UPDATED_FLAG_KEY);
      appShellUpdatePromptShown = true;
      return;
    }
  } catch { /* noop */ }
  const shown = await promptAppShellUpdate();
  if (shown) appShellUpdatePromptShown = true;
}

// アプリ更新の confirm を表示し、OK なら最新へ更新(再読み込み)する。
// 起動時・「バージョン情報」モーダルの両方から呼べる共通処理。
// confirm を表示したら true、対象なし(初回/取得失敗/最新)なら false を返す。
export async function promptAppShellUpdate() {
  const [cached, latest] = await Promise.all([
    getCachedAppShellVersion(),
    fetchServiceWorkerShellVersion()
  ]);
  // 初回(キャッシュ無し)や取得失敗時は何もしない
  if (!cached || !latest) return false;
  if (cached === latest) return false;
  const ok = confirm(t('update.appConfirm', { cached, latest }));
  if (ok) await updateAppToLatest();
  return true;
}

// 地図タイル更新の案内ダイアログ。地図タイルは自動更新しないため、
// 「地図データのダウンロード」画面からの手動ダウンロードを案内するのみ。
// OK・キャンセルとも処理は行わない(案内表示専用)。
export function promptMapTileUpdate(savedMap, latestMap) {
  confirm(t('update.mapTilesNotice', { saved: savedMap, latest: latestMap }));
}

// ===== ダウンロード中のブロック表示 =====
// 更新版のダウンロード中に全画面オーバーレイを出し、他の操作を受け付けなくする。
// 旧バージョンのまま操作を続けさせず、完了後の再読み込みまで待ってもらうため。
// 解除はしない(完了時はそのまま再読み込みし、オーバーレイごと作り直される)。
function showUpdateOverlay() {
  const overlay = document.getElementById('appUpdateOverlay');
  if (overlay) overlay.hidden = false;
  // タップ・クリックはオーバーレイ自身が遮るが、背面のボタンにフォーカスが
  // 残っているとキーボードで操作できてしまうため、フォーカスを外して塞ぐ。
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  document.addEventListener('keydown', blockKeydown, true);
}

function blockKeydown(ev) {
  ev.preventDefault();
  ev.stopPropagation();
}

// ===== 更新版のダウンロード待ち =====
// 新しい Service Worker(ダウンロードの実行役)を得る。update() 直後に
// installing/waiting が入る場合と、少し遅れて updatefound が発火する場合の
// 両方に備える。現れなければ(更新対象なし・失敗)null を返す。
function waitForNewWorker(reg, timeoutMs) {
  const existing = reg.installing || reg.waiting;
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const finish = (worker) => {
      clearTimeout(timer);
      reg.removeEventListener('updatefound', onFound);
      resolve(worker);
    };
    const onFound = () => finish(reg.installing);
    const timer = setTimeout(() => finish(null), timeoutMs);
    reg.addEventListener('updatefound', onFound);
  });
}

// 更新版のダウンロード完了を待つ。service-worker.js の install は
// アプリシェル一式(HTML/CSS/JS・CDN・GeoJSON)をキャッシュしてから終わるため、
// state が installed 以降になった時点でダウンロードは完了している。
// 失敗(redundant)・タイムアウト時も解決し、呼び出し側は再読み込みへ進む。
function waitForWorkerInstalled(worker, timeoutMs) {
  const isDone = () => worker.state !== 'installing';
  if (isDone()) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      worker.removeEventListener('statechange', onChange);
      resolve();
    };
    const onChange = () => { if (isDone()) finish(); };
    const timer = setTimeout(finish, timeoutMs);
    worker.addEventListener('statechange', onChange);
  });
}

async function deleteAppShellCaches() {
  if (!('caches' in self)) return;
  const keys = await caches.keys();
  await Promise.all(
    keys.filter((k) => k.startsWith('app-shell-')).map((k) => caches.delete(k))
  );
}

// 最新のアプリシェルをダウンロードして再読み込みする(タイル gsi-* は保持)。
// ダウンロード中はオーバーレイで操作を受け付けず、完了してから再読み込みする。
// 旧シェルキャッシュはダウンロード中も残しておき(新 SW は別名のキャッシュを使う)、
// 新 SW の activate に削除させる。通信が途切れても手元のアプリが壊れないようにするため。
async function updateAppToLatest() {
  showUpdateOverlay();
  try {
    const reg = ('serviceWorker' in navigator)
      ? await navigator.serviceWorker.getRegistration()
      : null;
    let downloaded = false;
    if (reg) {
      await reg.update();
      const worker = await waitForNewWorker(reg, APP_UPDATE_WORKER_WAIT_MS);
      if (worker) {
        // ここが「ダウンロード完了まで待たせる」本体
        await waitForWorkerInstalled(worker, APP_UPDATE_DOWNLOAD_TIMEOUT_MS);
        // install 内で skipWaiting 済みだが、waiting に留まる場合に備えて要求する
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        downloaded = true;
      }
    }
    // 新 SW を用意できなかったときだけ、旧シェルキャッシュを捨てて取り直させる
    if (!downloaded) await deleteAppShellCaches();
  } catch (err) {
    console.warn('アプリ更新失敗:', err);
  }
  // 再読み込み直後の起動時チェックで、同じ更新確認を再表示しないよう印を付ける。
  try { sessionStorage.setItem(APP_UPDATED_FLAG_KEY, '1'); } catch { /* noop */ }
  location.reload();
}
