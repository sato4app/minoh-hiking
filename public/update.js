// アプリシェル更新モジュール
// アプリ本体(HTML/CSS/JS = アプリシェル)の新バージョン検知と更新を担う。
// アプリシェルのキャッシュ名は `app-shell-<version>`(service-worker.js の SHELL_CACHE)。
// キャッシュ済み version と、サイトの service-worker.js 内の version を比較して更新を促す。

import { STARTUP_UPDATE_CHECK_KEY } from './config.js';

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
export async function fetchServiceWorkerShellVersion() {
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

// 起動時のアプリ更新確認。キャッシュ済みと最新が異なれば confirm を出して更新する。
let appShellUpdatePromptShown = false;
export async function checkAppShellUpdate() {
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

// アプリシェルキャッシュを破棄し、SW を更新して再読み込み(タイル gsi-* は保持)
export async function updateAppToLatest() {
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
  location.reload();
}
