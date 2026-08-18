// 全データセットの version・件数を返す公開API(Vercel Function)
//
// 利用者アプリは起動時にまずこれを読み、保存済み version と相違があるときだけ
// 本体(数百KB)を取りに行く。応答は数百バイト。
// 仕様: docs/publish-api-202608.md §5.2

import { DATASETS } from './_lib/datasets.js';
import { applyCors } from './_lib/http.js';
import { readBlobJSON, readManifest } from './_lib/store.js';

export default async function handler(req, res) {
  applyCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const manifest = await readManifest();
  const body = {};
  for (const dataset of Object.values(DATASETS)) {
    const entry = manifest[dataset.key];
    body[dataset.key] = typeof entry?.version === 'string'
      ? {
          version: entry.version,
          updatedAt: entry.updatedAt ?? null,
          count: Number.isFinite(entry.count) ? entry.count : 0
        }
      // manifest.json が未作成・取得失敗のときは、そのデータセットの本体から復元する
      : await summarizeFromBody(dataset);
  }
  res.status(200).json(body);
}

// 公開中の本体から version・updatedAt・件数を復元する。
// 本体も取得できないデータセットは空扱いで返す(アプリ側は version 相違として本体を取りに行く)
async function summarizeFromBody(dataset) {
  const data = await readBlobJSON(dataset.blobPath);
  if (!data) return { version: '', updatedAt: null, count: 0 };
  return {
    version: typeof data.version === 'string' ? data.version : '',
    updatedAt: data.updatedAt ?? null,
    count: Array.isArray(data.features) ? data.features.length : 0
  };
}
