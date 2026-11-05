// 領域の表示モジュール(暫定機能。存続させるかは未定)
// - 起動 URL に ?p=geojson を付けて開いたときだけ使える。付けずに開いたときは使えない
//   (有効にしたことは端末に保存しない。言語の変更などの再読み込みは URL ごと読み直すため続けて使える)
// - GeoJSON の Polygon / MultiPolygon を読み込み、地図に重ねて表示する
// - 読み込んだ領域は端末(IndexedDB)に保存し、再起動しても残す
// 領域はタップに反応させず、ルートや印より下に描く(領域の内側でもルート・ポイントのポップアップが出るように)。
import * as L from 'leaflet';
import { getMap, fitMapToLatLngs } from './map.js';
import { saveLatestAreas, loadLatestAreas, clearLatestAreas } from './db.js';
import { AREA_STYLE } from './config.js';
import { t } from './i18n.js';

// 領域の表示を使うときの ?p= の値
const PROFILE_AREAS = 'geojson';

// 領域を描く専用の pane。地理院タイル(200)より上、ルート等のベクタ(overlayPane=400)より下
const AREA_PANE = 'areaPane';
const AREA_PANE_Z_INDEX = 350;

let areas = [];          // 読み込んだ geometry(Polygon / MultiPolygon)の配列
let areaLayer = null;
let areaRenderer = null;
let areasVisible = false;

// ===== ?p=geojson(使えるかどうか) =====
// 開いている URL に ?p=geojson が付いているか
export function isAreaFeatureEnabled() {
  return new URLSearchParams(location.search).get('p') === PROFILE_AREAS;
}

// 他の人に渡す URL(「QR」の QR コード)から ?p=geojson を外す。
// 付けたままだと、QR コードから開いた人も領域の表示を使えてしまうため
export function withoutAreaProfile(href) {
  const url = new URL(href);
  if (url.searchParams.get('p') !== PROFILE_AREAS) return href;
  url.searchParams.delete('p');
  return url.href;
}

// ===== GeoJSON の解析 =====
// 文字列から Polygon / MultiPolygon を取り出す。FeatureCollection・Feature・geometry のどれでもよく、
// GeometryCollection の中も見る。それ以外の種類(点・線)と、形の壊れた領域は数えて読み飛ばす。
// 緯度・経度の範囲を外れる座標があれば、ファイル全体を読み込まない(平面直角座標系などの
// GeoJSON を、見当違いの場所に描かないため)。
// 戻り値: { geometries, skipped }
export function parseAreaGeoJSON(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(t('area.importInvalidJson'));
  }
  const geometries = [];
  let skipped = 0;
  let outOfRange = false;

  const visitGeometry = (geometry) => {
    if (geometry?.type === 'GeometryCollection') {
      for (const g of geometry.geometries || []) visitGeometry(g);
      return;
    }
    const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates]
      : geometry?.type === 'MultiPolygon' ? geometry.coordinates
        : null;
    if (!Array.isArray(polygons) || polygons.length === 0 || !polygons.every(isPolygonCoords)) {
      skipped += 1;
      return;
    }
    if (!polygons.every((rings) => rings.every((ring) => ring.every(isLngLatInRange)))) outOfRange = true;
    geometries.push({ type: geometry.type, coordinates: geometry.coordinates });
  };

  const visit = (obj) => {
    if (obj?.type === 'FeatureCollection') {
      for (const feature of obj.features || []) visit(feature);
    } else if (obj?.type === 'Feature') {
      visitGeometry(obj.geometry);
    } else {
      visitGeometry(obj);
    }
  };
  visit(data);

  if (outOfRange) throw new Error(t('area.importOutOfRange'));
  return { geometries, skipped };
}

// 座標1つ([経度, 緯度, 標高(任意)])が数値か
function isPosition(p) {
  return Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

// Polygon の座標(外周と穴の輪の配列)の形が正しいか。輪は閉じた4点以上
function isPolygonCoords(rings) {
  return Array.isArray(rings) && rings.length > 0 &&
    rings.every((ring) => Array.isArray(ring) && ring.length >= 4 && ring.every(isPosition));
}

function isLngLatInRange(p) {
  return Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
}

// ===== 地図への表示 =====
function buildAreaLayer(map) {
  if (!map.getPane(AREA_PANE)) map.createPane(AREA_PANE).style.zIndex = String(AREA_PANE_Z_INDEX);
  // ルート等の Canvas(overlayPane)とは別の Canvas にして、領域だけ下の pane に描く
  if (!areaRenderer) areaRenderer = L.canvas({ pane: AREA_PANE });
  const features = areas.map((geometry) => ({ type: 'Feature', properties: {}, geometry }));
  return L.geoJSON({ type: 'FeatureCollection', features }, {
    pane: AREA_PANE,
    renderer: areaRenderer,
    interactive: false,
    style: () => ({ ...AREA_STYLE })
  });
}

function rebuildAreaLayer() {
  const map = getMap();
  if (!map) return;
  if (areaLayer) areaLayer.remove();
  areaLayer = areas.length > 0 ? buildAreaLayer(map) : null;
  if (areaLayer && areasVisible) areaLayer.addTo(map);
}

// 表示の ON/OFF(「領域を表示」トグルと画面の切替から呼ぶ)。OFF でも領域は保持する
export function setAreasVisible(visible) {
  areasVisible = visible;
  const map = getMap();
  if (!areaLayer || !map) return;
  if (visible) areaLayer.addTo(map);
  else areaLayer.remove();
}

export function getAreaCount() {
  return areas.length;
}

// 領域の全体が収まるよう地図を合わせる(読み込み直後に使う)
export function fitMapToAreas() {
  if (areaLayer) fitMapToLatLngs([], areaLayer.getBounds());
}

// 読み込んだ領域を表示して端末に保存する。append=false は表示中の領域と置き換える。
// 保存に失敗しても表示はそのまま(次の起動で出ないだけ)
export async function loadAreas(geometries, { append = false } = {}) {
  areas = append ? [...areas, ...geometries] : [...geometries];
  rebuildAreaLayer();
  try {
    await saveLatestAreas(areas);
  } catch (err) {
    console.warn('領域の保存に失敗:', err);
  }
}

// 領域をすべて消す(表示と端末の保存の両方)
export async function clearAreas() {
  areas = [];
  rebuildAreaLayer();
  try {
    await clearLatestAreas();
  } catch (err) {
    console.warn('領域の保存の削除に失敗:', err);
  }
}

// 端末に保存してある領域を読み出して表示する(起動時)。読めなければ何も出さない
export async function restoreAreas() {
  try {
    areas = await loadLatestAreas();
  } catch (err) {
    console.warn('領域の復元に失敗:', err);
    areas = [];
  }
  rebuildAreaLayer();
  return areas.length;
}
