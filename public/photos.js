// 写真モジュール(「写真を撮影」で撮った写真の保持・地図への表示・端末への保存)
// - 写真はアプリの中(IndexedDB の photos ストア)にだけ保存する。端末の写真アプリには残らない。
// - 写真は移動経路とは別に扱う。経路の記録・読み込み・クリアでは触らず、写真の「クリア」でだけ消す。
// - 地図には撮影地点にカメラの印を出し、押すと app.js の写真の表示(名前の変更)を開く。
// 撮影は camera.js、KMZ の出力・読み込みは kmz.js が担う。
import * as L from 'leaflet';
import { getMap, fitMapToLatLngs, buildMarkerIcon } from './map.js';
import { savePhotoRecord, listPhotoRecords, clearPhotoRecords } from './db.js';
import { PHOTO_MAX_COUNT, PHOTO_MAX_EDGE_PX, PHOTO_JPEG_QUALITY, PHOTOS_UNEXPORTED_KEY } from './config.js';
import { requestPersistentStorage } from './tiles.js';

// 写真の一覧(撮影・読み込みの順)。各要素は次の形: {
//   id:               保存のキー(撮影時刻 + 乱数)
//   name:             名前(既定は「写真n」。写真の表示で変更できる)
//   timeMs:           撮影日時(ms。他のアプリの KMZ から読んだもので不明なら null)
//   lat, lng:         撮影位置
//   blob:             画像(JPEG)
//   marker:           地図上のカメラの印(保存はしない)
// }
// 以前の版で保存した写真には、撮影地点として経路に入れた記録点の時刻(trackPointTimeMs)が
// 付いていることがあるが、今は使わない(経路と写真は結び付けない)。
let photos = [];
let onPhotoClick = null;    // 印が押されたとき(app.js が写真の表示を開く)
let onPhotosChanged = null; // 枚数・出力済みかどうかが変わったとき(app.js がパネルの表示を更新する)

export function setPhotoHandlers({ onClick, onChanged } = {}) {
  onPhotoClick = onClick || null;
  onPhotosChanged = onChanged || null;
}

export function getPhotos() {
  return photos.slice();
}

export function getPhotoCount() {
  return photos.length;
}

export function getPhoto(id) {
  return photos.find((p) => p.id === id) || null;
}

// 写真の全体が収まるよう地図を合わせる(読み込み直後に使う)
export function fitMapToPhotos() {
  fitMapToLatLngs(photos.map((p) => [p.lat, p.lng]));
}

// ===== 出力していない写真の有無 =====
// 写真ごとには持たず、1つの印で全体を表す(1枚でも未出力があれば全部を未出力として扱う。
// 出力は常に全部の写真をまとめて書き出すため、それで足りる)。
// 撮影・名前の変更で立て、KMZ を出力したら降ろす。読み込んだ写真はファイルが手元にあるため立てない
// (未出力の写真に追加で読み込んだときは立ったまま)。
// パネルの「未出力/出力済み」の表示と、クリアの確認で写真が消えることを強めに知らせるのに使う。
export function hasUnexportedPhotos() {
  if (photos.length === 0) return false;
  try { return localStorage.getItem(PHOTOS_UNEXPORTED_KEY) === '1'; } catch { return false; }
}

function setUnexported(on) {
  try {
    if (on) localStorage.setItem(PHOTOS_UNEXPORTED_KEY, '1');
    else localStorage.removeItem(PHOTOS_UNEXPORTED_KEY);
  } catch { /* noop */ }
}

export function markPhotosExported() {
  setUnexported(false);
  onPhotosChanged?.();
}

// ===== 地図上の印 =====
// 撮影地点の印。色・形・大きさは「マーカーの設定」の「写真撮影地点」に従う
// (既定値は config.js の MARKER_TYPES。起動時と設定の変更時に setPhotoStyle で受け取る)
let photoStyle = null;

function buildPhotoIcon() {
  return buildMarkerIcon(photoStyle, {
    fallbackColor: '#F97316',
    fallbackSize: 20,
    className: 'custom-marker photo-marker'
  });
}

// 撮影地点の印の見た目を変え、表示中の印にも反映する
export function setPhotoStyle(style) {
  photoStyle = style;
  for (const photo of photos) photo.marker?.setIcon(buildPhotoIcon());
}

function addMarker(photo) {
  const map = getMap();
  if (!map) return;
  photo.marker = L.marker([photo.lat, photo.lng], { icon: buildPhotoIcon(), title: photo.name })
    .addTo(map)
    .on('click', () => onPhotoClick?.(photo.id));
}

function removeMarker(photo) {
  if (photo.marker) getMap()?.removeLayer(photo.marker);
  photo.marker = null;
}

// ===== 追加・変更・消去 =====
function newPhotoId(timeMs) {
  return `${timeMs || Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toRecord(photo) {
  const { id, name, timeMs, lat, lng, blob } = photo;
  return { id, name, timeMs, lat, lng, blob };
}

// 写真を1枚加える。先に端末へ保存し、保存できたときだけ一覧と地図に加える
// (容量不足などで保存できないときは例外を投げる。呼び出し側で知らせる)。
async function addPhotoInternal({ name, timeMs, lat, lng, blob }) {
  const photo = {
    id: newPhotoId(timeMs),
    name,
    timeMs: Number.isFinite(timeMs) ? timeMs : null,
    lat,
    lng,
    blob,
    marker: null
  };
  await savePhotoRecord(toRecord(photo));
  photos.push(photo);
  addMarker(photo);
  return photo;
}

// 撮影した写真を加える(撮影時に app.js から呼ぶ)
export async function addPhoto(fields) {
  const photo = await addPhotoInternal(fields);
  setUnexported(true);
  onPhotosChanged?.();
  // 写真は端末の中にしか無いため、空き容量が少ないときに消されないよう永続化を依頼する
  requestPersistentStorage({ hasPhotos: true });
  return photo;
}

// 名前を変える(写真の表示から)。端末の保存も書き換える。
// 出力済みの KMZ とは名前が違ってしまうため、未出力に戻す
export async function renamePhoto(id, name) {
  const photo = getPhoto(id);
  if (!photo) return;
  photo.name = name;
  photo.marker?.getElement()?.setAttribute('title', name);
  setUnexported(true);
  onPhotosChanged?.();
  await savePhotoRecord(toRecord(photo));
}

// 全写真を消す(写真の「クリア」と、クリアを選んだ撮影・読み込みから app.js が呼ぶ)
export async function clearPhotos() {
  for (const photo of photos) removeMarker(photo);
  photos = [];
  setUnexported(false);
  onPhotosChanged?.();
  try { await clearPhotoRecords(); } catch { /* 保存を消せなくても表示は消す */ }
}

// 起動時に1回だけ呼ぶ。端末に保存済みの写真を読み出して地図に出す。読み出した枚数を返す。
export async function restorePhotos() {
  let records = [];
  try {
    records = await listPhotoRecords();
  } catch {
    return 0;
  }
  records.sort((a, b) => (a.timeMs ?? 0) - (b.timeMs ?? 0));
  for (const record of records) {
    if (!(record.blob instanceof Blob) || !Number.isFinite(record.lat) || !Number.isFinite(record.lng)) continue;
    const photo = { ...record, marker: null };
    photos.push(photo);
    addMarker(photo);
  }
  onPhotosChanged?.();
  return photos.length;
}

// 読み込んだ画像が大きすぎるときは、撮影した写真と同じ大きさ(長辺 PHOTO_MAX_EDGE_PX)に縮める。
// 縮められないとき(画像を開けない等)は元のまま使う。
async function shrinkImage(blob) {
  if (blob.size <= 1024 * 1024 || typeof createImageBitmap !== 'function') return blob;
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, PHOTO_MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b || blob), 'image/jpeg', PHOTO_JPEG_QUALITY);
    });
  } catch {
    return blob;
  }
}

// KMZ から読んだ写真を加える(app.js の読み込みから)。上限(PHOTO_MAX_COUNT)を超える分は加えない。
// items: [{ name, timeMs, lat, lng, blob }]。名前が無いものは defaultName(n) で付ける。
// 加えた枚数と、上限で加えなかった枚数を返す。途中で保存に失敗したらそこで止めて例外を投げる。
export async function importPhotos(items, defaultName) {
  const room = Math.max(0, PHOTO_MAX_COUNT - photos.length);
  const targets = items.slice(0, room);
  let added = 0;
  try {
    for (const item of targets) {
      const blob = await shrinkImage(item.blob);
      const name = item.name || defaultName(photos.length + 1);
      await addPhotoInternal({ ...item, name, blob });
      added++;
    }
  } finally {
    onPhotosChanged?.();
  }
  if (added > 0) requestPersistentStorage({ hasPhotos: true });
  return { added, skipped: items.length - targets.length };
}
