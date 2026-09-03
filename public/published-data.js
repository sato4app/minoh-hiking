// 公開データ(mapdata / closures)の取得モジュール(表示専用)
//
// 地図データ(ポイント・ルート・スポット)と通行止め・通行困難地点は、外部の運用アプリ
// MapPublisher が公開API へ送信したものを配信で受け取る。本アプリは GET のみ利用し、
// 登録・公開は行わない。契約は docs/publish-api-202609.md。
//
// 起動フロー(仕様書 §10)。地図データは約 200KB あるため、毎起動のフル取得を避ける:
//   1. localStorage から保存済み version を読む
//   2. Cache API の geojson を読んで即描画   ← オフラインでもここまでで表示される
//   3. GET /api/manifest で version を先読み
//        ├ 失敗(オフライン等) → 終了
//        ├ version が一致      → 終了(本体を取りに行かない)
//        └ version が相違 → 4. 本体を GET → 5. Cache API に保存 → 6. 再描画
//                           → 7. localStorage の version を更新  ← ★必ず最後
//
// 手順7を先に行ってはならない。本体の取得・保存に失敗したあとに version だけが進むと、
// 以後その端末は永久に更新されなくなる。

import { setMapdataGeoJSON, setClosureGeoJSON } from './map.js';
import { setTileManifest } from './tiles.js';
import {
  PUBLISH_MANIFEST_URL, MAPDATA_API_URL, CLOSURE_API_URL, TILES_API_URL,
  MAPDATA_CACHE, CLOSURE_CACHE, TILES_CACHE,
  MAPDATA_VERSION_KEY, CLOSURES_VERSION_KEY, TILES_VERSION_KEY
} from './config.js';

// データセットの定義。apply は取得したデータを地図へ反映する関数
const DATASETS = {
  mapdata: {
    url: MAPDATA_API_URL,
    cacheName: MAPDATA_CACHE,
    versionKey: MAPDATA_VERSION_KEY,
    apply: setMapdataGeoJSON
  },
  closures: {
    url: CLOSURE_API_URL,
    cacheName: CLOSURE_CACHE,
    versionKey: CLOSURES_VERSION_KEY,
    apply: setClosureGeoJSON
  },
  // オフライン地図のダウンロード対象タイル一覧。地図には描画せず、
  // 「地図データのダウンロード」画面と更新バナーが使う(GeoJSON ではない)
  tiles: {
    url: TILES_API_URL,
    cacheName: TILES_CACHE,
    versionKey: TILES_VERSION_KEY,
    apply: setTileManifest
  }
};

// 現在マップに反映されているデータ(未取得は null)
const active = { mapdata: null, closures: null };

// 起動時の読み込み。onApplied は地図へ反映するたびに呼ぶ
// (キャッシュからの初期描画と、更新取得後の再描画で最大2回)。
export async function loadPublishedData({ onApplied } = {}) {
  const keys = Object.keys(DATASETS);

  // キャッシュから即描画(前回オンライン時に取得した内容。API に届かなくてもここまでは出る)
  await Promise.all(keys.map((key) => applyCached(key)));
  onApplied?.();

  // version を先読みし、相違するデータセットだけ本体を取りに行く
  const manifest = await fetchManifest();
  if (!manifest) return;
  const updated = await Promise.all(keys.map((key) => refreshIfNeeded(key, manifest[key]?.version)));
  if (updated.some(Boolean)) onApplied?.();
}

// 現在表示中の地図データのバージョン(未取得は空文字)
export function getMapdataVersion() {
  return active.mapdata?.version || '';
}

// 現在表示中の通行止め・通行困難地点のバージョン(未取得は空文字)
export function getClosureVersion() {
  return active.closures?.version || '';
}

// 現在表示中の通行止め・通行困難地点の件数(未取得は null)。データ件数表示で使用。
export function getClosureCount() {
  return active.closures ? active.closures.features.length : null;
}

// ===== 内部処理 =====
// キャッシュ済みデータがあれば地図へ反映する
async function applyCached(key) {
  const ds = DATASETS[key];
  const data = await readCache(ds);
  if (!data) return;
  active[key] = data;
  ds.apply(data);
}

// 公開中の version と相違があれば本体を取得して反映する。反映したら true。
// version が一致していてもキャッシュから描画できていないときは取りに行く
// (キャッシュ削除などで消えた場合に、地図が空のままになるのを防ぐ)。
async function refreshIfNeeded(key, publishedVersion) {
  if (typeof publishedVersion !== 'string') return false;
  const ds = DATASETS[key];
  if (active[key] && readSavedVersion(ds) === publishedVersion) return false;

  const result = await fetchAndCache(ds);
  if (!result) return false;
  active[key] = result.data;
  ds.apply(result.data);
  // version の保存は取得・保存・描画がすべて済んだ最後に行う。
  // キャッシュ保存に失敗したときは保存せず、次回起動でもう一度取得させる。
  if (result.cached) {
    writeSavedVersion(ds, typeof result.data.version === 'string' ? result.data.version : publishedVersion);
  }
  return true;
}

// version 一覧の取得。失敗(オフライン等)は null
async function fetchManifest() {
  try {
    const res = await fetch(PUBLISH_MANIFEST_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('公開データの version 一覧の取得に失敗(オフライン等):', err);
    return null;
  }
}

// 本体を取得し、オフライン表示用に Cache API へ保存する。
// 失敗時は null、成功時は { data, cached }(cached はキャッシュ保存の成否)。
async function fetchAndCache(ds) {
  let res;
  try {
    res = await fetch(ds.url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.warn('公開データの取得に失敗:', ds.url, err);
    return null;
  }
  let data;
  try {
    // clone から読む(本体の Response はそのままキャッシュへ渡す)
    data = await res.clone().json();
  } catch (err) {
    console.warn('公開データの解析に失敗:', ds.url, err);
    return null;
  }
  let cached = false;
  try {
    const cache = await caches.open(ds.cacheName);
    await cache.put(ds.url, res);
    cached = true;
  } catch (err) {
    console.warn('公開データのキャッシュ保存に失敗:', ds.url, err);
  }
  return { data, cached };
}

// キャッシュ済みの geojson を読む(未取得・Cache API 非対応は null)
async function readCache(ds) {
  if (!('caches' in window)) return null;
  try {
    const cache = await caches.open(ds.cacheName);
    const res = await cache.match(ds.url);
    if (!res) return null;
    return await res.json();
  } catch (err) {
    console.warn('公開データのキャッシュ読込に失敗:', ds.url, err);
    return null;
  }
}

function readSavedVersion(ds) {
  try {
    return localStorage.getItem(ds.versionKey) || '';
  } catch {
    return '';
  }
}

function writeSavedVersion(ds, version) {
  try {
    localStorage.setItem(ds.versionKey, version);
  } catch { /* localStorage が使えない環境では毎回取得する */ }
}
