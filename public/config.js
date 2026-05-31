// アプリ設定のデフォルト値。
// 変更可能な設定は localStorage に保存され、次回起動時はその値が優先される。
// (このファイルは defaults を提供するだけで、永続化は app.js 側で行う)

// localStorage キー
export const MARKER_SETTINGS_KEY = 'minoh-hiking.marker-settings';

// 画面に表示するトースト(一時メッセージ)の表示秒数。
// 移動記録の開始・終了時などに表示し、この秒数で自動的に閉じる。
export const TOAST_DURATION_SEC = 3;

// マーカー設定の対象種別と既定値
export const MARKER_TYPES = [
  { key: 'emergency', label: '緊急ポイント', color: '#00AA00', shape: 'circle', size: 12 },
  { key: 'hikingRoute', label: 'ハイキングルート', color: '#007d00', shape: 'line', size: 3 },
  { key: 'routeGuide', label: 'ルート案内写真', color: '#2563EB', shape: 'square', size: 6 },
  { key: 'spot', label: 'スポット', color: '#1E90FF', shape: 'circle', size: 8 },
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
