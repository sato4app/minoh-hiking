// アプリ設定のデフォルト値。
// 変更可能な設定は localStorage に保存され、次回起動時はその値が優先される。
// (このファイルは defaults を提供するだけで、永続化は app.js 側で行う)

// localStorage キー
export const MARKER_SETTINGS_KEY = 'minoh-hiking.marker-settings';

// マーカー設定の対象種別と既定値
export const MARKER_TYPES = [
  { key: 'emergency',     label: '緊急ポイント',    color: '#dc2626', shape: 'circle', size: 10 },
  { key: 'hikingRoute',   label: 'ハイキングルート', color: '#ea580c', shape: 'line',   size: 3 },
  { key: 'routeGuide',    label: 'ルート案内写真',   color: '#2563eb', shape: 'square', size: 10 },
  { key: 'spot',          label: 'スポット',        color: '#0ea5e9', shape: 'circle', size: 8 },
  { key: 'track',         label: 'トラック',        color: '#10b981', shape: 'line',   size: 2 },
  { key: 'photoLocation', label: '写真撮影場所',     color: '#a855f7', shape: 'star',   size: 10 }
];

// マーカー形状の選択肢(設定UIのドロップダウン)
export const MARKER_SHAPES = [
  { value: 'circle',   label: '円' },
  { value: 'square',   label: '四角' },
  { value: 'triangle', label: '三角' },
  { value: 'diamond',  label: 'ひし形' },
  { value: 'star',     label: '星' },
  { value: 'line',     label: '線' }
];
