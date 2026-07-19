// 表示言語(i18n)モジュール
// 「言語/Language」ドロップダウン(ja=日本語・既定 / en=English)に応じて
// UI文言を切り替える。言語の変更はリロード方式(保存 → location.reload())のため、
// 現在言語はモジュール読込時に1回だけ確定する。
//
// - 静的なHTML文言: index.html の data-i18n / data-i18n-aria / data-i18n-title
//   属性に翻訳キーを書き、起動時に applyStaticTranslations() で一括置換する。
//   日本語(既定)のときは何もしない(HTML の日本語がそのまま表示される)。
// - 動的なJS文言(トースト・confirm・alert 等): 生成箇所で t(key, params) を呼ぶ。
// - 変数埋め込みは {name} 形式(日英で語順が変わるため文字列連結はしない)。
// - 地図データ(geojson のポイント名・スポット名等)は翻訳対象外(日本語のまま)。

import { LANGUAGE_KEY } from './config.js';

// 現在言語の読取。'en' 以外はすべて 'ja' に正規化する
export function getLang() {
  try { return localStorage.getItem(LANGUAGE_KEY) === 'en' ? 'en' : 'ja'; } catch { return 'ja'; }
}

// 言語の保存(切替の反映は呼び出し側で location.reload() する)
export function setLang(lang) {
  try { localStorage.setItem(LANGUAGE_KEY, lang); } catch { /* noop */ }
}

// リロード方式のためセッション中は不変。モジュール読込時に1回だけ確定する
const lang = getLang();

// ===== 翻訳辞書 =====
// キー命名: <画面/モジュール>.<意味> の2階層。値は { ja, en }。
// markerType.* / markerShape.* は config.js の MARKER_TYPES の key /
// MARKER_SHAPES の value と一致させる(規約で導出するため)。
const DICT = {
  // ----- 共通 -----
  'app.title': { ja: '箕面ハイキング', en: 'Minoh Hiking' },
  'common.close': { ja: '閉じる', en: 'Close' },
  'common.cancel': { ja: 'キャンセル', en: 'Cancel' },
  'common.clear': { ja: 'クリア', en: 'Clear' },
  'common.unknown': { ja: '不明', en: 'Unknown' },

  // ----- ホーム画面 -----
  'home.ariaMainMenu': { ja: 'メインメニュー', en: 'Main menu' },
  'home.showMap': { ja: 'ハイキングマップ表示', en: 'Show Hiking Map' },
  'home.download': { ja: '地図のダウンロード（オフライン用）', en: 'Download Maps (Offline)' },
  'home.versionInfo': { ja: 'バージョン情報等', en: 'Version & Info' },

  // ----- マップ画面 -----
  'map.ariaMap': { ja: '箕面エリア地理院地図', en: 'GSI map of the Minoh area' },
  'map.ariaLayers': { ja: '表示設定', en: 'Display settings' },
  'map.toggleCurrentMarker': { ja: '現在地点をマーカー表示', en: 'Show current location marker' },
  'map.toggleCenterCurrent': { ja: '現在地点は中央に表示', en: 'Keep current location centered' },
  'map.toggleTrackRecording': { ja: '移動経路を記録', en: 'Record track' },
  'map.backToHome': { ja: '起動時の画面に戻る', en: 'Back to start screen' },

  // ----- ナビ画面 -----
  'nav.ariaBack': { ja: 'ホームに戻る', en: 'Back to home' },
  'nav.ariaMenu': { ja: 'ナビメニュー', en: 'Navigation menu' },
  'nav.pending': { ja: 'この機能は準備中です。', en: 'This feature is under preparation.' },

  // ----- 移動記録 -----
  'track.start': { ja: '記録開始', en: 'Start recording' },
  'track.stop': { ja: '記録停止', en: 'Stop recording' },
  'track.photo': { ja: '写真撮影', en: 'Take photo' },
  'track.statsBtn': { ja: 'サイズ', en: 'Size' },
  'track.summary': {
    ja: '記録地点 {points} 点 / 写真 {photos} 枚 / 移動距離 {km} km',
    en: 'Points {points} / Photos {photos} / Distance {km} km'
  },
  'track.started': { ja: '移動記録を開始しました', en: 'Track recording started' },
  'track.finished': { ja: '移動記録を終了しました({summary})', en: 'Track recording finished ({summary})' },
  'track.nothingToClear': { ja: 'クリアする移動経路がありません', en: 'No recorded track to clear' },
  'track.clearConfirm': { ja: '記録した移動経路をクリアします。よろしいですか?', en: 'Clear the recorded track?' },
  'track.cleared': { ja: '移動経路をクリアしました', en: 'Track cleared' },

  // ----- 位置情報 -----
  'geo.notSupported': { ja: 'この端末は位置情報に対応していません', en: 'This device does not support geolocation' },
  'geo.fetchFailed': { ja: '位置情報の取得に失敗: {message}', en: 'Failed to get location: {message}' },

  // ----- 更新バナー -----
  'banner.tilesUpdated': {
    ja: 'タイル情報が更新されました({version})。新しい範囲のオフライン地図をダウンロードできます。',
    en: 'Map tile data has been updated ({version}). You can download offline maps for the new area.'
  },
  'banner.updateDiff': { ja: '差分のみ更新', en: 'Update changes only' },
  'banner.updateAll': { ja: 'すべて更新', en: 'Update all' },
  'banner.later': { ja: '後で', en: 'Later' },
  'banner.ariaClose': { ja: 'バナーを閉じる', en: 'Close banner' },

  // ----- 地図のダウンロード(モーダル + tiles.js) -----
  'download.savedVersion': { ja: 'ダウンロード済み地図バージョン:', en: 'Downloaded map version:' },
  'download.fileSize': { ja: 'ファイルサイズ(MB):', en: 'File size (MB):' },
  'download.includeDetail': { ja: '詳細地図(z=18)を含む', en: 'Include detailed map (z=18)' },
  'download.startBtn': { ja: 'ダウンロード', en: 'Download' },
  'download.manifestLoadFailed': { ja: 'マニフェスト読込失敗: {message}', en: 'Failed to load manifest: {message}' },
  'download.noLayers': { ja: 'マニフェストにレイヤー情報がありません', en: 'The manifest has no layer information' },
  'download.noTargets': { ja: 'ダウンロード対象がありません', en: 'Nothing to download' },
  'download.started': { ja: 'ダウンロード開始: {n} タイル', en: 'Download started: {n} tiles' },
  'download.progress': { ja: 'ダウンロード中... {completed} / {total}', en: 'Downloading... {completed} / {total}' },
  'download.abortedStatus': {
    ja: '中断しました({completed}/{total} 完了, 失敗 {failed})',
    en: 'Interrupted ({completed}/{total} done, {failed} failed)'
  },
  'download.abortedLog': {
    ja: '地図のダウンロードを中断しました({completed}/{total})',
    en: 'Map download interrupted ({completed}/{total})'
  },
  'download.doneWithFailures': { ja: '完了(失敗 {failed} 件あり)', en: 'Finished ({failed} failed)' },
  'download.doneWithFailuresLog': {
    ja: '地図のダウンロード完了(失敗 {failed} 件あり)',
    en: 'Map download finished ({failed} failed)'
  },
  'download.done': { ja: 'ダウンロード完了', en: 'Download finished' },
  'download.doneLog': { ja: '地図のダウンロードが完了しました', en: 'Map download completed' },
  'download.cacheReadFailed': { ja: 'キャッシュ参照失敗: {message}', en: 'Failed to read cache: {message}' },
  'download.upToDate': {
    ja: '追加でダウンロードするタイルはありません。バージョンを更新しました',
    en: 'No additional tiles to download. Version updated'
  },
  'download.upToDateLog': { ja: '地図は最新の状態です(バージョンを更新)', en: 'Map is up to date (version updated)' },
  // 差分/全部更新の呼び名({label} に埋め込むため、英語は文中で自然な小文字)
  'download.diffLabel': { ja: '差分更新', en: 'differential update' },
  'download.allLabel': { ja: '全部更新', en: 'full update' },
  'download.updateStarted': { ja: '{label}開始: {n} タイル', en: 'Starting {label}: {n} tiles' },
  'download.updateAbortedLog': {
    ja: '地図の{label}を中断しました({completed}/{total})',
    en: 'Map {label} interrupted ({completed}/{total})'
  },
  'download.updateDoneWithFailures': { ja: '{label}完了(失敗 {failed} 件あり)', en: 'Finished {label} ({failed} failed)' },
  'download.updateDoneWithFailuresLog': {
    ja: '地図の{label}完了(失敗 {failed} 件あり)',
    en: 'Finished map {label} ({failed} failed)'
  },
  'download.updateDone': { ja: '{label}が完了しました', en: 'Finished {label}' },
  'download.updateDoneLog': { ja: '地図の{label}が完了しました', en: 'Finished map {label}' },
  'download.noVersion': {
    ja: 'マニフェストの version が不明なため開始できません',
    en: 'Cannot start: manifest version is unknown'
  },
  'download.offlineWarning': {
    ja: 'ネットワーク切断: ダウンロードが失敗する可能性があります',
    en: 'Network disconnected: the download may fail'
  },
  'download.cannotClearWhileDownloading': { ja: 'ダウンロード中は削除できません', en: 'Cannot clear while downloading' },
  'download.clearConfirm': { ja: 'キャッシュ済みのタイルを全て削除します。よろしいですか?', en: 'Delete all cached tiles?' },
  'download.cleared': { ja: 'キャッシュを削除しました', en: 'Cache cleared' },
  'download.clearFailed': { ja: '削除失敗: {message}', en: 'Failed to delete: {message}' },
  'download.lowStorage': { ja: 'ストレージ残量が少なくなっています', en: 'Storage space is running low' },

  // ----- バージョン情報等モーダル -----
  'info.showClock': { ja: '時刻を表示', en: 'Show clock' },
  'info.startupUpdateCheck': { ja: '起動時にアプリの更新版を確認', en: 'Check for app updates at startup' },
  'info.versionInfo': { ja: 'バージョン情報', en: 'Version information' },
  'info.mapVersion': { ja: '地図バージョン：', en: 'Map version:' },
  'info.mapVersionNote': { ja: '（ダウンロード対象とする地図タイルの指定）', en: '(Map tiles targeted for download)' },
  'info.appVersion': { ja: 'アプリバージョン：', en: 'App version:' },
  'info.appVersionNote': { ja: '（ハイキングルート等を含む）', en: '(Includes hiking routes, etc.)' },
  'info.closuresVersion': { ja: '通行止め・通行困難地点：', en: 'Closed & difficult points:' },
  'info.ariaDataCounts': { ja: 'データ件数', en: 'Data counts' },
  'info.countPoints': { ja: 'ポイント', en: 'Points' },
  'info.countRoutes': { ja: 'ルート', en: 'Routes' },
  'info.countSpots': { ja: 'スポット', en: 'Spots' },
  'info.countClosures': { ja: '通行止め', en: 'Closures' },
  'info.showMessages': { ja: 'メッセージ履歴の表示', en: 'Show message history' },
  'info.ariaClearMessages': { ja: '履歴を消去', en: 'Clear history' },
  'info.noMessages': { ja: '履歴はありません。', en: 'No messages.' },
  'info.about': { ja: 'このアプリについて', en: 'About this app' },
  'info.appName': { ja: 'アプリ名:', en: 'App name:' },
  'info.appNameValue': { ja: '箕面ハイキングマップ', en: 'Minoh Hiking Map' },
  'info.contributorsValue': { ja: '仕様検討中', en: 'TBD' },
  'messages.clearConfirm': { ja: 'メッセージ履歴を全て削除します。よろしいですか?', en: 'Delete all message history?' },
  'startup.versionCheck': {
    ja: '起動時のバージョン確認: 地図 {map} / アプリ {app}',
    en: 'Startup version check: map {map} / app {app}'
  },

  // ----- アプリ・地図タイルの更新確認(update.js) -----
  'update.appConfirm': {
    ja: '新しいバージョンのアプリが利用可能です。\n現在: {cached}\n最新: {latest}\n\n' +
        'アプリを再読み込みして、最新の状態に更新しますか？\n' +
        'アプリには更新された、ハイキングルートを含みます。\n' +
        'ダウンロードした地図タイルは更新されません。',
    en: 'A new version of the app is available.\nCurrent: {cached}\nLatest: {latest}\n\n' +
        'Reload the app to update to the latest version?\n' +
        'The update includes revised hiking routes.\n' +
        'Downloaded map tiles will not be affected.'
  },
  'update.mapTilesNotice': {
    ja: 'ダウンロード対象の地図タイルが拡張されました。\n現在: {saved}\n最新: {latest}\n\n' +
        '地図のダウンロードから、ダウンロードしてください。\n' +
        'サイズは合計20MB弱で、既存分があれば差分のみです。',
    en: 'The map tiles available for download have been expanded.\nCurrent: {saved}\nLatest: {latest}\n\n' +
        'Please download them from "Download Maps (Offline)".\n' +
        'The total size is under 20 MB; if you already have tiles, only the difference is downloaded.'
  },

  // ----- マーカーの設定 -----
  'markerSettings.title': { ja: 'マーカーの設定', en: 'Marker Settings' },
  'markerSettings.reset': { ja: '規定値に戻す', en: 'Reset to defaults' },
  'markerSettings.resetConfirm': {
    ja: 'マーカーの設定を規定値に戻します。よろしいですか?',
    en: 'Reset marker settings to defaults?'
  },
  'markerSettings.ariaColor': { ja: '{name} 色', en: '{name} color' },
  'markerSettings.ariaShape': { ja: '{name} 形状', en: '{name} shape' },
  'markerSettings.ariaSize': { ja: '{name} サイズ', en: '{name} size' },

  // マーカー種別(config.js の MARKER_TYPES の key と一致)
  'markerType.emergency': { ja: '緊急ポイント', en: 'Emergency point' },
  'markerType.hikingRoute': { ja: 'ハイキングルート', en: 'Hiking route' },
  'markerType.routeGuide': { ja: 'ルート案内写真', en: 'Route guide photo' },
  'markerType.spot': { ja: 'スポット', en: 'Spot' },
  'markerType.closureClosed': { ja: '通行止め地点', en: 'Closed point' },
  'markerType.closureDifficult': { ja: '通行困難地点', en: 'Difficult point' },
  'markerType.trackStart': { ja: '移動記録開始点', en: 'Track start point' },
  'markerType.trackCurrent': { ja: '移動記録現在地点', en: 'Track current point' },
  'markerType.track': { ja: '移動記録経路', en: 'Track route' },
  'markerType.photoLocation': { ja: '写真撮影場所', en: 'Photo location' },

  // マーカー形状(config.js の MARKER_SHAPES の value と一致)
  'markerShape.circle': { ja: '円', en: 'Circle' },
  'markerShape.square': { ja: '四角', en: 'Square' },
  'markerShape.triangle': { ja: '三角', en: 'Triangle' },
  'markerShape.diamond': { ja: 'ひし形', en: 'Diamond' },
  'markerShape.star': { ja: '星', en: 'Star' },
  'markerShape.line': { ja: '線', en: 'Line' },
  'markerShape.x': { ja: '✖', en: '✖' },

  // ----- 通行止め・通行困難地点(closures) -----
  'closure.title': { ja: '通行止め・通行困難地点', en: 'Closed & Difficult Points' },
  'closure.versionLabel': { ja: 'バージョン:', en: 'Version:' },
  'closure.loadFile': { ja: 'ファイル読み込み', en: 'Load file' },
  'closure.apply': { ja: 'マップに反映', en: 'Apply to map' },
  'closure.publish': { ja: '公開', en: 'Publish' },
  // マップのポップアップ(kind 表示・理由・更新日)
  'closure.kindClosed': { ja: '通行止め', en: 'Closed' },
  'closure.kindDifficult': { ja: '通行困難', en: 'Difficult to pass' },
  'closure.popupReason': { ja: '理由: {reason}', en: 'Reason: {reason}' },
  'closure.popupUpdated': { ja: '更新日: {date}', en: 'Updated: {date}' },
  // 編集フロー
  'closure.invalidFormat': {
    ja: 'FeatureCollection 形式の geojson ではありません',
    en: 'The file is not a FeatureCollection geojson'
  },
  'closure.noPoints': { ja: 'Point 地物が含まれていません', en: 'No Point features found' },
  'closure.jsonParseFailed': {
    ja: '{name} を JSON として読み込めませんでした',
    en: 'Could not read {name} as JSON'
  },
  'closure.loadFailed': { ja: '読み込み失敗: {error}', en: 'Load failed: {error}' },
  'closure.fileLoaded': {
    ja: '{name} を読み込みました({count} 件)。反映にはバージョンの変更が必要です',
    en: 'Loaded {name} ({count} items). Change the version to apply it'
  },
  'closure.needNewVersion': { ja: '新しいバージョンを入力してください', en: 'Enter a new version' },
  'closure.applyConfirm': {
    ja: 'バージョン {version}({count} 件)をこの端末のマップに反映します。よろしいですか?',
    en: 'Apply version {version} ({count} items) to the map on this device?'
  },
  'closure.saveFailed': { ja: '保存に失敗しました: {message}', en: 'Failed to save: {message}' },
  'closure.appliedLog': {
    ja: '通行止め・通行困難地点を反映しました(バージョン {version} / {count} 件)',
    en: 'Applied closed & difficult points (version {version} / {count} items)'
  },
  'closure.appliedAlert': {
    ja: 'バージョン {version}({count} 件)をこの端末のマップに反映しました。\n' +
        'ユーザーへ公開するには、続けて「公開」を押してください。',
    en: 'Version {version} ({count} items) has been applied to the map on this device.\n' +
        'To publish it to users, press "Publish" next.'
  },
  'closure.needApplyFirst': {
    ja: '先に「ファイル読み込み」→「マップに反映」でデータを反映してください',
    en: 'First apply data via "Load file" → "Apply to map"'
  },
  'closure.unappliedData': {
    ja: '未反映の読み込みデータがあります。先に「マップに反映」を押してください',
    en: 'There is loaded data that has not been applied. Press "Apply to map" first'
  },
  'closure.publishEmptyWarn': {
    ja: '\n【注意】0 件のため、公開中の全地点が地図から消えます。',
    en: '\n[Warning] 0 items: all currently published points will disappear from the map.'
  },
  'closure.publishConfirm': {
    ja: 'バージョン {version}({count} 件)をユーザーへ公開します。よろしいですか?{warn}',
    en: 'Publish version {version} ({count} items) to users?{warn}'
  },
  'closure.tokenPrompt': {
    ja: '公開トークンを入力してください(この端末に保存されます)',
    en: 'Enter the publish token (it will be saved on this device)'
  },
  'closure.e01': {
    ja: '【E01】公開トークンが正しくありません。\n\n' +
        'もう一度「公開」を押して、正しいトークンを入力してください。\n' +
        'トークンが分からないときは、開発担当者に確認してください。',
    en: '[E01] The publish token is incorrect.\n\n' +
        'Press "Publish" again and enter the correct token.\n' +
        'If you do not know the token, ask the developer.'
  },
  'closure.e02': {
    ja: '【E02】公開機能がサーバー側でまだ設定されていません。\n\n' +
        'この画面の操作では直りません。\n' +
        '開発担当者に「エラー E02(公開トークン未設定)」と伝えてください。',
    en: '[E02] Publishing is not yet configured on the server.\n\n' +
        'This cannot be fixed from this screen.\n' +
        'Tell the developer "Error E02 (publish token not configured)".'
  },
  'closure.e03': {
    ja: '【E03】公開データに不備があります。\n\n理由: {detail}\n\n' +
        'バージョンを変えたか、地点の座標・IDが正しいかを確認し、\n' +
        'データを作り直してからやり直してください。',
    en: '[E03] The publish data is invalid.\n\nReason: {detail}\n\n' +
        'Check that the version was changed and that point coordinates/IDs are correct,\n' +
        'then rebuild the data and try again.'
  },
  'closure.e04': {
    ja: '【E04】公開データの保存に失敗しました(サーバー側)。\n\n詳細: {detail}\n\n' +
        '少し時間をおいて、もう一度「公開」をお試しください。\n' +
        '何度も続くときは、開発担当者に「エラー E04(公開ストア保存失敗)」と伝えてください。',
    en: '[E04] Failed to save the publish data (server side).\n\nDetails: {detail}\n\n' +
        'Please wait a moment and try "Publish" again.\n' +
        'If it keeps failing, tell the developer "Error E04 (publish store save failure)".'
  },
  'closure.e05': {
    ja: '【E05】公開サーバーに接続できませんでした(通信エラー)。\n\n' +
        'まず通信状況(電波・Wi-Fi)を確認して、もう一度お試しください。\n' +
        '続くときは、開発担当者に「エラー E05(通信エラー): {message}」と伝えてください。',
    en: '[E05] Could not connect to the publish server (network error).\n\n' +
        'Check your connection (signal/Wi-Fi) and try again.\n' +
        'If it persists, tell the developer "Error E05 (network error): {message}".'
  },
  'closure.publishedLog': {
    ja: '通行止め・通行困難地点を公開しました(バージョン {version} / {count} 件)',
    en: 'Published closed & difficult points (version {version} / {count} items)'
  },
  'closure.publishedAlert': {
    ja: 'バージョン {version}({count} 件)をユーザーへ公開しました。\n' +
        '各端末には次回のマップ表示時に反映されます。',
    en: 'Version {version} ({count} items) has been published to users.\n' +
        'Each device will receive it the next time the map is shown.'
  },
  'closure.backupConfirm': {
    ja: '今回のデータをこの端末に保存しますか?(ファイル名: {name})\n' +
        '保存しておくと、あとで公開をやり直したり、開発担当者に渡して調べてもらえます。',
    en: 'Save this data on this device? (file name: {name})\n' +
        'Keeping it lets you retry publishing later or hand it to the developer for investigation.'
  },
  'closure.cancelled': {
    ja: '読み込んだ内容を反映せずにキャンセルしました',
    en: 'Cancelled without applying the loaded data'
  }
};

// 翻訳文字列を返す。params は {name} 形式のプレースホルダを置換する。
// キーが無い場合は console.warn してキーをそのまま返す(翻訳漏れの検出用)。
export function t(key, params) {
  const entry = DICT[key];
  if (!entry) {
    console.warn('[i18n] missing key:', key);
    return key;
  }
  let text = entry[lang] ?? entry.ja;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

// 静的なHTML文言への一括適用(起動時に1回、init() の冒頭で呼ぶ)。
// 日本語(既定)のときは何もしない = 現行HTMLの表示がそのまま使われる。
export function applyStaticTranslations() {
  if (lang === 'ja') return;
  document.documentElement.lang = lang;
  document.title = t('app.title');
  for (const elem of document.querySelectorAll('[data-i18n]')) {
    elem.textContent = t(elem.dataset.i18n);
  }
  for (const elem of document.querySelectorAll('[data-i18n-aria]')) {
    elem.setAttribute('aria-label', t(elem.dataset.i18nAria));
  }
  for (const elem of document.querySelectorAll('[data-i18n-title]')) {
    elem.setAttribute('title', t(elem.dataset.i18nTitle));
  }
}
