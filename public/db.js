// IndexedDB ラッパー
// - tileCachePackages ストア: 地図データのダウンロード履歴
// - tracks ストア: 移動経路(最新の1件のみ。id='latest' で上書き保存する)
//
// tracks を IndexedDB に置くのは、記録した移動経路が再読み込み・アプリ終了で
// 失われないようにするため。localStorage ではなく IndexedDB なのは、
// 数千点の座標列を扱うため容量(localStorage は概ね 5MB)と、文字列化を
// 挟まない点で有利だからである。

const DB_NAME = 'minoh-hiking';
// 2: tracks ストアを追加
const DB_VERSION = 2;
const STORE = 'tileCachePackages';
const TRACK_STORE = 'tracks';
// 移動経路は最新の1件だけを保持する(同じキーへ上書きしていく)
const LATEST_TRACK_ID = 'latest';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'packageId' });
        store.createIndex('layerKey', 'layerKey', { unique: false });
        store.createIndex('downloadedAt', 'downloadedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(TRACK_STORE)) {
        db.createObjectStore(TRACK_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
    // 別のタブが旧バージョンで開いたままだと、版上げがここで止まる。
    // 待ち続けると呼び出し側が返ってこないため、失敗として返す
    // (呼び出し側は保存・復元を諦めるだけで、アプリ自体は動き続ける)。
    req.onblocked = () => { dbPromise = null; reject(new Error('IndexedDB upgrade blocked')); };
  });
  return dbPromise;
}

// 指定ストアへの操作を1トランザクションで実行する共通ヘルパー。
// op でリクエストを返すと、トランザクション完了時にその結果で解決する。
async function withStore(storeName, mode, op) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = op(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
}

// パッケージ情報を保存(同じpackageIdなら上書き)
export function savePackage(record) {
  return withStore(STORE, 'readwrite', (store) => store.put(record));
}

// 全パッケージを返す
export async function listPackages() {
  return (await withStore(STORE, 'readonly', (store) => store.getAll())) || [];
}

// 全パッケージを削除
export function clearPackages() {
  return withStore(STORE, 'readwrite', (store) => store.clear());
}

// 指定 packageId のパッケージを削除
export function deletePackage(packageId) {
  return withStore(STORE, 'readwrite', (store) => store.delete(packageId));
}

// ===== 移動経路(最新の1件) =====
// segments は経路ごとの点列({lat, lng, timeMs})の配列。
// 保存のたびに同じキーへ上書きするため、端末に残るのは常に最新の内容だけになる。

export function saveLatestTrack(segments) {
  return withStore(TRACK_STORE, 'readwrite', (store) => store.put({
    id: LATEST_TRACK_ID,
    savedAt: Date.now(),
    segments
  }));
}

// 保存済みの移動経路を返す(無ければ空配列)
export async function loadLatestTrack() {
  const record = await withStore(TRACK_STORE, 'readonly', (store) => store.get(LATEST_TRACK_ID));
  return Array.isArray(record?.segments) ? record.segments : [];
}

// 保存済みの移動経路を削除する(「移動経路をクリア」に合わせて呼ぶ)
export function clearLatestTrack() {
  return withStore(TRACK_STORE, 'readwrite', (store) => store.delete(LATEST_TRACK_ID));
}
