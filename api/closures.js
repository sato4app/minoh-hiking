// 通行止め・通行困難地点(closures)の公開API(Vercel Function)
//
// ⚠ POST は外部の運用アプリ(別リポジトリ)から呼ばれている。検証・レスポンスを変えるときは
//   設計書 docs-closures/closures-design-202607.md §5 の契約バージョンを更新し、
//   呼び出し側にも反映すること。(本アプリ minoh-hiking は表示専用で GET しか使わない)
//
// - GET  /api/closures: 公開ストア(Vercel Blob)の最新 geojson を返す(認証不要)。
//   Blob 未作成・取得失敗時は空の FeatureCollection を返す(アプリ表示を止めない)。
// - POST /api/closures: 公開トークン(x-publish-token ヘッダ)を検証し、
//   受け取った geojson を Blob へ全置換保存する(あわせて履歴スナップショットも保存)。
//
// 必要な Vercel 設定:
// - Blob ストアをプロジェクトに接続(BLOB_READ_WRITE_TOKEN が自動設定される)
// - 環境変数 CLOSURES_PUBLISH_TOKEN に公開トークンを設定(コミット禁止)
//
// GitHub Pages 版アプリ・運用アプリからもクロスオリジンで参照するため、CORS を許可する。
// 設計書: docs-closures/closures-design-202607.md §5(公開API・契約バージョン 1.0)

import { createHash, timingSafeEqual } from 'node:crypto';
import { head, put } from '@vercel/blob';

// Blob 上の保存パス(全置換の対象)と履歴スナップショットの置き場
const BLOB_PATH = 'closures/minoh-hiking-closure.geojson';
const HISTORY_PREFIX = 'closures/history/';

// 座標の妥当範囲(箕面エリア周辺・広めに取る)。範囲外は入力ミスとして 400 にする
const LON_RANGE = [135.2, 135.8];
const LAT_RANGE = [34.6, 35.1];

export default async function handler(req, res) {
  // CORS: GET は全公開データ、POST はトークンで保護されるため Origin は限定しない
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-publish-token');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method === 'GET') {
    await handleGet(req, res);
    return;
  }
  if (req.method === 'POST') {
    await handlePost(req, res);
    return;
  }
  res.status(405).json({ error: 'Method Not Allowed' });
}

// ===== GET: 最新データの配信 =====
async function handleGet(req, res) {
  // ユーザーが常にフレッシュ取得する(キャッシュは端末側の Service Worker が担う)
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/geo+json; charset=utf-8');

  const body = await readPublishedGeoJSON();
  if (body !== null) {
    res.status(200).send(body);
    return;
  }
  // Blob 未作成・取得失敗時も 200 で空を返す(アプリ側の表示を止めない)
  res.status(200).send(JSON.stringify({ type: 'FeatureCollection', version: '', features: [] }));
}

// Blob の最新 geojson を文字列で返す。未作成なら null
async function readPublishedGeoJSON() {
  let meta;
  try {
    meta = await head(BLOB_PATH);
  } catch {
    return null; // BlobNotFoundError(初回公開前)や設定不備
  }
  // Blob の CDN キャッシュを避けるため、毎回ユニークなクエリを付けて取得する
  const blobRes = await fetch(`${meta.url}?_=${Date.now()}`, { cache: 'no-store' });
  if (!blobRes.ok) return null;
  return blobRes.text();
}

// ===== POST: 公開(全置換保存) =====
async function handlePost(req, res) {
  const expected = process.env.CLOSURES_PUBLISH_TOKEN;
  if (!expected) {
    res.status(503).json({ error: '公開トークンが未設定です(Vercel の環境変数 CLOSURES_PUBLISH_TOKEN を設定してください)' });
    return;
  }
  const given = req.headers['x-publish-token'];
  if (typeof given !== 'string' || !tokenEquals(given, expected)) {
    res.status(401).json({ error: '公開トークンが正しくありません' });
    return;
  }

  const data = req.body;
  const error = validateClosureGeoJSON(data);
  if (error) {
    res.status(400).json({ error });
    return;
  }

  // 更新日時はサーバー側で付与する(設計書 §5.4)
  data.updatedAt = new Date().toISOString();
  const json = JSON.stringify(data, null, 2);

  try {
    await put(BLOB_PATH, json, {
      access: 'public',
      contentType: 'application/geo+json',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60 // 最小値。GET はクエリ付き取得でさらにキャッシュを回避する
    });
  } catch (err) {
    console.error('Blob への保存に失敗:', err);
    res.status(500).json({ error: '公開ストアへの保存に失敗しました' });
    return;
  }

  // 履歴スナップショット(git に履歴を残さない代わりの記録)。失敗しても公開は成立させる
  const versionSlug = String(data.version).replace(/[^\w.-]/g, '_');
  try {
    await put(`${HISTORY_PREFIX}${data.updatedAt.replace(/[:.]/g, '-')}-v${versionSlug}.geojson`, json, {
      access: 'public',
      contentType: 'application/geo+json',
      addRandomSuffix: true
    });
  } catch (err) {
    console.warn('履歴スナップショットの保存に失敗(公開自体は成功):', err);
  }

  res.status(200).json({
    ok: true,
    version: data.version,
    count: data.features.length,
    updatedAt: data.updatedAt
  });
}

// トークン比較(タイミング攻撃対策に固定長ハッシュ同士で比較する)
function tokenEquals(a, b) {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

// 入力検証: 問題なければ null、あればエラーメッセージを返す(設計書 §5.4)。
// アプリ側 validateClosureGeoJSON と同等の確認に加え、version 必須・
// id 重複・座標範囲をサーバー側でも検証する
function validateClosureGeoJSON(data) {
  if (!data || typeof data !== 'object' || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
    return 'FeatureCollection 形式の geojson ではありません';
  }
  if (typeof data.version !== 'string' || !data.version.trim()) {
    return 'version がありません(公開にはバージョンが必要です)';
  }
  const ids = new Set();
  for (const [i, f] of data.features.entries()) {
    const label = `features[${i}]`;
    if (!f || f.type !== 'Feature' || !f.geometry) {
      return `${label} が Feature 形式ではありません`;
    }
    if (f.geometry.type !== 'Point' || !Array.isArray(f.geometry.coordinates)) {
      return `${label} が Point 地物ではありません`;
    }
    const [lon, lat] = f.geometry.coordinates;
    if (typeof lon !== 'number' || typeof lat !== 'number' ||
        lon < LON_RANGE[0] || lon > LON_RANGE[1] || lat < LAT_RANGE[0] || lat > LAT_RANGE[1]) {
      return `${label} の座標が箕面エリアの範囲外です: [${lon}, ${lat}]`;
    }
    const id = f.properties?.id;
    if (id != null) {
      if (ids.has(id)) return `id が重複しています: ${id}`;
      ids.add(id);
    }
  }
  return null;
}
