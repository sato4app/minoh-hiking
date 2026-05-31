// Service Worker
// - gsi-{version}: 地理院標準地図タイル(明示ダウンロードでのみ書込)
//   {version} は data/tile_manifest.json の version を埋め込む。
//   旧 version のキャッシュは自動削除しない(ユーザーがDL済みのタイル資産を保持)。
// - app-shell-vN: アプリシェル(HTML/CSS/JS、CDN、GeoJSON、tile_manifest.json)。
//
// タイルはキャッシュ優先(あれば返す、無ければネット取得・自動キャッシュしない)。
// 全 gsi-* キャッシュを横断検索するため、version 変更後も旧タイルは引き続き利用可能。

const SHELL_CACHE = 'app-shell-2026-05-31.9';
const TILE_CACHE_PREFIX = 'gsi-';

// 同一オリジンの相対パス
const SHELL_LOCAL_PATHS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './map.js',
  './db.js',
  './config.js',
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

// アクティベート: 旧シェルキャッシュのみ掃除。タイル(gsi-*)は保持。
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && !k.startsWith(TILE_CACHE_PREFIX))
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

  // CDN(leaflet): シェルキャッシュ優先
  if (SHELL_CDN_URLS.includes(req.url)) {
    event.respondWith(handleShellRequest(req));
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
      event.respondWith(handleShellRequest(req));
      return;
    }
  }
});

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

async function handleShellRequest(req) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone()).catch(() => { });
    return res;
  } catch (err) {
    return cached || new Response('', { status: 504 });
  }
}
