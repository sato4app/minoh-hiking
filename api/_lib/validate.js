// 公開データの検証(公開API 仕様書 docs/publish-api-202608.md §6)
//
// 判定はここにのみ置く。呼び出し側(MapPublisher)には同じルールを持たせない
// (二重管理は必ずズレるため)。失敗時は日本語のメッセージを返し、
// 呼び出し側はそれをそのまま表示する。

// 座標の妥当範囲(箕面エリア周辺・広めに取る)。範囲外は入力ミスとして 400 にする
const LON_RANGE = [135.2, 135.8];
const LAT_RANGE = [34.6, 35.1];

// 問題なければ null、あればエラーメッセージを返す。
// dataset は _lib/datasets.js の定義(許可 geometry・type 表を持つ)。
export function validateGeoJSON(data, dataset) {
  if (!data || typeof data !== 'object' || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
    return 'FeatureCollection 形式の geojson ではありません';
  }

  const ids = new Set();
  for (const [i, f] of data.features.entries()) {
    const label = `features[${i}]`;
    if (!f || f.type !== 'Feature' || !f.geometry) {
      return `${label} が Feature 形式ではありません`;
    }

    const geometryType = f.geometry.type;
    if (!dataset.geometryTypes.includes(geometryType) || !Array.isArray(f.geometry.coordinates)) {
      return `${label} の geometry が ${dataset.geometryTypes.join(' / ')} ではありません`;
    }

    const props = f.properties || {};

    // type と geometry の対応(mapdata のみ。closures は type を問わない)
    if (dataset.featureTypes) {
      const expected = dataset.featureTypes[props.type];
      if (!expected) {
        return `${label} の type が公開対象外です: ${props.type ?? '(未設定)'}`;
      }
      if (expected !== geometryType) {
        return `${label}(${props.type}) の geometry は ${expected} である必要があります`;
      }
    }

    // 座標範囲。LineString は全頂点を検査する
    const positions = geometryType === 'LineString' ? f.geometry.coordinates : [f.geometry.coordinates];
    for (const pos of positions) {
      const err = checkPosition(pos, label);
      if (err) return err;
    }

    // ルートの端点座標も同様に検査する(null は許容)
    for (const key of ['startPointGPS', 'endPointGPS']) {
      if (props[key] == null) continue;
      const err = checkPosition(props[key], `${label} の ${key}`);
      if (err) return err;
    }

    // id は一意であること。id を持たない Feature(spot 等)はスキップする
    const id = props.id;
    if (id != null) {
      if (ids.has(id)) return `id が重複しています: ${id}`;
      ids.add(id);
    }
  }
  return null;
}

// 1点分の座標検査。問題なければ null
function checkPosition(pos, label) {
  if (!Array.isArray(pos)) return `${label} の座標が配列ではありません`;
  const [lon, lat] = pos;
  if (typeof lon !== 'number' || typeof lat !== 'number' ||
      lon < LON_RANGE[0] || lon > LON_RANGE[1] || lat < LAT_RANGE[0] || lat > LAT_RANGE[1]) {
    return `${label} の座標が箕面エリアの範囲外です: [${lon}, ${lat}]`;
  }
  return null;
}

// ===== タイルマニフェスト(tiles)の検証 =====
// GeoJSON ではないため専用の検証を持つ(仕様書 §6.4)。
// 構造: { version?, source?, layers: { <キー>: { z, tile_count?, tiles: [[x, y], ...] } } }
// version / updatedAt はサーバーが採番・付与するため、ここでは検証しない。

const ZOOM_RANGE = [10, 18];   // アプリの minZoom / maxZoom に合わせる

// タイル(z/x/y)が覆う経緯度の範囲。範囲チェックを座標と同じ土俵で行うために使う
function tileLonLatBounds(x, y, z) {
  const n = Math.pow(2, z);
  const lonOf = (tx) => tx / n * 360 - 180;
  const latOf = (ty) => {
    const r = Math.PI - 2 * Math.PI * ty / n;
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(r) - Math.exp(-r)));
  };
  return { lonMin: lonOf(x), lonMax: lonOf(x + 1), latMin: latOf(y + 1), latMax: latOf(y) };
}

export function validateTileManifest(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return 'タイルマニフェストの形式ではありません';
  }
  const layers = data.layers;
  if (!layers || typeof layers !== 'object' || Array.isArray(layers)) {
    return 'layers がありません';
  }
  const keys = Object.keys(layers);
  if (keys.length === 0) return 'layers が空です';

  for (const key of keys) {
    const layer = layers[key];
    const label = `layers.${key}`;
    if (!layer || typeof layer !== 'object') return `${label} の形式が不正です`;

    const z = layer.z;
    if (!Number.isInteger(z) || z < ZOOM_RANGE[0] || z > ZOOM_RANGE[1]) {
      return `${label} の z が ${ZOOM_RANGE[0]}〜${ZOOM_RANGE[1]} ではありません: ${z}`;
    }
    if (!Array.isArray(layer.tiles)) return `${label} の tiles が配列ではありません`;

    // 途中で切れたファイルに気づけるよう、宣言された枚数と実際の要素数を照合する
    if (layer.tile_count != null && layer.tile_count !== layer.tiles.length) {
      return `${label} の tile_count(${layer.tile_count})と tiles の要素数(${layer.tiles.length})が一致しません`;
    }

    const max = Math.pow(2, z);
    for (const [i, tile] of layer.tiles.entries()) {
      if (!Array.isArray(tile) || tile.length < 2) return `${label}.tiles[${i}] が [x, y] ではありません`;
      const [x, y] = tile;
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= max || y >= max) {
        return `${label}.tiles[${i}] の座標が z=${z} の範囲外です: [${x}, ${y}]`;
      }
      // 座標データと同じ考え方で、箕面エリアに掛からないタイルは入力ミスとして弾く
      const b = tileLonLatBounds(x, y, z);
      if (!(b.lonMin < LON_RANGE[1] && b.lonMax > LON_RANGE[0] &&
            b.latMin < LAT_RANGE[1] && b.latMax > LAT_RANGE[0])) {
        return `${label}.tiles[${i}] が箕面エリアの範囲外です: [${x}, ${y}]`;
      }
    }
  }
  return null;
}
