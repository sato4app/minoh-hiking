// アプリシェル更新モジュール
// アプリ本体(HTML/CSS/JS = アプリシェル)の新バージョン検知と更新を担う。
// アプリシェルのキャッシュ名は `app-shell-<version>`(service-worker.js の SHELL_CACHE)。
// キャッシュ済み version と、サイトの service-worker.js 内の version を比較して更新を促す。

import { STARTUP_UPDATE_CHECK_KEY, APP_UPDATED_FLAG_KEY } from './config.js';

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
// 起動時・「バージョン情報等」モーダルの両方から呼べる共通処理。
// confirm を表示したら true、対象なし(初回/取得失敗/最新)なら false を返す。
export async function promptAppShellUpdate() {
  const [cached, latest] = await Promise.all([
    getCachedAppShellVersion(),
    fetchServiceWorkerShellVersion()
  ]);
  // 初回(キャッシュ無し)や取得失敗時は何もしない
  if (!cached || !latest) return false;
  if (cached === latest) return false;
  const ok = confirm(
    `新しいバージョンのアプリが利用可能です。\n` +
    `現在: ${cached}\n` +
    `最新: ${latest}\n\n` +
    `アプリを再読み込みして、最新の状態に更新しますか？\n` +
    `アプリには更新された、ハイキングルートを含みます。\n` +
    `ダウンロードした地図タイルは更新されません。`
  );
  if (ok) await updateAppToLatest();
  return true;
}

// 地図タイル更新の案内ダイアログ。地図タイルは自動更新しないため、
// 「地図のダウンロード」画面からの手動ダウンロードを案内するのみ。
// OK・キャンセルとも処理は行わない(案内表示専用)。
export function promptMapTileUpdate(savedMap, latestMap) {
  confirm(
    `ダウンロード対象の地図タイルが拡張されました。\n` +
    `現在: ${savedMap}\n` +
    `最新: ${latestMap}\n\n` +
    `地図のダウンロードから、ダウンロードしてください。\n` +
    `サイズは合計20MB弱で、既存分があれば差分のみです。`
  );
}

// アプリシェルキャッシュを破棄し、SW を更新して再読み込み(タイル gsi-* は保持)
async function updateAppToLatest() {
  try {
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
  // 再読み込み直後の起動時チェックで、同じ更新確認を再表示しないよう印を付ける。
  try { sessionStorage.setItem(APP_UPDATED_FLAG_KEY, '1'); } catch { /* noop */ }
  location.reload();
}
