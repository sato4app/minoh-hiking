// データセット1本ぶんの公開エンドポイント(GET 配信 / POST 公開)の共通実装。
// 仕様: docs/publish-api-202608.md(契約バージョン 2.0)— 本書が正本。
//
// ⚠ POST は外部の運用アプリ MapPublisher(別リポジトリ)から呼ばれている。
//   検証・レスポンスを変えるときは仕様書の契約バージョンを更新し、
//   呼び出し側にも反映すること。(本アプリ minoh-hiking は表示専用で GET しか使わない)

import { DATASETS } from './datasets.js';
import { applyCors, requirePublishToken } from './http.js';
import { readBlobText, putBlob, copyBlob, readManifest, writeManifest } from './store.js';
import { nextVersion } from './version.js';
import { validateGeoJSON } from './validate.js';

// データセット名から Vercel Function のハンドラーを作る(api/mapdata.js・api/closures.js)
export function createDatasetHandler(datasetKey) {
  const dataset = DATASETS[datasetKey];
  if (!dataset) throw new Error(`未定義のデータセットです: ${datasetKey}`);

  return async function handler(req, res) {
    applyCors(res);

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    if (req.method === 'GET') {
      await handleGet(dataset, res);
      return;
    }
    if (req.method === 'POST') {
      await handlePost(dataset, req, res);
      return;
    }
    res.status(405).json({ error: 'Method Not Allowed' });
  };
}

// ===== GET: 最新データの配信 =====
async function handleGet(dataset, res) {
  // 常にフレッシュに返す(キャッシュは端末側のアプリが Cache API で担う)
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', dataset.contentType ?? 'application/geo+json; charset=utf-8');

  const body = await readBlobText(dataset.blobPath);
  if (body !== null) {
    res.status(200).send(body);
    return;
  }
  // Blob 未作成・取得失敗時も 200 で空を返す(アプリ側の表示を止めない)
  res.status(200).send(JSON.stringify(emptyBodyOf(dataset)));
}

// ===== POST: 公開(全置換保存) =====
// 書き込み順は仕様書 §7.2 のとおり: 採番 → 検証 → 前回分へ退避 → 本体 → manifest。
// manifest の put で失敗したら 500 を返す。manifest が進んでいないため、
// 再実行すると同じ version が再採番される(冪等)。運用者は「もう一度公開」で復旧できる。
async function handlePost(dataset, req, res) {
  // 認証は検証より前に行う(未認証者に検証の詳細を返さない)
  if (!requirePublishToken(req, res)) return;

  const manifest = await readManifest();
  const version = nextVersion(manifest[dataset.key]?.version, dataset.versionPeriod);

  const error = (dataset.validate ?? validateGeoJSON)(req.body, dataset);
  if (error) {
    res.status(400).json({ error });
    return;
  }

  // version / updatedAt は送られても無視し、サーバーの値を採用する(仕様書 §3.1)
  const updatedAt = new Date().toISOString();
  const count = countOf(dataset, req.body);
  const json = JSON.stringify(buildBody(dataset, req.body, version, updatedAt), null, 2);

  // 前回分の退避。初回公開時は本体が無く BlobNotFoundError になる。
  // 退避に失敗しても公開は成立させる(公開を止めるほうが運用上の害が大きい)
  try {
    await copyBlob(dataset.blobPath, dataset.previousPath);
  } catch (err) {
    console.warn(`[${dataset.key}] 前回分の退避に失敗(公開自体は続行):`, err);
  }

  try {
    await putBlob(dataset.blobPath, json);
  } catch (err) {
    console.error(`[${dataset.key}] Blob への保存に失敗:`, err);
    res.status(500).json({ error: '公開ストアへの保存に失敗しました' });
    return;
  }

  manifest[dataset.key] = { version, updatedAt, count };
  try {
    await writeManifest(manifest);
  } catch (err) {
    console.error(`[${dataset.key}] manifest.json の更新に失敗:`, err);
    res.status(500).json({ error: 'manifest.json の更新に失敗しました(もう一度公開してください)' });
    return;
  }

  res.status(200).json({
    ok: true,
    dataset: dataset.key,
    version,
    count,
    updatedAt
  });
}

// ===== データセットごとの差分(既定は GeoJSON) =====
// mapdata / closures は FeatureCollection、tiles はタイル一覧という別構造のため、
// 「保存する本体」「件数」「空のときに返す形」だけを定義側から差し替える。

function buildBody(dataset, input, version, updatedAt) {
  if (dataset.buildBody) return dataset.buildBody(input, version, updatedAt);
  return { type: 'FeatureCollection', version, updatedAt, features: input.features };
}

export function countOf(dataset, input) {
  if (dataset.countOf) return dataset.countOf(input);
  return Array.isArray(input?.features) ? input.features.length : 0;
}

function emptyBodyOf(dataset) {
  if (dataset.emptyBody) return dataset.emptyBody();
  return { type: 'FeatureCollection', version: '', features: [] };
}
