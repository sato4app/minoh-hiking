// 公開ストア(Vercel Blob)の読み書き(公開API 仕様書 docs/publish-api-202609.md §7)
//
// 必要な Vercel 設定: Blob ストアをプロジェクトに接続(BLOB_READ_WRITE_TOKEN が自動設定される)

import { head, put, copy } from '@vercel/blob';

// 採番の基準・GET /api/manifest の実体
export const MANIFEST_PATH = 'manifest.json';

const GEOJSON_CONTENT_TYPE = 'application/geo+json';

// Blob の内容を文字列で返す。未作成・取得失敗は null
export async function readBlobText(path) {
  let meta;
  try {
    meta = await head(path);
  } catch {
    return null; // BlobNotFoundError(初回公開前)や設定不備
  }
  // Blob の CDN キャッシュを避けるため、毎回ユニークなクエリを付けて取得する
  const res = await fetch(`${meta.url}?_=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.text();
}

// Blob の内容を JSON として返す。未作成・取得失敗・壊れた JSON は null
export async function readBlobJSON(path) {
  const text = await readBlobText(path);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// 全置換保存。失敗時は例外を投げる(呼び出し側が 500 を返す)
export async function putBlob(path, body, contentType = GEOJSON_CONTENT_TYPE) {
  await put(path, body, {
    access: 'public',
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60 // 最小値。GET はクエリ付き取得でさらにキャッシュを回避する
  });
}

// 現行の本体を前回分へ退避する。本体をダウンロードせずにコピーできる。
// copy() は metadata を引き継がないため contentType を再指定する。
export async function copyBlob(from, to, contentType = GEOJSON_CONTENT_TYPE) {
  await copy(from, to, {
    access: 'public',
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true
  });
}

// manifest.json を読む。未作成・取得失敗・壊れた JSON は空オブジェクト
// (採番は「パースできなければ n=1 から」で復旧する)
export async function readManifest() {
  const data = await readBlobJSON(MANIFEST_PATH);
  return (data && typeof data === 'object') ? data : {};
}

export async function writeManifest(manifest) {
  await putBlob(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'application/json');
}
