// アプリ設定のデフォルト値・共有定数。
// 変更可能な設定は localStorage に保存され、次回起動時はその値が優先される。
// (このファイルは defaults を提供するだけで、永続化は各モジュール側で行う)

// ===== localStorage キー(全モジュール共通) =====
export const MARKER_SETTINGS_KEY = 'minoh-hiking.marker-settings';
export const VERSION_STORAGE_KEY = 'minoh-hiking.tile-manifest-version';
export const MESSAGE_LOG_KEY = 'minoh-hiking.message-log';
export const STARTUP_UPDATE_CHECK_KEY = 'minoh-hiking.startup-update-check';

// ===== データファイルURL =====
export const MANIFEST_URL = 'data/tile_manifest.json';
export const EMERGENCY_URL = 'data/minoh-emergency-points.geojson';
export const HIKING_ROUTES_URL = 'data/minoh-hiking-routes-spots.geojson';

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
  { key: 'routeGuide', label: 'ルート案内写真', color: '#2563EB', shape: 'square', size: 6 },
  { key: 'spot', label: 'スポット', color: '#1E90FF', shape: 'circle', size: 8 },
  // トラック関連(表示順はトラックの上)。色はトラックと同じ既定値。
  { key: 'trackStart', label: 'トラック開始点', color: '#000080', shape: 'square', size: 12 },
  { key: 'trackCurrent', label: 'トラック現在地点', color: '#000080', shape: 'triangle', size:16 },
  { key: 'track', label: 'トラック', color: '#000080', shape: 'line', size: 4 },
  { key: 'photoLocation', label: '写真撮影場所', color: '#000080', shape: 'star', size: 6 }
];

// マーカー形状の選択肢(設定UIのドロップダウン)
export const MARKER_SHAPES = [
  { value: 'circle', label: '円' },
  { value: 'square', label: '四角' },
  { value: 'triangle', label: '三角' },
  { value: 'diamond', label: 'ひし形' },
  { value: 'star', label: '星' },
  { value: 'line', label: '線' }
];
