// アプリ設定のデフォルト値・共有定数。
// 変更可能な設定は localStorage に保存され、次回起動時はその値が優先される。
// (このファイルは defaults を提供するだけで、永続化は各モジュール側で行う)

// ===== localStorage キー(全モジュール共通) =====
export const MARKER_SETTINGS_KEY = 'minoh-hiking.marker-settings';
export const VERSION_STORAGE_KEY = 'minoh-hiking.tile-manifest-version';
export const MESSAGE_LOG_KEY = 'minoh-hiking.message-log';
export const STARTUP_UPDATE_CHECK_KEY = 'minoh-hiking.startup-update-check';

// ===== sessionStorage キー =====
// MapGPS から ?closure=true 付きで起動されたことをタブ単位で保持する。
// タブを閉じれば消えるため、直接アクセスでは通行止め編集機能は有効にならない。
export const CLOSURE_FLAG_KEY = 'minoh-hiking.closure-flag';

// アプリ更新(updateAppToLatest)による再読み込み直後であることを示すフラグ。
// 再読み込み前にセットし、再読み込み後の起動時チェックで同じ更新確認を
// 再表示しないために使う。SW の切替が未完了でも二重に confirm を出さない。
// sessionStorage なのでタブを閉じるまで有効(次回の本当の起動では再度確認する)。
export const APP_UPDATED_FLAG_KEY = 'minoh-hiking.app-updated';

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

// ===== メッセージ履歴 =====
export const MESSAGE_LOG_MAX = 100;

// 画面に表示するトースト(一時メッセージ)の表示秒数。
// 移動記録の開始・終了時などに表示し、この秒数で自動的に閉じる。
export const TOAST_DURATION_SEC = 3;

// マーカー設定の対象種別と既定値
export const MARKER_TYPES = [
  { key: 'emergency', label: '緊急ポイント', color: '#00AA00', shape: 'circle', size: 12 },
  { key: 'hikingRoute', label: 'ハイキングルート', color: '#007d00', shape: 'line', size: 3 },
  { key: 'routeGuide', label: 'ルート案内写真', color: '#2563EB', shape: 'square', size: 12 },
  { key: 'spot', label: 'スポット', color: '#1E90FF', shape: 'square', size: 10 },
  // 通行止め・通行困難地点(closures)。kind=closed / difficult に対応
  { key: 'closureClosed', label: '通行止め', color: '#DC2626', shape: 'x', size: 10 },
  { key: 'closureDifficult', label: '通行困難地点', color: '#F59E0B', shape: 'triangle', size: 16 },
  // トラック関連(表示順はトラックの上)。色はトラックと同じ既定値。
  { key: 'trackStart', label: 'トラック開始点', color: '#000080', shape: 'square', size: 12 },
  { key: 'trackCurrent', label: 'トラック現在地点', color: '#000080', shape: 'triangle', size:16 },
  { key: 'track', label: '移動記録', color: '#000080', shape: 'line', size: 4 },
  { key: 'photoLocation', label: '写真撮影場所', color: '#000080', shape: 'star', size: 12 }
];

// マーカー形状の選択肢(設定UIのドロップダウン)
export const MARKER_SHAPES = [
  { value: 'circle', label: '円' },
  { value: 'square', label: '四角' },
  { value: 'triangle', label: '三角' },
  { value: 'diamond', label: 'ひし形' },
  { value: 'star', label: '星' },
  { value: 'line', label: '線' },
  { value: 'x', label: '✖' }
];
