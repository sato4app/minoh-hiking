// IndexedDB ラッパー
// tileCachePackages ストアにダウンロード履歴を保存する。

const DB_NAME = 'minoh-hiking';
const DB_VERSION = 1;
const STORE = 'tileCachePackages';

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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// STORE への操作を1トランザクションで実行する共通ヘルパー。
// op でリクエストを返すと、トランザクション完了時にその結果で解決する。
async function withStore(mode, op) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = op(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
}

// パッケージ情報を保存(同じpackageIdなら上書き)
export function savePackage(record) {
  return withStore('readwrite', (store) => store.put(record));
}

// 全パッケージを返す
export async function listPackages() {
  return (await withStore('readonly', (store) => store.getAll())) || [];
}

// 全パッケージを削除
export function clearPackages() {
  return withStore('readwrite', (store) => store.clear());
}

// 指定 packageId のパッケージを削除
export function deletePackage(packageId) {
  return withStore('readwrite', (store) => store.delete(packageId));
}
