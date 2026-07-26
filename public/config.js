// アプリ設定のデフォルト値・共有定数。
// 変更可能な設定は localStorage に保存され、次回起動時はその値が優先される。
// (このファイルは defaults を提供するだけで、永続化は各モジュール側で行う)

// ===== localStorage キー(全モジュール共通) =====
export const MARKER_SETTINGS_KEY = 'minoh-hiking.marker-settings';
export const VERSION_STORAGE_KEY = 'minoh-hiking.tile-manifest-version';
export const MESSAGE_LOG_KEY = 'minoh-hiking.message-log';
export const STARTUP_UPDATE_CHECK_KEY = 'minoh-hiking.startup-update-check';
// 表示言語(「言語/Language」ドロップダウン)。'ja'(日本語・既定) / 'en'(English)。
// 読み書きと文言の切替は i18n.js(getLang/setLang/t/applyStaticTranslations)が担う。
export const LANGUAGE_KEY = 'minoh-hiking.language';
// 移動経路のGPX出力で使った連番。{ date: 'yyyymmdd', seq: n } の JSON で保存し、
// 同日の次回出力ではデフォルトの連番を +1 して提示する(日付が変われば 01 に戻る)。
export const TRACK_EXPORT_SEQ_KEY = 'minoh-hiking.track-export-seq';

// ===== sessionStorage キー =====
// MapGPS から ?closure=true 付きで起動されたことをタブ単位で保持する。
// タブを閉じれば消えるため、直接アクセスでは通行止め編集機能は有効にならない。
export const CLOSURE_FLAG_KEY = 'minoh-hiking.closure-flag';

// アプリ更新(updateAppToLatest)による再読み込み直後であることを示すフラグ。
// 再読み込み前にセットし、再読み込み後の起動時チェックで同じ更新確認を
// 再表示しないために使う。SW の切替が未完了でも二重に confirm を出さない。
// sessionStorage なのでタブを閉じるまで有効(次回の本当の起動では再度確認する)。
export const APP_UPDATED_FLAG_KEY = 'minoh-hiking.app-updated';

// 「言語の設定/Language Settings」の変更による再読み込み直後であることを示すフラグ。
// 言語切替はリロード方式のため、そのままでは起動画面に戻ってしまう。再読み込み前に
// セットし、起動時に読み取って設定モーダルを開き直す(読んだら即削除する)。
export const REOPEN_APP_SETTINGS_KEY = 'minoh-hiking.reopen-app-settings';

// 「マップに反映」で適用した通行止め・通行困難地点データ(geojson の JSON 文字列)。
// 保存があれば公開API の配信内容より優先して読み込む(この端末のみに反映される)。
export const CLOSURE_DATA_KEY = 'minoh-hiking.closure-data';

// 「公開」ボタンで使う公開トークン(運用担当者が初回に入力し、その端末にのみ保存)。
// コードには埋め込まない。認証失敗(401)時は削除して再入力を促す。
export const CLOSURE_TOKEN_KEY = 'minoh-hiking.closure-publish-token';

// ===== データファイルURL =====
export const MANIFEST_URL = 'data/tile_manifest.json';
export const EMERGENCY_URL = 'data/minoh-emergency-points.geojson';
export const HIKING_ROUTES_URL = 'data/minoh-hiking-routes-spots.geojson';
// 通行止め・通行困難地点のファイル名(公開失敗時のバックアップ保存で使用。
// Blob 上の配信ファイル名と同じにそろえる)
export const CLOSURE_FILE_NAME = 'minoh-hiking-closure.geojson';

// 通行止め・通行困難地点の公開API(Vercel Function + Blob)。
// 公開ストアは Vercel 側にあるため、GitHub Pages 版アプリからは Vercel 本番の
// 絶対 URL を参照して同じデータソースに一本化する(API 側で CORS 許可済み)。
// Vercel・ローカル(vercel dev)では同一オリジンの相対パスで良い。
const CLOSURE_API_ORIGIN = 'https://minoh-hiking.vercel.app';
export const CLOSURE_API_URL = location.hostname.endsWith('github.io')
  ? `${CLOSURE_API_ORIGIN}/api/closures`
  : '/api/closures';

// ===== 地理院タイル =====
// タイルキャッシュ名は `gsi-{version}` 形式(version は tile_manifest.json から)。
// 旧 version のキャッシュは保持し、SW・アプリ双方で全 gsi-* を横断参照する。
export const TILE_CACHE_PREFIX = 'gsi-';
export const TILE_URL_BASE = 'https://cyberjapandata.gsi.go.jp/xyz/std';

// ===== ダウンロード制御 =====
export const CONCURRENCY = 4;      // タイル取得の同時実行数
export const MAX_RETRIES = 3;      // 取得失敗時のリトライ回数
export const AVG_TILE_KB = 12;     // 実測不能時のサイズ推定用(平均タイルサイズ)

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
