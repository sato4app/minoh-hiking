// アプリ設定のデフォルト値・共有定数。
// 変更可能な設定は localStorage に保存され、次回起動時はその値が優先される。
// (このファイルは defaults を提供するだけで、永続化は各モジュール側で行う)

// ===== localStorage キー(全モジュール共通) =====
export const MARKER_SETTINGS_KEY = 'minoh-hiking.marker-settings';
export const VERSION_STORAGE_KEY = 'minoh-hiking.tile-manifest-version';
export const MESSAGE_LOG_KEY = 'minoh-hiking.message-log';
export const STARTUP_UPDATE_CHECK_KEY = 'minoh-hiking.startup-update-check';
// 移動記録の実行中フラグ。記録開始で立て、停止操作で降ろす。
// 起動時に立ったまま残っていれば、前回は停止操作を経ずに終わった(アプリの
// 再読み込み・破棄・強制終了)ことになるため、その旨を履歴に残す手がかりに使う。
export const TRACK_RECORDING_FLAG_KEY = 'minoh-hiking.track-recording';
// 表示言語(「言語/Language」ドロップダウン)。'ja'(日本語・既定) / 'en'(English)。
// 読み書きと文言の切替は i18n.js(getLang/setLang/t/applyStaticTranslations)が担う。
export const LANGUAGE_KEY = 'minoh-hiking.language';
// 移動経路のGPX出力で使った連番。{ date: 'yyyymmdd', seq: n } の JSON で保存し、
// 同日の次回出力ではデフォルトの連番を +1 して提示する(日付が変われば 01 に戻る)。
export const TRACK_EXPORT_SEQ_KEY = 'minoh-hiking.track-export-seq';
// 「使い方」ガイドを一度でも開いたかどうか。初回起動時だけ自動で表示するために使う
// (2回目以降は起動画面の「使い方」ボタンから開く)。保存できない環境では
// 「開いた」扱いとし、起動のたびに自動表示されないようにする。
export const GUIDE_SEEN_KEY = 'minoh-hiking.guide-seen';

// ===== sessionStorage キー =====
// アプリ更新(updateAppToLatest)による再読み込み直後であることを示すフラグ。
// 再読み込み前にセットし、再読み込み後の起動時チェックで同じ更新確認を
// 再表示しないために使う。SW の切替が未完了でも二重に confirm を出さない。
// sessionStorage なのでタブを閉じるまで有効(次回の本当の起動では再度確認する)。
export const APP_UPDATED_FLAG_KEY = 'minoh-hiking.app-updated';

// 「言語の設定/Language Settings」の変更による再読み込み直後であることを示すフラグ。
// 言語切替はリロード方式のため、そのままでは起動画面に戻ってしまう。再読み込み前に
// セットし、起動時に読み取って設定モーダルを開き直す(読んだら即削除する)。
export const REOPEN_APP_SETTINGS_KEY = 'minoh-hiking.reopen-app-settings';

// ===== 公開API(Vercel Function + Blob) =====
// 地図データ(ポイント・ルート・スポット)と通行止め・通行困難地点は、外部の運用アプリ
// MapPublisher が公開したものを配信で受け取る。本アプリは表示専用のため GET のみ利用する。
// 契約は docs/publish-api-202609.md(契約バージョン 2.0)。
// 公開ストアは Vercel 側にあるため、GitHub Pages 版アプリからは Vercel 本番の
// 絶対 URL を参照して同じデータソースに一本化する(API 側で CORS 許可済み)。
// Vercel・ローカル(vercel dev)では同一オリジンの相対パスで良い。
const PUBLISH_API_ORIGIN = 'https://minoh-hiking.vercel.app';
const PUBLISH_API_BASE = location.hostname.endsWith('github.io')
  ? `${PUBLISH_API_ORIGIN}/api`
  : '/api';
// 起動時にまず読む version 一覧(数百バイト)。相違があるときだけ本体を取りに行く
export const PUBLISH_MANIFEST_URL = `${PUBLISH_API_BASE}/manifest`;
export const MAPDATA_API_URL = `${PUBLISH_API_BASE}/mapdata`;
export const CLOSURE_API_URL = `${PUBLISH_API_BASE}/closures`;
// オフライン地図のダウンロード対象タイル一覧。GeoJSON ではないが、取得・キャッシュ・
// version 判定は他の2つとまったく同じ仕組みに乗せる(published-data.js)
export const TILES_API_URL = `${PUBLISH_API_BASE}/tiles`;

// 公開データの保存先(Cache API)と、表示済み version の保存キー(localStorage)。
// キャッシュは Service Worker ではなくアプリ側(published-data.js)が管理する。
export const MAPDATA_CACHE = 'mapdata-cache';
export const CLOSURE_CACHE = 'closures-cache';
export const TILES_CACHE = 'tiles-cache';
export const MAPDATA_VERSION_KEY = 'minoh-hiking.mapdata-version';
export const CLOSURES_VERSION_KEY = 'minoh-hiking.closures-version';
// 配信で受け取ったタイル一覧の version。「ダウンロード済みの version」
// (VERSION_STORAGE_KEY)とは別物なので混同しないこと。
// - TILES_VERSION_KEY      … 配信元から受け取った最新の一覧の版
// - VERSION_STORAGE_KEY    … その端末が実際にタイルを保存したときの版
export const TILES_VERSION_KEY = 'minoh-hiking.tiles-version';

// ===== 地理院タイル =====
// タイルキャッシュ名は `gsi-{version}` 形式(version は公開API のタイル一覧から)。
// 旧 version のキャッシュは保持し、SW・アプリ双方で全 gsi-* を横断参照する。
export const TILE_CACHE_PREFIX = 'gsi-';
export const TILE_URL_BASE = 'https://cyberjapandata.gsi.go.jp/xyz/std';

// ===== ダウンロード制御 =====
export const CONCURRENCY = 4;      // タイル取得の同時実行数
export const MAX_RETRIES = 3;      // 取得失敗時のリトライ回数

// ===== ダウンロードサイズの概算 =====
// ズームレベル別の1タイルあたり平均サイズ(KB)。配信中のタイル一覧(version 2026.01・
// 全1405枚)へ HEAD を送り Content-Length を集計した実測値(2026-08-25)。
// 一律の平均値では大きく外れるため z 別に持つ: 低ズームは1枚に等高線・注記が詰まって
// 重く(z15=64.2KB)、z18 は軽い(6.1KB)。枚数の67%を占める z18 に平均が引きずられ、
// 一律12KB だと基本レイヤーのみの合計が実測 8.5MB に対し 5.4MB と4割近く過小になる。
// 配信範囲が変わると平均も動くため、範囲を拡張したときは実測し直すこと。
export const TILE_AVG_KB_BY_Z = {
  14: 53.9,
  15: 64.2,
  16: 24.8,
  17: 13.1,
  18: 6.1
};
// 上表に無いズームレベル用のフォールバック(全1405枚の実測平均)
export const TILE_AVG_KB_FALLBACK = 10.3;

// ===== アプリ更新制御(update.js) =====
// アプリの更新版(アプリシェル一式)のダウンロード完了を待つ上限(ミリ秒)。
// ダウンロード中は全画面オーバーレイで操作を受け付けないため、通信が極端に遅い・
// 途切れた場合に待ち続けないよう上限を設ける(超えたら待たずに再読み込みする。
// 未取得分はオンライン時に自動で取得される)。
export const APP_UPDATE_DOWNLOAD_TIMEOUT_MS = 90000;
// 更新要求後に新しい Service Worker(ダウンロードの実行役)が現れるのを待つ上限。
export const APP_UPDATE_WORKER_WAIT_MS = 5000;

// ===== メッセージ履歴 =====
export const MESSAGE_LOG_MAX = 100;

// 画面に表示するトースト(一時メッセージ)の表示秒数。
// 移動記録の開始・終了時などに表示し、この秒数で自動的に閉じる。
export const TOAST_DURATION_SEC = 3;

// マーカー設定の対象種別と既定値。
// 表示名は i18n.js の辞書で管理する(キーは markerType.<key> で導出)。
export const MARKER_TYPES = [
  { key: 'emergency', color: '#00AA00', shape: 'circle', size: 12 },      // 緊急ポイント
  { key: 'hikingRoute', color: '#007d00', shape: 'line', size: 3 },       // ハイキングルート
  { key: 'spot', color: '#1E90FF', shape: 'square', size: 10 },           // スポット
  // 通行止め・通行困難地点(closures)。kind=closed / difficult に対応
  { key: 'closureClosed', color: '#DC2626', shape: 'x', size: 10 },
  { key: 'closureDifficult', color: '#F59E0B', shape: 'triangle', size: 16 },
  // 移動記録関連(表示順は移動記録経路の上)。色は移動記録経路と同じ既定値。
  { key: 'trackStart', color: '#000080', shape: 'square', size: 12 },     // 移動記録開始点
  { key: 'trackCurrent', color: '#000080', shape: 'triangle', size: 16 }, // 移動記録現在地点
  { key: 'track', color: '#000080', shape: 'line', size: 4 }              // 移動記録経路
];

// マーカー形状の選択肢(設定UIのドロップダウン)。
// 表示名は i18n.js の辞書で管理する(キーは markerShape.<value> で導出)。
export const MARKER_SHAPES = ['circle', 'square', 'triangle', 'diamond', 'star', 'line', 'x'];
