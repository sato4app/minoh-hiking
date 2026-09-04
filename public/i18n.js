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
  'home.versionInfo': { ja: 'バージョン情報', en: 'Version Info' },
  // 起動時画面のボタンは幅を取らないよう短く「QR」とする。
  // QRコードモーダルの見出し(qr.title)は、何を出す画面か分かるよう「QRコード」のまま
  'home.qr': { ja: 'QR', en: 'QR' },
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
  // 履歴用: どの操作で止まったのかを残す(操作していないのに止まった場合の切り分けに使う)
  'track.finishedBy': {
    ja: '移動記録を終了しました[{by}]({summary})',
    en: 'Track recording finished [{by}] ({summary})'
  },
  'track.stopByButton': { ja: '記録停止ボタン(■)をタップ', en: 'Stop button (■) tapped' },
  'track.stopByToggle': { ja: '「移動経路を記録」をオフ', en: '"Record track" switched off' },
  'track.interrupted': {
    ja: '前回の移動記録は停止操作なしで中断されました(アプリの再読み込み・終了など)',
    en: 'The previous track recording ended without a stop action (app reload or exit)'
  },
  'track.nothingToClear': { ja: 'クリアする移動経路がありません', en: 'No recorded track to clear' },
  'track.clearConfirm': {
    ja: '表示中の移動経路をすべてクリアします。よろしいですか?',
    en: 'Clear all tracks currently shown on the map?'
  },
  'track.stopConfirm': {
    ja: '移動経路の記録を停止します。よろしいですか?',
    en: 'Stop recording the track?'
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

  // ----- 地図データのダウンロード(モーダル + tiles.js) -----
  // 起動画面のボタンとモーダル見出しで共用する
  'download.title': { ja: '地図データのダウンロード', en: 'Download Map Data' },
  'download.subtitle': {
    ja: '電波が届かない場所でも地図を表示できるよう、地図データを端末に保存します（オフライン対応）',
    en: 'Saves map data on your device so the map works where there is no signal (offline support)'
  },
  // バージョン行: ラベルと、状態別の値(未ダウンロード / 最新 / 更新あり)。
  // 「保存済み ⇒ 最新」の形は版番号と矢印だけなので tiles.js 側で組み立てる
  'download.versionLabel': { ja: '端末の地図データ ⇒ 配信中の最新', en: 'On device ⇒ Latest available' },
  'download.notDownloaded': { ja: '未ダウンロード', en: 'Not downloaded' },
  'download.versionUpToDate': { ja: '{version}（最新）', en: '{version} (latest)' },
  // サイズ行: 合計は選択中レイヤーの総量、更新分はまだ端末に無いタイルの総量。
  // 未ダウンロード(合計＝更新分)のときは合計だけを出す
  'download.sizeTotal': { ja: '合計 約 {total} MB', en: 'Total approx. {total} MB' },
  'download.sizeWithDelta': {
    ja: '合計 約 {total} MB / 更新分 約 {delta} MB',
    en: 'Total approx. {total} MB / Update approx. {delta} MB'
  },
  'download.sizeNoDelta': { ja: '合計 約 {total} MB / 更新分 なし', en: 'Total approx. {total} MB / No update needed' },
  'download.includeDetail': { ja: '詳細地図データ(Z=18)を含む', en: 'Include detailed map data (Z=18)' },
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
    ja: '地図データのダウンロードを中断しました({completed}/{total})',
    en: 'Map data download interrupted ({completed}/{total})'
  },
  'download.doneWithFailures': { ja: '完了(失敗 {failed} 件あり)', en: 'Finished ({failed} failed)' },
  'download.doneWithFailuresLog': {
    ja: '地図データのダウンロード完了(失敗 {failed} 件あり)',
    en: 'Map data download finished ({failed} failed)'
  },
  'download.done': { ja: 'ダウンロード完了', en: 'Download finished' },
  'download.doneLog': { ja: '地図データのダウンロードが完了しました', en: 'Map data download completed' },
  'download.cacheReadFailed': { ja: 'キャッシュ参照失敗: {message}', en: 'Failed to read cache: {message}' },
  'download.upToDate': {
    ja: '追加でダウンロードするタイルはありません。バージョンを更新しました',
    en: 'No additional tiles to download. Version updated'
  },
  'download.upToDateLog': { ja: '地図データは最新の状態です(バージョンを更新)', en: 'Map data is up to date (version updated)' },
  // 差分/全部更新の呼び名({label} に埋め込むため、英語は文中で自然な小文字)
  'download.diffLabel': { ja: '差分更新', en: 'differential update' },
  'download.allLabel': { ja: '全部更新', en: 'full update' },
  'download.updateStarted': { ja: '{label}開始: {n} タイル', en: 'Starting {label}: {n} tiles' },
  'download.updateAbortedLog': {
    ja: '地図データの{label}を中断しました({completed}/{total})',
    en: 'Map data {label} interrupted ({completed}/{total})'
  },
  'download.updateDoneWithFailures': { ja: '{label}完了(失敗 {failed} 件あり)', en: 'Finished {label} ({failed} failed)' },
  'download.updateDoneWithFailuresLog': {
    ja: '地図データの{label}完了(失敗 {failed} 件あり)',
    en: 'Finished map data {label} ({failed} failed)'
  },
  'download.updateDone': { ja: '{label}が完了しました', en: 'Finished {label}' },
  'download.updateDoneLog': { ja: '地図データの{label}が完了しました', en: 'Finished map data {label}' },
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

  // ----- バージョン情報モーダル / 設定/Settings モーダル -----
  // 接頭辞 info. は、両モーダルが1つの「バージョン情報等」モーダルだった頃の名残
  // (2026.9 で分離したがキー名は据え置き)。振り分けは次のとおり:
  //   設定/Settings … showClock / showZoomLevel / showMessages / ariaClearMessages /
  //                    noMessages / about / appName / appNameValue
  //                    (contributors の氏名・団体名は翻訳対象外のため辞書に持たない)
  //   バージョン情報 … startupUpdateCheck / versionInfo / 各 version 系 / データ件数系
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

  // ----- QRコード(起動画面の「QR」) -----
  'qr.title': { ja: 'QRコード', en: 'QR Code' },
  'qr.subtitle': {
    ja: 'カメラで読み取ると、いま開いているページを表示できます',
    en: 'Scan with a camera to open the page you are viewing'
  },
  'qr.ariaImage': { ja: 'QRコード', en: 'QR code' },
  'qr.failed': { ja: 'QRコードを作成できませんでした', en: 'Failed to create the QR code' },

  // ----- 使い方ガイド(起動画面の「使い方」・初回起動時の自動表示) -----
  // guide.<ページのkey>Title / guide.<ページのkey>Body が1ページ分の文言。
  // key は guide.js の GUIDE_STEPS と一致させる。本文の改行(\n)はそのまま表示される
  'guide.title': { ja: '使い方', en: 'How to Use' },
  'guide.prev': { ja: '戻る', en: 'Back' },
  'guide.next': { ja: '次へ', en: 'Next' },
  'guide.finish': { ja: '終わり', en: 'Done' },

  'guide.introTitle': { ja: '箕面ハイキングマップの使い方', en: 'Using the Minoh Hiking Map' },
  'guide.introBody': {
    ja: '箕面エリアの地図に、緊急ポイント・ハイキングルート・スポット・通行止め地点を重ねて表示し、' +
        '現在地の確認と、歩いた経路の記録ができます。\n' +
        'このアプリは、課金なし、広告なし、システムへのデータ送信無しのハイキング用Webアプリです。\n' +
        '画面の場所をひとつずつ光らせながら、ひと通り見ていきます。',
    en: 'This app shows emergency points, hiking routes, spots and closures on a map of the Minoh area, ' +
        'and lets you check where you are and record the route you walk.\n' +
        'It is a web app for hiking with no charges, no ads, and no data sent to any server.\n' +
        'We will go through the screens one place at a time.'
  },

  'guide.showMapTitle': { ja: 'ハイキングマップ表示', en: 'Show Hiking Map' },
  'guide.showMapBody': {
    ja: '地図に緊急ポイント・ハイキングルート・スポット・通行止め地点と、現在地を重ねて表示します。\n' +
        'この案内の後半では、実際にこの画面を開いて説明します。',
    en: 'Shows emergency points, hiking routes, spots, closures and your current location on the map.\n' +
        'The second half of this guide opens that screen and explains it there.'
  },

  'guide.downloadTitle': { ja: '地図データのダウンロード', en: 'Download Map Data' },
  'guide.downloadBody': {
    ja: '山に入る前に、電波のある場所で地図データを端末に保存しておくと、電波が届かない場所でも地図を表示できます。\n' +
        '標準(ズームレベル:Z=14〜17)で約8.5MB、「詳細地図データ(Z=18)を含む」を選ぶと合計約14.1MBです。\n' +
        '「クリア」を押すと、ダウンロードした地図データをすべて消します。',
    en: 'Before heading into the mountains, save the map data while you still have a signal so the map works where there is none.\n' +
        'The standard range (zoom level: Z=14-17) is about 8.5 MB; with "Include detailed map data (Z=18)" it is about 14.1 MB in total.\n' +
        'Press "Clear" to delete all downloaded map data.'
  },

  'guide.versionTitle': { ja: 'バージョン情報', en: 'Version Info' },
  'guide.versionBody': {
    ja: 'アプリ・国土地理院地図タイル・ハイキングマップ・通行止めのバージョンと、表示中のデータ件数を確認できます。\n' +
        '「起動時にアプリの更新版を確認」をオンにしておくと、新しい版が出たときに起動時に知らせます。',
    en: 'Shows the versions of the app, the GSI map tiles, the hiking map and the closure data, together with how many items are loaded.\n' +
        'Turn on "Check for app updates at startup" to be told at startup when a newer version is available.'
  },

  'guide.settingsTitle': { ja: '設定/Settings', en: 'Settings' },
  'guide.settingsBody': {
    ja: '時刻の表示・ズームレベルの表示・メッセージ履歴・このアプリについてと、マーカーの設定、言語の設定をまとめています。\n' +
        'ボタン名を日英併記にしているのは、英語表示のままで分からなくなっても、ここから日本語に戻せるようにするためです。',
    en: 'Groups together the clock, the zoom level display, the message history, About this app, marker settings and the language setting.\n' +
        'The button is labelled in both Japanese and English so you can always come back here and switch the language.'
  },

  'guide.guideQrTitle': { ja: '使い方とQR', en: 'How to Use and QR' },
  'guide.guideQrBody': {
    ja: 'この案内は、いつでも「使い方」から見直せます。\n' +
        '「QR」は、いま開いているページのQRコードを表示します。別の端末のカメラで読み取ると、同じアプリをすぐ開けます。\n' +
        '「次へ」を押すと、ハイキングマップ表示に移って案内を続けます。',
    en: 'You can reopen this guide at any time from "How to Use".\n' +
        '"QR" shows a QR code for the page you are on. Scan it with another device with a camera to open the same app right away.\n' +
        'Press "Next" to move on to the hiking map and continue the guide.'
  },

  'guide.mapOverlayTitle': { ja: '地図に表示される情報', en: 'What the Map Shows' },
  'guide.mapOverlayBody': {
    ja: '緊急ポイント・ハイキングルート・スポット・通行止め地点は常に表示されます(切り替えスイッチはありません)。\n' +
        'マーカーや線をタップすると、緊急ポイント番号・スポット名・通行止めの理由などが吹き出しで出ます。\n' +
        '初期設定では、赤い✖が通行止め、オレンジの三角が通行困難地点です。',
    en: 'Emergency points, hiking routes, spots and closures are always shown (there is no switch to hide them).\n' +
        'Tap a marker or a line to see the emergency point number, the spot name, the reason for a closure and so on in a popup.\n' +
        'By default a red ✖ shows a closed point and an orange triangle shows a point that is difficult to pass.'
  },

  'guide.mapControlsTitle': { ja: '画面の右下', en: 'The Bottom Right of the Screen' },
  'guide.mapControlsBody': {
    ja: '下から順に、国土地理院のクレジット・縮尺・ズームレベル・ズーム(＋/−)・現在地点表示ボタンです。\n' +
        '現在地点表示ボタンを押すと、現在地が画面の中央に来るように地図が動き、薄い青色の円が3秒かけて小さくなって消えます。\n' +
        '初めて使うときは位置情報の利用許可を聞かれます。「許可」を選んでください。',
    en: 'From the bottom up: the GSI credit, the scale bar, the zoom level, the zoom buttons (+/−) and the show-current-location button.\n' +
        'Pressing the show-current-location button moves the map so you are centred, and a pale blue circle shrinks over three seconds and disappears.\n' +
        'The first time, you will be asked to allow access to your location. Please choose "Allow".'
  },

  'guide.mapMenuTitle': { ja: 'メニュー(≡)と現在地の表示', en: 'The Menu (≡) and Your Location' },
  'guide.mapMenuBody': {
    ja: '右上のメニューボタン(≡)で表示設定パネルを開きます(地図をタップすると閉じます)。\n' +
        '「現在地点をマーカー表示」で現在地の青い丸を出し、「現在地点は中央に表示」で地図が現在地に追従します。どちらも初期設定はオンです。\n' +
        '好きな場所を自由に見たいときは「現在地点は中央に表示」をオフにします。',
    en: 'The menu button (≡) at the top right opens the display settings panel (tap the map to close it).\n' +
        '"Show current location marker" displays the blue dot for your location, and "Keep current location centered" makes the map follow you. Both are on by default.\n' +
        'Turn off "Keep current location centered" when you want to pan around freely.'
  },

  'guide.mapTrackTitle': { ja: '移動経路の記録', en: 'Recording Your Track' },
  'guide.mapTrackBody': {
    ja: '「移動経路を記録」をオンにすると、メニューボタン(≡)の左に▶(記録開始)が出ます。押すと、歩いた道が線で地図に描かれます。\n' +
        '停止は■で、誤って止めないよう確認が出ます。記録中は、起動時画面に戻っても記録は続きます。\n' +
        '地点数と移動距離は経路ごとに表で出ます。「読み込み」でGPXファイルを表示、「出力」でGPXファイルに保存、「クリア」で表示中の経路をすべて消します。',
    en: 'Turning on "Record track" puts a ▶ (start recording) button to the left of the menu button (≡). Press it and the path you walk is drawn on the map.\n' +
        'Press ■ to stop it; a confirmation appears so you do not stop it by accident. Recording continues even if you go back to the start screen.\n' +
        'The number of points and the distance are listed per track. "Import" displays a GPX file, "Export" saves one, and "Clear" removes every track on the map.'
  },

  'guide.mapFinishTitle': { ja: 'マーカーの設定と、画面の戻り方', en: 'Marker Settings and Going Back' },
  'guide.mapFinishBody': {
    ja: '「マーカーの設定」では、地図の目印の色・形・大きさを種類ごとに変えられます。\n' +
        '「起動時の画面に戻る」で最初の画面に戻ります。\n' +
        '案内は以上です。この案内は、いつでも起動時画面の「使い方」から見直せます。',
    en: 'In "Marker settings" you can change the colour, shape and size of each kind of marker on the map.\n' +
        '"Back to start screen" returns you to the first screen.\n' +
        'That is the whole tour. You can reopen this guide at any time from "How to Use" on the start screen.'
  },

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
        '起動時画面の「地図データのダウンロード」から、ダウンロードしてください。\n' +
        'サイズは詳細地図データを含めて合計約14MBで、既存分があれば差分のみです。',
    en: 'The map tiles available for download have been expanded.\nCurrent: {saved}\nLatest: {latest}\n\n' +
        'Please download them from "Download Map Data" on the start screen.\n' +
        'The total size is about 14 MB including the detailed map data; if you already have tiles, only the difference is downloaded.'
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
