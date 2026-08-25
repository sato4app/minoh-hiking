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
  'home.download': { ja: '地図のダウンロード', en: 'Download Maps' },
  'home.versionInfo': { ja: 'バージョン情報', en: 'Version Info' },
  // 「設定/Settings」(起動画面のボタン・設定モーダルの見出し)は日英併記の固定文言のため
  // 翻訳キーを持たない(index.html に直接記述し、言語切替でも変えない)

  // ----- マップ画面 -----
  'map.ariaMap': { ja: '箕面エリア地理院地図', en: 'GSI map of the Minoh area' },
  'map.ariaLayers': { ja: '表示設定', en: 'Display settings' },
  'map.toggleCurrentMarker': { ja: '現在地点をマーカー表示', en: 'Show current location marker' },
  // 現在地点表示ボタン(ズームボタンの上)。メニューのトグルとは独立した単発の操作
  'map.showCurrentSpot': { ja: '現在地点表示', en: 'Show current location' },
  'map.toggleCenterCurrent': { ja: '現在地点は中央に表示', en: 'Keep current location centered' },
  'map.toggleTrackRecording': { ja: '移動経路を記録', en: 'Record track' },
  'map.backToHome': { ja: '起動時の画面に戻る', en: 'Back to start screen' },

  // ----- 移動記録 -----
  'track.start': { ja: '記録開始', en: 'Start recording' },
  'track.stop': { ja: '記録停止', en: 'Stop recording' },
  'track.export': { ja: '出力', en: 'Export' },
  'track.import': { ja: '読み込み', en: 'Import' },
  'track.importWhileRecording': {
    ja: '記録中は読み込みできません。記録を停止してください',
    en: 'Cannot import while recording. Stop recording first.'
  },
  // 表示中の経路があるときに、記録開始・読み込みの前に出す選択モーダル
  // (クリア / 追加 / 中止 の3択。見出しとボタン文言は用途で切り替える)
  'track.existingTitleRecord': { ja: '移動記録の開始', en: 'Start Recording' },
  'track.existingTitleImport': { ja: '移動経路の読み込み', en: 'Import Track' },
  'track.existingMessage': {
    ja: '表示中の移動経路が {routes} 本あります。表示中の経路をクリアするか、新しい経路として追加するかを選んでください。',
    en: 'Routes currently on the map: {routes}. Choose whether to clear them, or keep them and add a new route.'
  },
  'track.existingClearRecord': { ja: 'クリアして記録開始', en: 'Clear and start recording' },
  'track.existingAppendRecord': { ja: '追加して記録開始', en: 'Add a route and start recording' },
  'track.existingClearImport': { ja: 'クリアして読み込み', en: 'Clear and import' },
  'track.existingAppendImport': { ja: '追加して読み込み', en: 'Add and import' },
  'track.importNoPoints': {
    ja: '移動経路が見つかりませんでした(GPXに trkpt がありません)',
    en: 'No track points (trkpt) found in the GPX file'
  },
  'track.importInvalidXml': {
    ja: 'GPXファイルとして解析できません',
    en: 'The file could not be parsed as GPX'
  },
  'track.imported': {
    ja: '{name} を読み込みました({count}地点)',
    en: 'Imported {name} ({count} points)'
  },
  'track.importedMulti': {
    ja: '{name} を読み込みました({routes}経路 / {count}地点)',
    en: 'Imported {name} ({routes} routes / {count} points)'
  },
  'track.importFailed': {
    ja: '読み込みに失敗しました: {message}',
    en: 'Import failed: {message}'
  },
  'track.exportTitle': { ja: '移動経路の出力(GPX)', en: 'Export Track (GPX)' },
  'track.exportFilename': { ja: 'ファイル名', en: 'File name' },
  'track.nothingToExport': { ja: '出力する移動経路がありません', en: 'No recorded track to export' },
  'track.exportNeedName': {
    ja: 'ファイル名を入力してください',
    en: 'Enter the file name'
  },
  'track.exported': { ja: '移動経路を {name} に出力しました', en: 'Track exported to {name}' },
  'track.ariaStats': { ja: '移動経路の統計', en: 'Track statistics' },
  'track.statPoints': { ja: '地点数', en: 'Points' },
  'track.statDistance': { ja: '移動距離', en: 'Distance' },
  // 経路が複数あるときだけ、統計行の左とサマリの先頭に付ける経路の番号
  'track.routeIndex': { ja: '経路 {n}', en: 'Route {n}' },
  'track.summary': {
    ja: '記録地点 {points} 点 / 移動距離 {km} km',
    en: 'Points {points} / Distance {km} km'
  },
  'track.started': { ja: '移動記録を開始しました', en: 'Track recording started' },
  'track.finished': { ja: '移動記録を終了しました({summary})', en: 'Track recording finished ({summary})' },
  'track.nothingToClear': { ja: 'クリアする移動経路がありません', en: 'No recorded track to clear' },
  'track.clearConfirm': {
    ja: '表示中の移動経路をすべてクリアします。よろしいですか?',
    en: 'Clear all tracks currently shown on the map?'
  },
  'track.cleared': { ja: '移動経路をクリアしました', en: 'Track cleared' },
  'track.wakeLockUnavailable': {
    ja: 'この端末では記録中の画面消灯を止められません。画面が消えると記録が途切れることがあります',
    en: 'This device cannot keep the screen on while recording. Recording may pause when the screen turns off'
  },

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
  'download.subtitle': {
    ja: '電波が届かない場所でも地図を表示できるよう、地図データを端末に保存します（オフライン対応）',
    en: 'Saves map data on your device so the map works where there is no signal (offline support)'
  },
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
  'info.showZoomLevel': { ja: 'ズームレベルを表示', en: 'Show zoom level' },
  'info.startupUpdateCheck': { ja: '起動時にアプリの更新版を確認', en: 'Check for app updates at startup' },
  'info.versionInfo': { ja: 'バージョン情報', en: 'Version information' },
  'info.appVersion': { ja: 'アプリバージョン：', en: 'App version:' },
  'info.mapVersion': { ja: '国土地理院地図タイル：', en: 'GSI map tiles:' },
  'info.mapVersionNote': { ja: '（ダウンロード対象の地図指定）', en: '(Map tiles targeted for download)' },
  'info.mapdataVersion': { ja: 'ハイキングマップ：', en: 'Hiking map:' },
  'info.mapdataVersionNote': { ja: '（緊急ポイント等を含む）', en: '(Includes emergency points, etc.)' },
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
  // 更新版のダウンロード中に全画面オーバーレイへ表示する文言
  'update.downloading': {
    ja: 'アプリの更新版をダウンロードしています。完了までお待ちください。',
    en: 'Downloading the app update. Please wait until it finishes.'
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
  'markerType.spot': { ja: 'スポット', en: 'Spot' },
  'markerType.closureClosed': { ja: '通行止め地点', en: 'Closed point' },
  'markerType.closureDifficult': { ja: '通行困難地点', en: 'Difficult point' },
  'markerType.trackStart': { ja: '移動記録開始点', en: 'Track start point' },
  'markerType.trackCurrent': { ja: '移動記録現在地点', en: 'Track current point' },
  'markerType.track': { ja: '移動記録経路', en: 'Track route' },

  // マーカー形状(config.js の MARKER_SHAPES の value と一致)
  'markerShape.circle': { ja: '円', en: 'Circle' },
  'markerShape.square': { ja: '四角', en: 'Square' },
  'markerShape.triangle': { ja: '三角', en: 'Triangle' },
  'markerShape.diamond': { ja: 'ひし形', en: 'Diamond' },
  'markerShape.star': { ja: '星', en: 'Star' },
  'markerShape.line': { ja: '線', en: 'Line' },
  'markerShape.x': { ja: '✖', en: '✖' },

  // ----- 通行止め・通行困難地点(closures) -----
  // 本アプリは表示専用のため、マップのポップアップで使う文言
  // (kind 表示・理由・更新日)のみを持つ。
  'closure.kindClosed': { ja: '通行止め', en: 'Closed' },
  'closure.kindDifficult': { ja: '通行困難', en: 'Difficult to pass' },
  'closure.popupReason': { ja: '理由: {reason}', en: 'Reason: {reason}' },
  'closure.popupUpdated': { ja: '更新日: {date}', en: 'Updated: {date}' }
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
