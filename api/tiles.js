// オフライン地図のタイル一覧(タイルマニフェスト)の公開API(Vercel Function)
//
// - GET  /api/tiles: 公開ストア(Vercel Blob)の最新タイル一覧を返す(認証不要)
// - POST /api/tiles: 公開トークン(x-publish-token)を検証し、全置換で公開する
//
// 実装は _lib/publish.js に集約している(mapdata・closures と共通)。
// GeoJSON ではないため、検証と本体の組み立ては _lib/datasets.js の定義で差し替えている。
// 仕様: docs/publish-api-202609.md(契約バージョン 2.1・本書が正本)

import { createDatasetHandler } from './_lib/publish.js';

export default createDatasetHandler('tiles');
