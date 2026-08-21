// 公開データセットの定義(公開API 仕様書 docs/publish-api-202608.md §2.1・§6・§7.1)
//
// エンドポイント(api/mapdata.js / api/closures.js)は、この定義を渡すだけで
// GET 配信・POST 公開・version 採番・検証を共通実装(_lib/publish.js)に委ねる。
// データセットを増やすときは、ここに1件足してエンドポイントを1本作る。
//
// 注: api/ 配下で `_` から始まるディレクトリは Vercel が関数として公開しない。
//
// GeoJSON 以外のデータセット(tiles)は、検証・本体の組み立て・件数の数え方が違うため
// validate / buildBody / countOf / emptyBody / contentType を定義で上書きする。
// 省略した場合は GeoJSON として扱う(mapdata・closures)。

import { validateTileManifest } from './validate.js';

export const DATASETS = {
  // 緊急ポイント・ハイキングルート・スポット(統合1本)
  mapdata: {
    key: 'mapdata',
    blobPath: 'mapdata/minoh-hiking-mapdata.geojson',
    previousPath: 'mapdata/previous.geojson',
    versionPeriod: 'year',   // yyyy.n
    geometryTypes: ['Point', 'LineString'],
    // properties.type → 許可する geometry(この表に無い type は 400)
    featureTypes: {
      'ポイントGPS': 'Point',
      spot: 'Point',
      route: 'LineString'
    }
  },
  // 通行止め・通行困難地点
  closures: {
    key: 'closures',
    blobPath: 'closures/minoh-hiking-closure.geojson',
    previousPath: 'closures/previous.geojson',
    versionPeriod: 'month',  // yyyy-mm.n
    geometryTypes: ['Point'],
    featureTypes: null       // properties.type は問わない
  },
  // オフライン地図のダウンロード対象タイル一覧(GeoJSON ではない)
  tiles: {
    key: 'tiles',
    blobPath: 'tiles/tile_manifest.json',
    previousPath: 'tiles/previous.json',
    versionPeriod: 'year',   // yyyy.n(タイル範囲の変更は多くない)
    contentType: 'application/json; charset=utf-8',
    validate: validateTileManifest,
    // source は DownloadArea が入れる出力元の記録。version / updatedAt はサーバーが付ける
    buildBody: (input, version, updatedAt) => ({
      version,
      updatedAt,
      source: typeof input.source === 'string' ? input.source : '',
      layers: input.layers
    }),
    // 件数は「全レイヤーのタイル枚数の合計」とする(manifest の count に入る)
    countOf: (input) => Object.values(input.layers)
      .reduce((n, layer) => n + layer.tiles.length, 0),
    emptyBody: () => ({ version: '', updatedAt: null, source: '', layers: {} })
  }
};
