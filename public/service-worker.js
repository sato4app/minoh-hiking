// Service Worker
// - gsi-{version}: 地理院標準地図タイル(明示ダウンロードでのみ書込)
//   {version} は公開API から受け取ったタイル一覧の version を埋め込む。
//   旧 version のキャッシュは自動削除しない(ユーザーがDL済みのタイル資産を保持)。
// - app-shell-vN: アプリシェル(HTML/CSS/JS、CDN、アイコン)。
//
// 公開API(/api/*)は横取りしない。地図データ・通行止め・タイル一覧の取得とキャッシュは
// アプリ側(published-data.js)が version を見て制御する。SW はアプリシェルと
// 地理院タイルのみを担当する。
//
// タイルはキャッシュ優先(あれば返す、無ければネット取得・自動キャッシュしない)。
// 全 gsi-* キャッシュを横断検索するため、version 変更後も旧タイルは引き続き利用可能。
//
// アプリシェルの取得戦略:
// - 同一オリジン(HTML/CSS/JS 等): stale-while-revalidate(キャッシュ即返し+裏で
//   ネット更新)。高速・弱電波に強く、オンライン時は次回読み込みで最新化される。
//   新バージョンの明示更新は、アプリ側の「起動時/バージョン情報モーダルの更新確認」
//   (SHELL_CACHE 比較→confirm→再読み込み)が担う。
// - CDN(Leaflet 等の安定資産): cache-first(高速・通信節約)。
//
// SHELL_CACHE を上げたときの install は、shell-revisions.json(デプロイ時に
// scripts/gen-shell-revisions.mjs が生成する内容ハッシュ一覧)を見て、
// 内容が変わっていないファイルを旧キャッシュから複製する(ネットワークに出ない)。
// 一覧を取得できたキャッシュは「デプロイ時の内容と一致する」ことが確認済みなので、
// 上記 stale-while-revalidate の裏取得も省く(毎起動の全件再検証が無駄なため)。
// 一覧が無い環境(ローカル配信など)では、従来どおり全件取得 + 裏取得で動作する。

const SHELL_CACHE = 'app-shell-2026-09-06.1';
const TILE_CACHE_PREFIX = 'gsi-';
const SHELL_CACHE_PREFIX = 'app-shell-';

// シェル各ファイルの内容ハッシュ一覧。デプロイ時に生成される(未生成なら null 扱い)。
const REVISIONS_URL = './shell-revisions.json';
// インストール時の一覧をキャッシュ自身に控えるためのキー。
// 実在しないパスを使い、シェル資産と衝突しないようにする。
const REVISIONS_KEY = './__shell-revisions__';

// アプリが自分で作る公開データのキャッシュ(published-data.js が put する)。
// SW は読み書きしないが、activate の掃除で消さないよう名前を知っておく必要がある。
// 消すとオフライン起動時に地図データが出ず、タイル一覧も失われる
// (オンラインでは気づけない)。
const APP_MANAGED_CACHES = ['mapdata-cache', 'closures-cache', 'tiles-cache'];

// 同一オリジンの相対パス
const SHELL_LOCAL_PATHS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './map.js',
  './geolocation.js',
  './published-data.js',
  './db.js',
  './config.js',
  './i18n.js',
  './messages.js',
  './update.js',
  './tiles.js',
  './marker-settings.js',
  './qrcode.js',
  './guide.js',
  './faq.js',
  './faq-text.js',
  './manifest.webmanifest',
  './icons/icon-192-v2.png',
  './icons/icon-512-v2.png',
  './icons/icon-180.png',
  // 起動画面の中央に出す画像。シェルに含めないと、端末のHTTPキャッシュが
  // 失われたとき弱電波下で取得に十数秒かかり、初期表示が空白のままになる
  './icons/Startup-1024x1836.webp'
];
// 注: 以下のファイルは、この一覧に無くても public/ から削除しないこと。
// シェルは stale-while-revalidate のため、端末にはそれらを参照する旧 index.html /
// 旧 app.js がキャッシュされたまま残ることがあり、消すと 404 になる。
// 全端末がアプリ更新(SHELL_CACHE 比較 → confirm)を通した後に削除する。
//   - icons/Startup-512x918.webp    … 2026-08-15〜08-25 の index.html が参照した起動画像
//   - icons/Startup-512x918.png     … その WebP 化前の版。2026-08-15 より前の index.html が直接参照
//   - icons/Startup-v2-512x906.webp … v2 の 512px 版。2026-08-25 に 555px 版へ差し替えた
//   - closures.js                … 公開データ取得を published-data.js に統合する前の版
//   - orientation.js             … 現在地点表示ボタンで方角(扇形)を出していた版の app.js が
//                                  import している。方角は示す向きが安定しないため 2026-09-04 に廃止した
// なお起動画像の元データ(LibreOffice Draw の .odg)は public/ ではなく assets/ に置く。
//   public/ は Vercel の outputDirectory で全ファイルが配信されるため、
//   配信不要の作業用ファイルは入れない。差し替えと再変換の手順は
//   docs/deployGuide-202609.md の 5.3 を参照。
// 注2: public/data/ は 2026-08-23 に廃止した(tile_manifest.json / tile_buffers.geojson を削除)。
//   タイル一覧は公開API 配信に移したため、現行シェルは参照しない。移行前のシェルを
//   キャッシュしたままの端末は旧 tiles.js が 404 を受けるが、取得失敗のメッセージが
//   出るだけで起動と表示は続く(影響は「地図データのダウンロード」画面に限られる)。
//   tile_buffers.geojson はどのシェルからも参照されていなかった。
// 注3: data/minoh-emergency-points.geojson / data/minoh-hiking-routes-spots.geojson
//   (公開API 配信に移行する前の同梱データ)は 2026-08-20 に削除した。旧シェルを
//   キャッシュしたままの端末が旧 app.js から取得を試みると 404 になるが、旧 app.js は
//   取得失敗を warn するだけで表示は続行するため、影響は地図データが出ないことに留まる。
//   アプリ更新を通せば公開API から取得するようになる。

// 外部CDN(完全URL一致で判定)
const SHELL_CDN_URLS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet-src.esm.js',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'
];

const SHELL_ASSETS = [...SHELL_LOCAL_PATHS, ...SHELL_CDN_URLS];

// インストール: アプリシェルをキャッシュ。
// 内容が変わっていないファイルは旧キャッシュから複製し、ネットワークには出ない。
// (バージョンを上げただけでシェル全件を取り直すと、弱電波では更新直後の起動が待たされる)
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const revisions = await fetchRevisions();
      const previous = await openPreviousShellCache();
      const previousRevisions = previous ? await readStoredRevisions(previous) : null;

      // 個別に処理して失敗を許容(CDNの一部が落ちていても継続)
      await Promise.all(
        SHELL_ASSETS.map((url) =>
          installAsset(cache, url, { previous, revisions, previousRevisions }).catch((err) => {
            console.warn('[SW] shell add failed:', url, err);
          })
        )
      );

      // 一覧を控えておく。次回の install がこれと突き合わせて複製の可否を決める。
      // 同時に「デプロイ時の内容と一致することを確認済み」の目印にもなる(裏取得の省略判定)。
      if (revisions) {
        await cache.put(REVISIONS_KEY, new Response(JSON.stringify(revisions), {
          headers: { 'Content-Type': 'application/json' }
        }));
      }
      await self.skipWaiting();
    })()
  );
});

// 1ファイル分のインストール。複製できるものは複製し、それ以外だけ取得する。
async function installAsset(cache, url, { previous, revisions, previousRevisions }) {
  if (previous && canReuse(url, revisions, previousRevisions)) {
    const hit = await previous.match(url, { ignoreSearch: true });
    if (hit) {
      await cache.put(url, hit);
      return;
    }
  }
  await cache.add(url);
}

// 旧キャッシュの内容をそのまま使えるか。
// - CDN: URL にバージョンが入っており内容は変わらないため、あれば常に再利用できる
// - 同一オリジン: 新旧の内容ハッシュが一致するときだけ再利用できる
//   (どちらかの一覧が無ければ判断できないので取得し直す)
function canReuse(url, revisions, previousRevisions) {
  if (SHELL_CDN_URLS.includes(url)) return true;
  if (!revisions || !previousRevisions) return false;
  const now = revisions[url];
  return !!now && now === previousRevisions[url];
}

// 今回デプロイされた内容ハッシュ一覧。取得できなければ null(従来どおり全件取得になる)
async function fetchRevisions() {
  try {
    const res = await fetch(REVISIONS_URL, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// 直前のアプリシェルキャッシュ(あれば)。activate で1つに掃除されるため通常は1件。
async function openPreviousShellCache() {
  const keys = await caches.keys();
  const name = keys.find((k) => k.startsWith(SHELL_CACHE_PREFIX) && k !== SHELL_CACHE);
  return name ? caches.open(name) : null;
}

// そのキャッシュが作られたときの内容ハッシュ一覧
async function readStoredRevisions(cache) {
  try {
    const res = await cache.match(REVISIONS_KEY);
    return res ? await res.json() : null;
  } catch {
    return null;
  }
}

// このキャッシュが「デプロイ時の内容と一致する」ことを install で確認済みか。
// 確認済みなら stale-while-revalidate の裏取得は不要(新版の検知はアプリ側の
// 更新確認が service-worker.js を直接見て行うため、裏取得に頼る必要がない)。
let shellVerified = null;
function isShellVerified() {
  if (!shellVerified) {
    shellVerified = caches.open(SHELL_CACHE)
      .then((cache) => cache.match(REVISIONS_KEY))
      .then((res) => !!res)
      .catch(() => false);
  }
  return shellVerified;
}

// アプリからの SKIP_WAITING 要求で即座にアクティベート
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// アクティベート: 旧シェルキャッシュのみ掃除。
// タイル(gsi-*)とアプリ管理のキャッシュ(公開データ)は保持する。
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && !APP_MANAGED_CACHES.includes(k) && !k.startsWith(TILE_CACHE_PREFIX))
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

  // 公開API(/api/*)は横取りしない。version を見た取得とキャッシュはアプリ側が行う
  // (SW が network-first で挟むと、version ゲートと二重に取得しに行くことになる)。

  // 同一オリジンのアプリシェル: パス末尾で判定
  if (url.origin === self.location.origin) {
    const reqPath = url.pathname; // 例: "/index.html" "/style.css" "/"
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

// iOS/WebKit はナビゲーションに redirected フラグ付き Response を使えない
// (エラー: "Response served by service worker has redirections")。
// Vercel の cleanUrls により /index.html は / へ 308 リダイレクトされるため、
// キャッシュ済みシェル等を返す際は素の Response に作り直して redirected を消す。
function stripRedirect(response) {
  if (!response || !response.redirected) return response;
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

// アプリシェルの取得。
// - swr=true(同一オリジンのシェル): stale-while-revalidate。
//   キャッシュを即返して高速・弱電波に強く、裏でネット取得して次回用に更新する。
//   ただし install で内容一致を確認済み(REVISIONS_KEY あり)のキャッシュでは裏取得を省く。
//   バージョン更新の検知と適用は、いずれの場合もアプリ側の
//   「起動時/バージョン情報モーダルの更新確認」(SHELL_CACHE 比較→confirm)が担う。
// - swr=false(CDN 等の安定資産): cache-first(高速・通信節約)。
async function handleShellRequest(event, { swr = false } = {}) {
  const req = event.request;
  const cache = await caches.open(SHELL_CACHE);
  // ignoreSearch: クエリ付きの URL で起動されても
  // キャッシュ済みシェル(クエリなしで保存)に一致させる
  const cached = await cache.match(req, { ignoreSearch: true });

  if (swr) {
    // install で内容一致を確認済みのキャッシュは、再検証せずそのまま返す。
    // (毎起動でシェル全件を再検証すると、弱電波では往復のぶんだけ遅くなる)
    if (cached && await isShellVerified()) return stripRedirect(cached);
    // 裏でネット取得→キャッシュ更新(失敗時は null)。SW が早期終了しないよう待機登録。
    const networkUpdate = fetch(req)
      .then((res) => {
        if (res.ok) cache.put(req, res.clone()).catch(() => { });
        return res;
      })
      .catch(() => null);
    event.waitUntil(networkUpdate);
    // キャッシュがあれば即返す。無ければネット取得を待つ。
    if (cached) return stripRedirect(cached);
    const net = await networkUpdate;
    return net ? stripRedirect(net) : new Response('', { status: 504 });
  }

  // cache-first
  if (cached) return stripRedirect(cached);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone()).catch(() => { });
    return stripRedirect(res);
  } catch (err) {
    return new Response('', { status: 504 });
  }
}
