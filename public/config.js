// アプリ設定の既定値・共有定数。永続化(localStorage)は各モジュール側で行う。

// ===== localStorage キー(全モジュール共通) =====
export const MARKER_SETTINGS_KEY = 'minoh-hiking.marker-settings';
// マーカー設定の保存値に、既定値の変更に合わせた置き換えをどこまで行ったか(整数。無ければ 0)。
// 置き換えは各段階1回だけ行う(marker-settings.js の migrateMarkerSettings)
export const MARKER_SETTINGS_REV_KEY = 'minoh-hiking.marker-settings-rev';
export const VERSION_STORAGE_KEY = 'minoh-hiking.tile-manifest-version';
export const MESSAGE_LOG_KEY = 'minoh-hiking.message-log';
// 移動記録の実行中フラグ。記録開始で立て、停止操作で降ろす。起動時に立ったまま残っていれば、
// 前回は停止操作を経ずに終わった(再読み込み・破棄・強制終了)ため、その旨を履歴に残す。
export const TRACK_RECORDING_FLAG_KEY = 'minoh-hiking.track-recording';
// 表示言語。'ja'(日本語・既定) / 'en'(English)。読み書きは i18n.js が担う。
export const LANGUAGE_KEY = 'minoh-hiking.language';
// 移動経路のGPX出力で使った連番。{ date: 'yyyymmdd', seq: n } の JSON(同日の次回は +1 を提示)。
export const TRACK_EXPORT_SEQ_KEY = 'minoh-hiking.track-export-seq';
// 「使い方」ガイドを一度でも開いたかどうか(初回起動時だけ自動表示するために使う)。
// ガイドの内容を変えても、キー名は変えないこと(変えると、アプリを更新した全端末で
// 再び自動表示される。自動表示は初回の1度だけで、更新では出さない決まり)。
export const GUIDE_SEEN_KEY = 'minoh-hiking.guide-seen';
// マップのメニュー(表示設定パネル)のトグルの状態。{ <トグルの id>: true/false } の JSON。
// 保存が無い・読めないトグルは HTML の初期値で始める。
export const MAP_TOGGLES_KEY = 'minoh-hiking.map-toggles';

// ===== sessionStorage キー =====
// アプリ更新による再読み込み直後であることを示すフラグ。SW の切替が未完了で版が不一致に
// 見えても、再読み込み後の最初の更新確認で同じ confirm を二重に出さないために使う。
export const APP_UPDATED_FLAG_KEY = 'minoh-hiking.app-updated';

// 言語の変更による再読み込み直後であることを示すフラグ。そのままでは起動画面に戻って
// しまうため、起動時に読み取って情報・言語モーダルを開き直す(読んだら即削除する)。
export const REOPEN_APP_SETTINGS_KEY = 'minoh-hiking.reopen-app-settings';

// ===== 公開API(Vercel Function + Blob) =====
// 地図データと通行止めは、外部の運用アプリ MapPublisher が公開したものを受け取る(GET のみ)。
// 仕様は docs/publish-api-202609.md。公開ストアは Vercel 側にあるため、GitHub Pages 版からは
// Vercel 本番の絶対 URL を参照する(API 側で CORS 許可済み)。
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

// 公開データの保存先(Cache API。SW ではなく published-data.js が管理)と、表示済み version のキー。
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
// タイルキャッシュ名は `gsi-{version}`。旧 version のキャッシュも保持し、全 gsi-* を横断参照する。
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
// アプリの更新版のダウンロード完了を待つ上限(ミリ秒)。待つ間は全画面オーバーレイで操作を
// 受け付けないため、通信が途切れても待ち続けないよう上限を設ける(超えたら再読み込みする)。
export const APP_UPDATE_DOWNLOAD_TIMEOUT_MS = 90000;
// 更新要求後に新しい Service Worker(ダウンロードの実行役)が現れるのを待つ上限。
export const APP_UPDATE_WORKER_WAIT_MS = 5000;

// 「詳細地図データ(Z=18)を含む」トグルを出して、Z=18 もダウンロードできるようにするか。
// false の間はダウンロード対象を Z=14〜17 に限り、トグルを非表示にする。
// 公開側(タイル一覧の z18_optional)はそのまま配信しているので、true に戻すだけで復活できる。
export const DOWNLOAD_DETAIL_ENABLED = false;

// ===== メッセージ履歴 =====
export const MESSAGE_LOG_MAX = 100;

// トースト(一時メッセージ)の表示秒数
export const TOAST_DURATION_SEC = 3;

// マーカー設定の対象種別と既定値。
// 表示名は i18n.js の辞書で管理する(キーは markerType.<key> で導出)。
// locked: 設定UIで変更不可とする属性(常に既定値を使用)。
//   note は設定画面のラベルに付ける注記番号((*1) / (*2))で、注記の本文は
//   i18n.js の markerSettings.noteText<番号> で管理する。
export const MARKER_TYPES = [
  { key: 'emergency', color: '#00AA00', shape: 'circle', size: 16 },      // 緊急ポイント
  { key: 'hikingRoute', color: '#007d00', shape: 'line', size: 4,         // ハイキングルート
    locked: ['shape'], note: 2 },
  { key: 'spot', color: '#1E90FF', shape: 'square', size: 14 },           // スポット
  // 通行止め・通行困難地点(closures)。kind=closed / difficult に対応
  // 通行止め=赤の輪と斜線に歩く人(歩行者通行止め風)、通行困難=警戒(黄色のひし形に黒の「!」)
  { key: 'closureClosed', color: '#DC2626', shape: 'noThoroughfare', size: 20,
    locked: ['color', 'shape'], note: 1 },
  { key: 'closureDifficult', color: '#FACC15', shape: 'warning', size: 20,
    locked: ['color', 'shape'], note: 1 },
  // 移動記録関連(表示順は移動記録経路の上)。色は移動記録経路と同じ既定値。
  { key: 'trackStart', color: '#000080', shape: 'square', size: 16 },     // 移動記録開始点
  { key: 'trackCurrent', color: '#000080', shape: 'triangle', size: 20 }, // 移動記録現在地点
  { key: 'track', color: '#000080', shape: 'line', size: 5,               // 移動記録経路
    locked: ['shape'], note: 2 }
];

// マーカー形状の選択肢(設定UIのドロップダウン)。
// 表示名は i18n.js の辞書で管理する(キーは markerShape.<value> で導出)。
// 形状を変更できない種別だけが使う形状(line / noThoroughfare / warning)は選択肢に含めない。
export const MARKER_SHAPES = ['circle', 'square', 'triangle', 'diamond', 'star'];

// 設定UIのドロップダウンを開いたときに、名称の前に付ける記号(例: ● 円)。
// 閉じた状態の形状欄は記号ではなく SVG の見本を表示する(marker-settings.js)
export const MARKER_SHAPE_SYMBOLS = {
  circle: '●',
  square: '■',
  triangle: '▲',
  diamond: '◆',
  star: '★'
};
