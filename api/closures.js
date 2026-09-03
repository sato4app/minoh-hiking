// 通行止め・通行困難地点(closures)の公開API(Vercel Function)
//
// - GET  /api/closures: 公開ストア(Vercel Blob)の最新 geojson を返す(認証不要)
// - POST /api/closures: 公開トークン(x-publish-token)を検証し、全置換で公開する
//
// 実装は _lib/publish.js に集約している(mapdata と共通)。
// 仕様: docs/publish-api-202609.md(契約バージョン 2.0・本書が正本)
//
// 契約 1.0 からの変更点(呼び出し側に影響する):
// - version はサーバーが採番する(送られても無視する)
// - 公開トークンの環境変数を CLOSURES_PUBLISH_TOKEN から MAP_PUBLISH_TOKEN へ変更
// - 履歴は closures/history/ への無制限追加をやめ、前回分1世代のみ(previous.geojson)

import { createDatasetHandler } from './_lib/publish.js';

export default createDatasetHandler('closures');
