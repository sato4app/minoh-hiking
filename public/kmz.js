// 写真の出力・読み込み(KMZ)モジュール
// KMZ は KML(地点の一覧)と画像を ZIP にまとめたもの。本アプリは写真だけを KMZ に入れ、
// 経路は GPX で別に出力する(app.js)。構成は次のとおり:
//   doc.kml               … 写真1枚につき Placemark 1つ(名前・撮影日時・位置・画像への参照)
//   files/photo-001.jpg … 写真本体(doc.kml の description から <img src> で参照する)
// ZIP は外部ライブラリを使わずに組み立てる。写真(JPEG)はもともと圧縮されているため、
// 出力は無圧縮(stored)で足りる。読み込みは他のアプリの KMZ にも備え、無圧縮と
// Deflate(DecompressionStream)の両方を読む。
import { t } from './i18n.js';

// ===== ZIP の組み立て(無圧縮) =====
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ZIP のファイル時刻(MS-DOS 形式。端末の現地時刻で書く)
function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

// entries: [{ name, data: Uint8Array }]。名前は UTF-8 で書き、そのことを示すフラグ(bit 11)を立てる。
function buildZip(entries) {
  const encoder = new TextEncoder();
  const { time, day } = dosDateTime(new Date());
  const parts = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);   // ローカルファイルヘッダ
    local.setUint16(4, 20, true);           // 展開に必要な版
    local.setUint16(6, 0x0800, true);       // 名前は UTF-8
    local.setUint16(8, 0, true);            // 無圧縮
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    parts.push(local, nameBytes, entry.data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);      // セントラルディレクトリ
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, day, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, size, true);
    cd.setUint32(24, size, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);         // ローカルヘッダの位置
    central.push(cd, nameBytes);

    offset += 30 + nameBytes.length + size;
  }
  const cdSize = central.reduce((sum, p) => sum + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);       // 終端レコード
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/vnd.google-earth.kmz' });
}

// ===== ZIP の読み取り =====
// 中身の一覧を返す。各要素の read() で展開した内容(Uint8Array)を得る。
function readZip(buffer) {
  const view = new DataView(buffer);
  // 終端レコードを末尾から探す(後ろにコメントが付いていることがあるため)
  let endPos = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { endPos = i; break; }
  }
  if (endPos < 0) throw new Error(t('photo.importNotKmz'));
  const count = view.getUint16(endPos + 10, true);
  let pos = view.getUint32(endPos + 16, true);
  const utf8 = new TextDecoder('utf-8');
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(pos, true) !== 0x02014b50) throw new Error(t('photo.importNotKmz'));
    const method = view.getUint16(pos + 10, true);
    const compSize = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localPos = view.getUint32(pos + 42, true);
    const name = utf8.decode(new Uint8Array(buffer, pos + 46, nameLen));
    pos += 46 + nameLen + extraLen + commentLen;
    // 内容の位置はローカルヘッダの名前・拡張欄の長さで決まる(セントラル側と違うことがある)
    const localNameLen = view.getUint16(localPos + 26, true);
    const localExtraLen = view.getUint16(localPos + 28, true);
    const dataPos = localPos + 30 + localNameLen + localExtraLen;
    const data = new Uint8Array(buffer, dataPos, compSize);
    entries.push({
      name,
      read: async () => {
        if (method === 0) return data;
        if (method === 8 && typeof DecompressionStream === 'function') {
          const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
          return new Uint8Array(await new Response(stream).arrayBuffer());
        }
        throw new Error(t('photo.importUnsupported'));
      }
    });
  }
  return entries;
}

// ファイルの先頭が ZIP(KMZ)かどうか。拡張子ではなく中身で判定する
// (読み込みのファイル選択は accept で絞り込まないため、名前に頼らない)。
export async function isZipFile(file) {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return head.length === 4 && head[0] === 0x50 && head[1] === 0x4B && head[2] === 0x03 && head[3] === 0x04;
}

// ===== 写真の KMZ =====
const IMAGE_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

function escapeXml(s) {
  return String(s)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

// 出力する写真の画像を読み出す(Blob → Uint8Array)。読み出しは非同期のため、
// 出力ボタンを押す前に済ませておき、押したときは同期的にダウンロードを始める
// (待ってからダウンロードすると、端末によっては操作の続きと見なされず止められる)。
export async function loadPhotoBytes(photos) {
  return Promise.all(photos.map(async (p) => new Uint8Array(await p.blob.arrayBuffer())));
}

// 写真の KMZ を組み立てる。bytesList は loadPhotoBytes の結果(photos と同順)。
// title は KML の Document 名(ファイル名から拡張子を除いたもの)。
export function buildPhotosKmz(photos, bytesList, title) {
  const files = [];
  const placemarks = photos.map((p, i) => {
    const ext = p.blob.type === 'image/png' ? 'png' : 'jpg';
    const path = `files/photo-${String(i + 1).padStart(3, '0')}.${ext}`;
    files.push({ name: path, data: bytesList[i] });
    const when = Number.isFinite(p.timeMs)
      ? `\n      <TimeStamp><when>${new Date(p.timeMs).toISOString()}</when></TimeStamp>`
      : '';
    return '    <Placemark>\n' +
      `      <name>${escapeXml(p.name)}</name>${when}\n` +
      `      <description><![CDATA[<img src="${path}" width="400" />]]></description>\n` +
      `      <Point><coordinates>${p.lng.toFixed(6)},${p.lat.toFixed(6)}</coordinates></Point>\n` +
      '    </Placemark>';
  });
  const kml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<kml xmlns="http://www.opengis.net/kml/2.2">\n' +
    '  <Document>\n' +
    `    <name>${escapeXml(title)}</name>\n` +
    `${placemarks.join('\n')}\n` +
    '  </Document>\n' +
    '</kml>\n';
  // doc.kml を先頭に置く(KMZ の慣例。最初の .kml を本体とみなすアプリがある)
  return buildZip([{ name: 'doc.kml', data: new TextEncoder().encode(kml) }, ...files]);
}

// KMZ から写真を取り出す。[{ name, timeMs, lat, lng, blob }] を返す。
// 本アプリの出力形式が正式な対象。他のアプリの KMZ は「位置(Point)と、KMZ 内の画像への
// 参照(description の <img src>)を持つ Placemark」を読めるだけ読む。画像が KMZ の外
// (http の URL など)にあるもの・位置が無いものは写真ではないとみなして飛ばす。
export async function parsePhotosKmz(buffer) {
  const entries = readZip(buffer);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const byLowerName = new Map(entries.map((e) => [e.name.toLowerCase(), e]));
  const kmlEntry = byName.get('doc.kml') || entries.find((e) => /\.kml$/i.test(e.name));
  if (!kmlEntry) throw new Error(t('photo.importNoKml'));
  const kmlText = new TextDecoder('utf-8').decode(await kmlEntry.read());
  const doc = new DOMParser().parseFromString(kmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error(t('photo.importInvalidKml'));
  // 画像の参照は KML の置き場所からの相対パス
  const baseDir = kmlEntry.name.includes('/') ? kmlEntry.name.slice(0, kmlEntry.name.lastIndexOf('/') + 1) : '';

  const photos = [];
  for (const pm of doc.getElementsByTagName('Placemark')) {
    const coordText = pm.getElementsByTagName('Point')[0]?.getElementsByTagName('coordinates')[0]?.textContent;
    if (!coordText) continue;
    const [lng, lat] = coordText.trim().split(/\s+/)[0].split(',').map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const desc = pm.getElementsByTagName('description')[0]?.textContent || '';
    const src = /<img[^>]+src\s*=\s*["']([^"']+)["']/i.exec(desc)?.[1];
    if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src)) continue;   // KMZ の外の画像は対象外
    let path = src.replace(/^\.\//, '');
    try { path = decodeURI(path); } catch { /* そのまま使う */ }
    const entry = byName.get(baseDir + path) || byName.get(path)
      || byLowerName.get((baseDir + path).toLowerCase()) || byLowerName.get(path.toLowerCase());
    if (!entry) continue;
    const ext = (path.split('.').pop() || '').toLowerCase();
    const type = IMAGE_TYPES[ext];
    if (!type) continue;
    const blob = new Blob([await entry.read()], { type });

    // 名前は Placemark 直下の <name>(Document の <name> を拾わないよう子要素から探す)
    const nameEl = [...pm.children].find((c) => c.localName === 'name');
    const whenText = pm.getElementsByTagName('when')[0]?.textContent;
    const ms = whenText ? Date.parse(whenText.trim()) : NaN;
    photos.push({
      name: nameEl?.textContent.trim() || '',
      timeMs: Number.isFinite(ms) ? ms : null,
      lat,
      lng,
      blob
    });
  }
  return photos;
}
