// 通行止め・通行困難地点(closures)の公開API(Vercel Function)
//
// - GET  /api/closures: 公開ストア(Vercel Blob)の最新 geojson を返す(認証不要)
// - POST /api/closures: 公開トークン(x-publish-token)を検証し、全置換で公開する
//
// 実装は _lib/publish.js に集約している(mapdata と共通)。
// 仕様: docs/publish-api-202609.md(本書が正本)

import { createDatasetHandler } from './_lib/publish.js';

export default createDatasetHandler('closures');
