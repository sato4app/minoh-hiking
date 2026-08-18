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
