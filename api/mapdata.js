// 地図データ(緊急ポイント・ハイキングルート・スポット)の公開API(Vercel Function)
//
// - GET  /api/mapdata: 公開ストア(Vercel Blob)の最新 geojson を返す(認証不要)
// - POST /api/mapdata: 公開トークン(x-publish-token)を検証し、全置換で公開する
//
// 実装は _lib/publish.js に集約している(closures と共通)。
// 仕様: docs/publish-api-202608.md(契約バージョン 2.0・本書が正本)

import { createDatasetHandler } from './_lib/publish.js';

export default createDatasetHandler('mapdata');
