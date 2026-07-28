// 通行止め・通行困難地点(closures)モジュール(表示専用)
// - 起動時に公開API(GET /api/closures)から最新データを取得し、地図へ反映する
// データの登録・公開は本アプリでは行わない(外部の運用アプリが公開APIへ送信する)。

import { setClosureGeoJSON } from './map.js';
import { CLOSURE_API_URL } from './config.js';

// 現在マップに反映されている closures データ(未取得は null)
let activeClosureData = null;

// 廃止した編集・公開機能が運用端末の localStorage に残した値の後始末。
// 公開トークンは秘密情報のため確実に消す(反映データも参照されなくなったため削除)。
// この処理は一度きりで良いため、次のリリースで取り除く。
try {
  localStorage.removeItem('minoh-hiking.closure-publish-token');
  localStorage.removeItem('minoh-hiking.closure-data');
} catch { /* localStorage が使えない環境では何もしない */ }

// 起動時の読み込み: 公開API(Vercel Function + Blob)から最新を取得して地図へ反映する。
// API に届かないとき(オフライン等)は SW の closures-cache が最終取得を返す。
// それも無い場合は表示なしとする(古い情報を出すより安全)。
export async function loadClosures() {
  let data = null;
  try {
    // no-cache: HTTPキャッシュを再検証し、公開直後でも最新版を取得する
    // (SW 未制御の初回ロードでも有効。SW 経由時は SW 側でも同様に扱う)
    const res = await fetch(CLOSURE_API_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (apiErr) {
    console.warn('通行止め・通行困難地点の公開API読込失敗:', apiErr);
  }
  if (!data) return;
  activeClosureData = data;
  setClosureGeoJSON(data);
}

// 現在表示中のデータのバージョン(未取得は空文字)
export function getClosureVersion() {
  return activeClosureData?.version || '';
}

// 現在表示中のデータの件数(未取得は null)。データ件数表示で使用。
export function getClosureCount() {
  return activeClosureData ? activeClosureData.features.length : null;
}
