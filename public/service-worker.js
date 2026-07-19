// Service Worker
// - gsi-{version}: 地理院標準地図タイル(明示ダウンロードでのみ書込)
//   {version} は data/tile_manifest.json の version を埋め込む。
//   旧 version のキャッシュは自動削除しない(ユーザーがDL済みのタイル資産を保持)。
// - app-shell-vN: アプリシェル(HTML/CSS/JS、CDN、GeoJSON、tile_manifest.json)。
//
// タイルはキャッシュ優先(あれば返す、無ければネット取得・自動キャッシュしない)。
// 全 gsi-* キャッシュを横断検索するため、version 変更後も旧タイルは引き続き利用可能。
//
// アプリシェルの取得戦略:
// - 同一オリジン(HTML/CSS/JS 等): stale-while-revalidate(キャッシュ即返し+裏で
//   ネット更新)。高速・弱電波に強く、オンライン時は次回読み込みで最新化される。
//   新バージョンの明示更新は、アプリ側の「起動時/バージョン情報等の更新確認」
//   (SHELL_CACHE 比較→confirm→再読み込み)が担う。
// - CDN(Leaflet 等の安定資産): cache-first(高速・通信節約)。

const SHELL_CACHE = 'app-shell-2026-07-19.4';
const TILE_CACHE_PREFIX = 'gsi-';

// 通行止め・通行困難地点: 公開のたびに変わるためシェルに含めず、
// network-first + 専用キャッシュで配信する(オフライン時は最終取得を返す)。
// 取得元は公開API(/api/closures、Vercel Function + Blob)のみ。
const CLOSURE_CACHE = 'closures-cache';
const CLOSURE_API_PATH = '/api/closures';

// 同一オリジンの相対パス
const SHELL_LOCAL_PATHS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './map.js',
  './geolocation.js',
  './closures.js',
  './db.js',
  './config.js',
  './i18n.js',
  './messages.js',
  './update.js',
  './tiles.js',
  './marker-settings.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './data/tile_manifest.json',
  './data/minoh-emergency-points.geojson',
  './data/minoh-hiking-routes-spots.geojson'
];

// 外部CDN(完全URL一致で判定)
const SHELL_CDN_URLS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet-src.esm.js',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'
];

const SHELL_ASSETS = [...SHELL_LOCAL_PATHS, ...SHELL_CDN_URLS];

// インストール: アプリシェルをキャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // 個別にaddして失敗を許容(CDNの一部が落ちていても継続)
      await Promise.all(
        SHELL_ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] shell add failed:', url, err);
          })
        )
      );
      await self.skipWaiting();
    })()
  );
});

// アプリからの SKIP_WAITING 要求で即座にアクティベート
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// アクティベート: 旧シェルキャッシュのみ掃除。タイル(gsi-*)と closures は保持。
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== CLOSURE_CACHE && !k.startsWith(TILE_CACHE_PREFIX))
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// fetch: タイルとアプリシェルで挙動分岐
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 地理院標準地図タイル: キャッシュ優先・自動書込しない
  if (
    url.hostname === 'cyberjapandata.gsi.go.jp' &&
    url.pathname.startsWith('/xyz/std/')
  ) {
    event.respondWith(handleTileRequest(req));
    return;
  }

  // CDN(leaflet): cache-first(安定資産)
  if (SHELL_CDN_URLS.includes(req.url)) {
    event.respondWith(handleShellRequest(event));
    return;
  }

  // 通行止め・通行困難地点の公開API: 公開後すぐ反映されるよう network-first。
  // GitHub Pages 版からは Vercel へのクロスオリジン URL になるため、
  // origin を問わずパスで判定する(API 側で CORS 許可済み)
  if (url.pathname === CLOSURE_API_PATH) {
    event.respondWith(handleClosureRequest(req));
    return;
  }

  // 同一オリジンのアプリシェル: パス末尾で判定
  if (url.origin === self.location.origin) {
    const reqPath = url.pathname; // 例: "/index.html" "/data/tile_manifest.json" "/"
    const swDir = self.location.pathname.replace(/[^/]*$/, ''); // 例: "/" or "/foo/"

    const isShell = SHELL_LOCAL_PATHS.some((p) => {
      const expected = swDir + p.replace(/^\.\//, '');
      // "./" は SW スコープ直下を表す(末尾スラッシュで一致)
      if (p === './') return reqPath === swDir;
      return reqPath === expected;
    });
    if (isShell) {
      // 同一オリジンのシェルは stale-while-revalidate(即返し+裏で更新)
      event.respondWith(handleShellRequest(event, { swr: true }));
      return;
    }
  }
});

// 通行止め・通行困難地点の取得: network-first + 専用キャッシュ。
// オンライン時は常に最新を取得して closures-cache を更新し、
// 取得できないとき(オフライン等)は最後に取得した内容を返す。
// cache: 'no-cache' でブラウザHTTPキャッシュを再検証させる(ヒューリスティック
// キャッシュ等で公開後も古い内容が返り続けるのを防ぐ)。
async function handleClosureRequest(req) {
  const cache = await caches.open(CLOSURE_CACHE);
  try {
    const res = await fetch(req.url, { cache: 'no-cache' });
    if (res.ok) {
      cache.put(req, res.clone()).catch(() => { });
      return res;
    }
    return (await cache.match(req)) || res;
  } catch {
    const cached = await cache.match(req);
    return cached || new Response('', { status: 504 });
  }
}

async function handleTileRequest(req) {
  // 全 gsi-* キャッシュを横断検索(version 変更前にDLしたタイルも活用)
  const allKeys = await caches.keys();
  const tileCacheNames = allKeys.filter((k) => k.startsWith(TILE_CACHE_PREFIX));
  for (const name of tileCacheNames) {
    const cache = await caches.open(name);
    const hit = await cache.match(req);
    if (hit) return hit;
  }
  // キャッシュに無ければネット取得 → 書込まない
  try {
    return await fetch(req);
  } catch {
    // オフラインで未キャッシュ: 透明な空PNGを返す(地図に大穴が空くより親切)
    return new Response('', { status: 504, statusText: 'Tile not cached and offline' });
  }
}

// アプリシェルの取得。
// - swr=true(同一オリジンのシェル): stale-while-revalidate。
//   キャッシュを即返して高速・弱電波に強く、裏でネット取得して次回用に更新する。
//   → オンライン時は自然に最新化(反映は次回読み込み)。バージョン更新の明示通知は
//     アプリ側の「起動時/バージョン情報等の更新確認」(SHELL_CACHE 比較→confirm)が担う。
// - swr=false(CDN 等の安定資産): cache-first(高速・通信節約)。
async function handleShellRequest(event, { swr = false } = {}) {
  const req = event.request;
  const cache = await caches.open(SHELL_CACHE);
  // ignoreSearch: ?closure=true 等のクエリ付きで起動されても
  // キャッシュ済みシェル(クエリなしで保存)に一致させる
  const cached = await cache.match(req, { ignoreSearch: true });

  if (swr) {
    // 裏でネット取得→キャッシュ更新(失敗時は null)。SW が早期終了しないよう待機登録。
    const networkUpdate = fetch(req)
      .then((res) => {
        if (res.ok) cache.put(req, res.clone()).catch(() => { });
        return res;
      })
      .catch(() => null);
    event.waitUntil(networkUpdate);
    // キャッシュがあれば即返す。無ければネット取得を待つ。
    if (cached) return cached;
    return (await networkUpdate) || new Response('', { status: 504 });
  }

  // cache-first
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone()).catch(() => { });
    return res;
  } catch (err) {
    return new Response('', { status: 504 });
  }
}
