// アプリのエントリポイント
// - SPA ビュー切替(home / map)+ 各モーダル
// - 現在地・移動記録(移動経路の記録)の操作の取りまとめ
// - 各機能モジュールの初期化と連携
//
// 機能別の実装は以下のモジュールに分離している:
//   tiles.js          … オフライン地図のDL・マニフェスト・更新バナー
//   update.js         … アプリシェルの更新確認
//   messages.js       … メッセージ履歴・トースト
//   marker-settings.js… マーカーの色・形状・サイズ設定
//   map.js            … Leaflet 地図・オーバーレイ
//   geolocation.js    … 現在地表示・移動経路の記録と端末への保存
//   camera.js         … アプリ内カメラ(「写真を撮影」の撮影。移動経路の記録とは別の機能)
//   photos.js         … 撮った写真の保持・地図への表示・端末への保存
//   kmz.js            … 写真の出力・読み込み(KMZ)
//   published-data.js … 公開API から配信データ(地図データ・通行止め)を取得
//   qrcode.js         … QRコードの生成(外部ライブラリ非依存)
//   guide.js          … 使い方ガイド(画面を順に案内するオーバーレイ)
//   faq.js / faq-text.js … ご利用の注意・よくある質問(情報・言語/Info & Language で表示)

import {
  initMap, resizeMap,
  setEmergencyPointsVisible, setEmergencyStyle,
  setHikingRoutesVisible, setHikingRouteStyle, setHikingSpotStyle,
  setClosuresVisible, setClosureClosedStyle, setClosureDifficultStyle,
  setZoomDisplayVisible, getFeatureCounts,
  setCurrentMarkerButtonHandler, setCurrentMarkerButtonState
} from './map.js';
import {
  setLocationActiveForMapView, setCurrentMarkerVisible, setFollowCurrentLocation,
  showCurrentLocationSpot,
  setTrackStyle, setTrackStartStyle, setTrackCurrentStyle,
  startTrackRecording, stopTrackRecording, getTrackStats, getTrackStatsList,
  getTrackSegments, clearTrack, loadTrackSegments, fitMapToTrack, restoreSavedTrack,
  setOnTrackPointAppended, setOnTrackNotice,
  capturePhotoPosition
} from './geolocation.js';
import { isCameraSupported, isCameraOpen, openCamera, closeCamera, setCameraStatus } from './camera.js';
import {
  setPhotoHandlers, setPhotoStyle, getPhotos, getPhotoCount, getPhoto, fitMapToPhotos,
  addPhoto, renamePhoto, deletePhoto, clearPhotos, restorePhotos, importPhotos, getPhotoThumbUrl,
  hasUnexportedPhotos, markPhotosExported
} from './photos.js';
import { isZipFile, loadPhotoBytes, buildPhotosKmz, parsePhotosKmz } from './kmz.js';
import {
  loadPublishedData, checkPublishedDataUpdate,
  getMapdataVersion, getClosureVersion, getClosureCount
} from './published-data.js';
import {
  TRACK_EXPORT_SEQ_KEY, PHOTO_EXPORT_SEQ_KEY, REOPEN_APP_SETTINGS_KEY, TOAST_DURATION_SEC,
  TRACK_RECORDING_FLAG_KEY, TRACK_UNEXPORTED_KEY, PHOTO_SHOOT_CONFIRMED_KEY, MAP_TOGGLES_KEY,
  TRACK_STOP_HOLD_MS, TRACK_STOP_CONFIRM_SEC, PHOTO_MAX_COUNT, PHOTO_WARN_RATIO,
  TRACK_BATTERY_NOTICE_SEC
} from './config.js';
import { getLang, setLang, t, applyStaticTranslations } from './i18n.js';
import { logHistory, renderMessageList, clearMessageLog, showToast } from './messages.js';
import {
  checkAppShellUpdate, promptMapTileUpdate, getCachedAppShellVersion, watchAppShellReplacement
} from './update.js';
import {
  getManifestVersion, getSavedManifestVersion,
  evaluateManifestVersion,
  openDownloadModal,
  migrateLegacyPackages, initTilesEvents, setStatus, requestPersistentStorage
} from './tiles.js';
import { readMarkerSettings, initMarkerSettings } from './marker-settings.js';
import { renderQrSvg } from './qrcode.js';
import { initGuide, openGuide, maybeAutoOpenGuide } from './guide.js';
import { showNotices, showQuestions, getNoticeText } from './faq.js';

// ===== 状態 =====
let currentView = 'home';

// ===== DOM要素 =====
const el = {
  // ビュー
  views: {
    home: document.getElementById('viewHome'),
    map: document.getElementById('viewMap')
  },

  // ホーム
  btnOpenDownload: document.getElementById('btnOpenDownload'),
  btnOpenAppSettings: document.getElementById('btnOpenAppSettings'),
  btnOpenQrCode: document.getElementById('btnOpenQrCode'),
  btnOpenGuide: document.getElementById('btnOpenGuide'),

  // QRコードモーダル(起動画面の「QR」から表示)
  qrCodeModal: document.getElementById('qrCodeModal'),
  qrCodeImage: document.getElementById('qrCodeImage'),
  qrCodeUrl: document.getElementById('qrCodeUrl'),

  // 情報・言語モーダル(起動画面の「情報・言語/Info & Language」から表示)
  appSettingsModal: document.getElementById('appSettingsModal'),
  languageSelect: document.getElementById('languageSelect'),
  // 押すと下に開く5項目(見出しのボタンと、開く中身)
  btnInfoNotices: document.getElementById('btnInfoNotices'),
  infoNoticesBody: document.getElementById('infoNoticesBody'),
  faqNotices: document.getElementById('faqNotices'),
  btnInfoFaq: document.getElementById('btnInfoFaq'),
  infoFaqBody: document.getElementById('infoFaqBody'),
  faqContent: document.getElementById('faqContent'),
  btnInfoMessages: document.getElementById('btnInfoMessages'),
  infoMessagesBody: document.getElementById('infoMessagesBody'),
  btnInfoVersion: document.getElementById('btnInfoVersion'),
  infoVersionBody: document.getElementById('infoVersionBody'),
  btnInfoAbout: document.getElementById('btnInfoAbout'),
  infoAboutBody: document.getElementById('infoAboutBody'),
  // 外部サイトを開く確認(このアプリについて のリンクから表示)
  externalSiteModal: document.getElementById('externalSiteModal'),
  externalSiteMessage: document.getElementById('externalSiteMessage'),
  externalSiteUrl: document.getElementById('externalSiteUrl'),
  btnExternalSiteOpen: document.getElementById('btnExternalSiteOpen'),
  versionManifest: document.getElementById('versionManifest'),
  versionAppShell: document.getElementById('versionAppShell'),
  // 公開データのバージョン表示欄(バージョン情報内)
  versionMapdata: document.getElementById('versionMapdata'),
  versionClosures: document.getElementById('versionClosures'),
  btnClearMessages: document.getElementById('btnClearMessages'),

  // マップ
  btnMapLayers: document.getElementById('btnMapLayers'),
  mapLayerPanel: document.getElementById('mapLayerPanel'),
  mapClock: document.getElementById('mapClock'),
  toggleClock: document.getElementById('toggleClock'),
  toggleZoomDisplay: document.getElementById('toggleZoomDisplay'),
  // データ件数表示(ポイント/ルート/スポット/通行止め)
  countPoints: document.getElementById('countPoints'),
  countRoutes: document.getElementById('countRoutes'),
  countSpots: document.getElementById('countSpots'),
  countClosures: document.getElementById('countClosures'),
  // 現在地点の表示・地図追従トグル(移動経路を記録の上に配置)
  toggleCurrentMarker: document.getElementById('toggleCurrentMarker'),
  toggleCenterCurrent: document.getElementById('toggleCenterCurrent'),
  toggleTrackRecording: document.getElementById('toggleTrackRecording'),
  // 「移動経路を記録」ON のとき表示する記録開始・停止トグル(メニューボタンの左)
  btnTrackToggle: document.getElementById('btnTrackToggle'),
  // レイヤーパネル内: 移動経路の件数と出力済みかどうか(トグルの右)・統計表(経路ごとの
  // 地点数・移動距離)・読み込み・出力・クリア。統計とボタンはトグル ON のときだけ出す。
  // 統計は経路の本数に応じて app.js が組み立てる
  trackStatus: document.getElementById('trackStatus'),
  trackStats: document.getElementById('trackStats'),
  trackActions: document.getElementById('trackActions'),
  btnTrackImport: document.getElementById('btnTrackImport'),
  btnTrackExport: document.getElementById('btnTrackExport'),
  btnTrackClear: document.getElementById('btnTrackClear'),
  trackImportInput: document.getElementById('trackImportInput'),
  // 表示中の経路があるときに「クリア/追加/中止」を選ぶモーダル(記録開始・読み込みで共用)
  trackExistingModal: document.getElementById('trackExistingModal'),
  trackExistingTitle: document.getElementById('trackExistingTitle'),
  trackExistingMessage: document.getElementById('trackExistingMessage'),
  btnTrackExistingClear: document.getElementById('btnTrackExistingClear'),
  btnTrackExistingAppend: document.getElementById('btnTrackExistingAppend'),
  // 移動経路の記録の停止を確認するモーダル(■の長押し・トグルのオフで共用)
  trackStopModal: document.getElementById('trackStopModal'),
  trackStopAutoClose: document.getElementById('trackStopAutoClose'),
  btnTrackStopOk: document.getElementById('btnTrackStopOk'),
  // 移動経路の出力(GPX)モーダル。未出力の写真があるときは出し忘れの案内を添える
  trackExportModal: document.getElementById('trackExportModal'),
  trackExportName: document.getElementById('trackExportName'),
  trackExportPhotoNote: document.getElementById('trackExportPhotoNote'),
  btnTrackExportSave: document.getElementById('btnTrackExportSave'),
  // 「写真を撮影」(移動経路とは別の機能)。ON のとき表示するカメラボタン(記録開始・停止トグルの左)と、
  // レイヤーパネル内の件数と出力済みかどうか(トグルの右)・読み込み・出力・クリア
  togglePhotoCapture: document.getElementById('togglePhotoCapture'),
  btnPhotoCamera: document.getElementById('btnPhotoCamera'),
  photoStatus: document.getElementById('photoStatus'),
  photoStats: document.getElementById('photoStats'),
  photoActions: document.getElementById('photoActions'),
  btnPhotoImport: document.getElementById('btnPhotoImport'),
  btnPhotoExport: document.getElementById('btnPhotoExport'),
  btnPhotoClear: document.getElementById('btnPhotoClear'),
  photoImportInput: document.getElementById('photoImportInput'),
  // 表示中の写真があるときに「クリア/追加/中止」を選ぶモーダル(その日の最初の撮影・読み込みで共用)
  photoExistingModal: document.getElementById('photoExistingModal'),
  photoExistingTitle: document.getElementById('photoExistingTitle'),
  photoExistingMessage: document.getElementById('photoExistingMessage'),
  btnPhotoExistingClear: document.getElementById('btnPhotoExistingClear'),
  btnPhotoExistingAppend: document.getElementById('btnPhotoExistingAppend'),
  // 写真の出力(KMZ)モーダル
  photoExportModal: document.getElementById('photoExportModal'),
  photoExportName: document.getElementById('photoExportName'),
  btnPhotoExportSave: document.getElementById('btnPhotoExportSave'),
  // 写真の表示(名前の変更)
  photoViewModal: document.getElementById('photoViewModal'),
  photoViewImage: document.getElementById('photoViewImage'),
  photoViewName: document.getElementById('photoViewName'),
  photoViewTitle: document.getElementById('photoViewTitle'),
  btnPhotoViewPrev: document.getElementById('btnPhotoViewPrev'),
  btnPhotoViewNext: document.getElementById('btnPhotoViewNext'),
  photoViewMeta: document.getElementById('photoViewMeta'),
  btnPhotoDelete: document.getElementById('btnPhotoDelete'),
  btnPhotoViewList: document.getElementById('btnPhotoViewList'),
  // 写真の一覧(タイル)
  photoListModal: document.getElementById('photoListModal'),
  photoListTitle: document.getElementById('photoListTitle'),
  photoListBody: document.getElementById('photoListBody'),
  photoListGrid: document.getElementById('photoListGrid'),

  // マーカーの設定モーダル
  settingsModal: document.getElementById('settingsModal'),

  // マップ画面メニュー内の設定ショートカット
  btnMapOpenMarkerSettings: document.getElementById('btnMapOpenMarkerSettings')
};

// 要素が見つからないときに落ちないイベント登録。
// 端末に古い index.html が残ったまま新しい app.js が読み込まれると(シェルの新旧が
// 混ざった状態)、一部の要素が取得できずに初期化が丸ごと止まり、地図まで出なくなる。
// その場合でも残りの初期化を続け、起動時画面のボタンからアプリを更新できるようにする。
function on(target, type, handler, options) {
  if (!target) {
    console.warn(`[app] 要素が見つからないため ${type} を登録しませんでした(表示が古い可能性があります)`);
    return;
  }
  target.addEventListener(type, handler, options);
}

// 初期化の一段階を実行する。失敗しても後続(地図の初期化など)を止めない
function initStep(name, fn) {
  try {
    fn();
  } catch (err) {
    console.error(`[app] 初期化の途中で問題が発生しました(${name}):`, err);
  }
}

// ===== 初期化 =====
async function init() {
  // 選択言語が英語のとき、静的なHTML文言(data-i18n属性)を一括置換する。
  // 以降の confirm・トースト等の動的文言より必ず先に適用する
  applyStaticTranslations();
  // マップのメニューのトグルを前回の状態に戻す。
  // 各トグルの反映は以降の初期化・マップ画面への切替が checked を読んで行うため、最初に行う
  initStep('restoreMapToggles', restoreMapToggles);

  // 開いている間にブラウザが新しい版へ入れ替えたら知らせる(登録より前に見張りを始める。
  // 登録をきっかけにブラウザが更新を確かめ、すぐ入れ替わることがあるため)
  initStep('watchAppShellReplacement', watchAppShellReplacement);
  // SW 登録
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('service-worker.js');
    } catch (err) {
      console.warn('SW登録失敗:', err);
    }
  }

  initStep('bindEvents', bindEvents);
  initStep('initTilesEvents', initTilesEvents);
  initStep('initMarkerSettings', initMarkerSettings);
  initStep('renderMessageList', renderMessageList);
  await migrateLegacyPackages();
  // ダウンロード済みのタイルがあれば、保存領域の永続化を依頼する(起動を待たせない)
  requestPersistentStorage();
  // アプリの更新版の確認は起動時には行わず、起動時画面のボタンをタップしたときに行う(bindEvents)

  // 共有地図を初期化(箕面大滝中心 / z=15、ホーム/マップで共通)
  initMap('map');
  // 現在地点表示ボタンは押されていないときは灰色。ラベル(title/aria-label)も
  // ここで初期化する(押されるまで一度も設定されないため)
  setCurrentMarkerButtonState(false);
  // ズームレベル表示は「ズームレベルを表示」トグルの状態に従う
  setZoomDisplayVisible(el.toggleZoomDisplay ? el.toggleZoomDisplay.checked : true);
  // 各マーカースタイルは公開データの読込前に設定しておく
  // (レイヤー構築時に反映される)。保存済み設定が無ければ config.js の既定値。
  const markerSettings = readMarkerSettings();
  setEmergencyStyle(markerSettings.emergency);
  setHikingRouteStyle(markerSettings.hikingRoute);
  setHikingSpotStyle(markerSettings.spot);
  setClosureClosedStyle(markerSettings.closureClosed);
  setClosureDifficultStyle(markerSettings.closureDifficult);
  // 公開API から配信データ(地図データ・通行止め)を取得。キャッシュからの初期描画と、
  // 更新があったときの再描画(起動時・起動画面のボタンのタップ時の確認)で onApplied が
  // 呼ばれるため、そのつど表示状態と件数を合わせる。
  loadPublishedData({
    onApplied: () => {
      if (currentView === 'map') {
        setEmergencyPointsVisible(true);
        setHikingRoutesVisible(true);
        setClosuresVisible(true);
      }
      updateFeatureCounts();
      // タイル一覧も配信で届くため、ここで保存済み version と比較する
      // (相違があれば更新バナーを出す)
      evaluateManifestVersion();
      // 起動時に確認したバージョンを履歴に残す(1回だけ)
      logStartupVersionCheckOnce();
    }
  });
  setTrackStyle(markerSettings.track);
  setTrackStartStyle(markerSettings.trackStart);
  setTrackCurrentStyle(markerSettings.trackCurrent);
  // 写真撮影地点の印も、写真の復元(印を作る)より前に設定しておく
  setPhotoStyle(markerSettings.photo);
  // 前回の記録が停止操作を経ずに終わっていたら履歴に残す(起動ごとに1回)。
  // 経路の復元より先に出して、履歴が起きた順(中断 → 復元)に並ぶようにする
  logInterruptedTrackRecording();
  // 端末に保存してある移動経路を読み出して表示する。スタイルの設定より後に呼ぶこと
  // (復元時に線・マーカーを作るため、先に呼ぶと既定の見た目で描かれてしまう)
  await restoreTrackFromStorage();
  // 写真も端末から戻す(撮影地点の印を地図に出す)
  await restorePhotosFromStorage();
  // パネルの件数・統計表・ボタン行を、トグルの状態とデータに合わせて描画しておく
  updateDataPanels();

  // 初期表示はホーム(オーバーレイは非表示のまま)
  showView('home');
  // 言語変更によるリロード直後なら、情報・言語モーダルを開いた状態に戻す。
  // showView() は開いているモーダルを閉じるため、その後に呼ぶ
  restoreAppSettingsModalAfterReload();

  // 使い方ガイド。ページによって画面と表示設定パネルを切り替えるため、
  // その操作だけを関数で渡す(guide.js から app.js を import すると相互参照になる)
  initGuide({
    showView,
    getCurrentView: () => currentView,
    isLayerPanelOpen: () => !el.mapLayerPanel.hidden,
    setLayerPanelOpen: (open) => { el.mapLayerPanel.hidden = !open; }
  });
  // 初回起動時だけ自動で開く(2回目以降は起動画面の「使い方」ボタンから)
  maybeAutoOpenGuide();

  requestAnimationFrame(() => resizeMap());
}

// ===== マップのメニューのトグルの保存 =====
// 対象は表示設定パネル内のチェックボックス全部(id で対応付ける)。
// トグルを追加しても、パネル内に id 付きで置けば保存・復元の対象になる。
function mapToggleInputs() {
  return el.mapLayerPanel ? el.mapLayerPanel.querySelectorAll('input[type="checkbox"][id]') : [];
}

function saveMapToggles() {
  const states = {};
  for (const input of mapToggleInputs()) states[input.id] = input.checked;
  try { localStorage.setItem(MAP_TOGGLES_KEY, JSON.stringify(states)); } catch { /* noop */ }
}

// 保存済みの状態を戻す。checked を書き換えるだけで change は発火させない
// (各トグルの反映は起動処理が checked を読んで行う)。保存に無いトグルは HTML の初期値のまま
function restoreMapToggles() {
  let states = null;
  try { states = JSON.parse(localStorage.getItem(MAP_TOGGLES_KEY)); } catch { /* noop */ }
  if (!states || typeof states !== 'object') return;
  for (const input of mapToggleInputs()) {
    if (typeof states[input.id] === 'boolean') input.checked = states[input.id];
  }
}

// メニューの「現在地点をマーカー表示」トグルの状態を反映する。
// ズームボタン上の現在地点表示ボタンは別系統のため、ここでは触らない。
function applyCurrentMarkerVisible(on) {
  el.toggleCurrentMarker.checked = on;
  setCurrentMarkerVisible(on);
}

// 現在地点表示ボタン(ズームボタンの上)を押したとき。
// メニューのトグルとは独立した単発の操作で、押している間だけボタンを青くする。
// 表示が終わったら(3秒経過・測位失敗)灰色へ戻す。
function handleCurrentSpotButton() {
  setCurrentMarkerButtonState(true);
  showCurrentLocationSpot({ onEnd: () => setCurrentMarkerButtonState(false) });
}

function bindEvents() {
  // ホームメニュー: data-view 属性でビュー切替
  for (const btn of document.querySelectorAll('[data-view]')) {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  }
  on(el.btnOpenDownload, 'click', openDownloadModal);
  // 起動画面の「情報・言語/Info & Language」ボタンは情報・言語モーダルを表示
  on(el.btnOpenAppSettings, 'click', openAppSettingsModal);
  // 起動画面の「QR」ボタンは、いま開いている URL の QRコードを表示
  on(el.btnOpenQrCode, 'click', openQrCodeModal);
  // 起動画面の「使い方」ボタンは、アプリの使い方を順に案内するガイドを開く
  on(el.btnOpenGuide, 'click', openGuide);
  // 起動画面のボタンのどれをタップしても、あわせて更新版を確認する。
  // - アプリ: 新しい版があれば更新するか尋ねる(確認の回数の制御は update.js 側)
  // - 公開データ(地図データ・通行止め・タイル一覧): 新しい版があればそのまま取り込んで
  //   描き直す(published-data.js。反映後の処理は loadPublishedData の onApplied)
  // 各ボタン本来の動作(画面切替・モーダル表示など)はそのまま行う
  for (const btn of el.views.home.querySelectorAll('.home-btn')) {
    btn.addEventListener('click', checkForUpdates);
  }

  // 言語/Language(情報・言語モーダル): 現在の設定値を表示し、変更時は保存して
  // リロードし、選択言語で全文言を再表示する。
  // リロードすると起動画面に戻ってしまうため、フラグを立てて再読み込み後に
  // 情報・言語モーダルを開き直す(操作を続けられるようにする)
  el.languageSelect.value = getLang();
  on(el.languageSelect, 'change', (e) => {
    setLang(e.target.value);
    try { sessionStorage.setItem(REOPEN_APP_SETTINGS_KEY, '1'); } catch { /* noop */ }
    location.reload();
  });
  // 情報・言語: 見出しを押すと下に開く/閉じる。第3引数は開いたときの処理
  // ご利用の注意: 初めて開いたときだけ中身を組み立てる。参照リンク(→Q5 など)で
  // よくある質問へ移るときは、よくある質問が閉じていれば先に開く(openQuestions)
  bindInfoDisclosure(el.btnInfoNotices, el.infoNoticesBody, () => showNotices(el.faqNotices, openQuestions));
  // よくある質問: 初めて開いたときだけ中身を組み立てる。
  // 開くたびに、答えを閉じた最初の表示(見出しと質問だけ)に戻す
  bindInfoDisclosure(el.btnInfoFaq, el.infoFaqBody, () => showQuestions(el.faqContent));
  bindInfoDisclosure(el.btnInfoMessages, el.infoMessagesBody, renderMessageList);
  // バージョン情報: 開いたら、その時点の値を反映する
  bindInfoDisclosure(el.btnInfoVersion, el.infoVersionBody, showVersionInfo);
  bindInfoDisclosure(el.btnInfoAbout, el.infoAboutBody);
  // このアプリについて の外部サイトへのリンク: すぐには開かず、全画面の確認画面を出す。
  // キャンセル(data-close-modal)なら開かずに情報・言語モーダルへ戻る。
  // 「開く」なら別ウインドウで開き、確認画面は閉じておく。アプリの画面(情報・言語モーダル)は
  // そのまま残るため、開いたウインドウを閉じれば元の画面に戻れる
  for (const link of el.infoAboutBody.querySelectorAll('a[data-external-site]')) {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      openExternalSiteModal(link.href, t(link.dataset.externalSite));
    });
  }
  on(el.btnExternalSiteOpen, 'click', () => {
    if (externalSiteHref) window.open(externalSiteHref, '_blank', 'noopener');
    closeModal(el.externalSiteModal);
  });

  // モーダル閉じる(各モーダル内の [data-close-modal] が、その親モーダルを閉じる)
  for (const elem of document.querySelectorAll('[data-close-modal]')) {
    elem.addEventListener('click', () => {
      const modal = elem.closest('.modal');
      // フォーカス解除(モバイルのキーボード対策)と用途の破棄は closeModal に集約
      closeModal(modal);
      // マーカーの設定モーダルを閉じた後、現在のビュー状態(マップ画面の戻る/メニュー
      // ボタン等)を正規化して表示崩れを防ぐ
      if (modal && modal.id === 'settingsModal' && currentView === 'map') {
        showView('map');
      }
      // どのモーダルを閉じた場合も、マップ画面の操作要素を確実に表示状態へ戻す
      if (currentView === 'map') normalizeMapChrome();
    });
  }

  // ハイキングマップ表示中は文字入力を行わない。モーダルが開いていないのに
  // 文字入力欄へフォーカスが入った場合(閉じ忘れ・ポケット内の誤タッチ等)は即座に外し、
  // ソフトキーボードや文字入力ウインドウが出ないようにする。
  // 開いているモーダル内の入力欄(GPX のファイル名など)は対象外
  document.addEventListener('focusin', (e) => {
    if (currentView !== 'map') return;
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (!isKeyboardInput(target)) return;
    if (target.closest('.modal:not([hidden])')) return;
    target.blur();
  });

  // マップ表示設定(開くとき、移動経路・写真の件数と統計表を最新化する)
  on(el.btnMapLayers, 'click', () => {
    el.mapLayerPanel.hidden = !el.mapLayerPanel.hidden;
    if (!el.mapLayerPanel.hidden) updateDataPanels();
  });
  // 地図部分(#map)クリックでメニューを閉じる(マップ画面でメニュー表示中のみ)
  const mapEl = document.getElementById('map');
  if (mapEl) {
    mapEl.addEventListener('click', () => {
      if (currentView === 'map' && !el.mapLayerPanel.hidden) {
        el.mapLayerPanel.hidden = true;
      }
    });
  }
  // 時刻表示トグル(表示設定パネル内): ON でメニューボタンの左に現在時刻を表示
  on(el.toggleClock, 'change', (e) => setClockVisible(e.target.checked));
  // ズームレベル表示トグル(表示設定パネル内): ON で地図右下に現在のズームレベルを表示。
  // 表示要素は地図コントロール内にあり、マップ画面でのみ出るためビュー切替の反映は不要。
  on(el.toggleZoomDisplay, 'change', (e) => setZoomDisplayVisible(e.target.checked));
  // 現在地点をマーカー表示: 現在地マーカー(青丸)の表示/非表示を切替。
  // 現在地点表示ボタンが出す円とは独立だが、青丸を出すかはこのトグルに従う。
  on(el.toggleCurrentMarker, 'change', (e) => applyCurrentMarkerVisible(e.target.checked));
  // 現在地点表示ボタンはメニューのトグルとは独立(押すたびに円を3秒だけ表示する)
  setCurrentMarkerButtonHandler(handleCurrentSpotButton);
  // 現在地点は中央に表示: 地図を現在地へ追従させるか切替。
  // ON にすると現在地は画面中央へ来るが、その中央はこのメニュー(表示設定パネル)の
  // 真下に隠れる位置にある。切り替えた結果が見えるよう、ON にしたらメニューを閉じる
  // (閉じないと、パネルの外に見えている範囲=現在地から離れた場所だけが見え、
  //  地図が見当違いの場所へ動いたように見えてしまう)。
  on(el.toggleCenterCurrent, 'change', (e) => {
    const on = e.target.checked;
    if (on) el.mapLayerPanel.hidden = true;
    setFollowCurrentLocation(on);
  });
  on(el.toggleTrackRecording, 'change', (e) => {
    const on = e.target.checked;
    if (!on) {
      // OFF: 軌跡が消去される前に終了処理(統計の出力)を行う。
      // 記録中は確認を挟む(誤って触れただけで記録が終わらないようにする)。確認は
      // モーダルで答えを待たずに返るため、トグルはいったん ON に戻し、停止が選ばれたら
      // OFF にする(→ confirmTrackStop)。この後の saveMapToggles も ON のまま保存する
      if (isTrackRecording) {
        e.target.checked = true;
        openTrackStopModal('track.stopByToggle');
        return;
      }
      finishTrackRecording('track.stopByToggle');
    }
    // ON にしたときは、ご利用の注意と同じ電池の注意を、読み切れるよう長めに出す
    // (起動時にトグルの状態を戻すときは change が来ないので出ない)
    if (on) showToast(getNoticeText('trackBattery'), { durationSec: TRACK_BATTERY_NOTICE_SEC });
    // 記録開始・停止ボタンの表示を切替。
    // 現在地の監視は「現在地点をマーカー表示」等のトグルが管理するため、ここでは触らない。
    updateTrackButtonState(on);
    // パネルの統計表・ボタン行も、トグル ON のときだけ出す
    updateTrackPanel();
  });
  // 写真を撮影: ON でカメラボタンと、パネルの読み込み・出力・クリアを出す(移動経路とは無関係)。
  // OFF から ON にしたら、次の撮影で「クリア/追加」を聞き直す(→ openPhotoCamera)
  on(el.togglePhotoCapture, 'change', (e) => {
    const on = e.target.checked;
    if (on) writeShootConfirmedDate(null);
    updatePhotoButtonState(on);
    updatePhotoPanel();
  });
  // 表示設定パネルのトグルは切り替えるたびに保存する(次回起動時に restoreMapToggles で戻す)。
  // 各トグルの処理(上)より後に登録し、取り消しで checked を戻した場合も最終の状態を保存する
  for (const input of mapToggleInputs()) on(input, 'change', saveMapToggles);

  // 記録開始・停止トグルボタン: 移動経路を記録トグル ON のときのみ表示・操作可。
  // 記録中なら停止、停止中なら開始する(押下ごとにアイコンが切り替わる)。
  on(el.btnTrackToggle, 'click', (e) => {
    // ボタンが表示されている(=移動経路を記録 ON で現在地表示が有効)ときのみ動作。
    // checked の値に依存すると、位置情報エラーで checked が戻されたとき無言で
    // 効かなくなるため、ボタン自身の表示状態で判定する。
    if (el.btnTrackToggle.hidden) return;
    if (!isTrackRecording) {
      beginTrackRecording();
      return;
    }
    // キーボード(Enter/Space)での操作は click の detail が 0。意図した操作なので確認を出す
    if (e.detail === 0) {
      openTrackStopModal('track.stopByButton');
      return;
    }
    // 記録中の停止は長押し(→ bindTrackStopHold)。
    // 短いタップは停止の確認を出さず、長押しで止めることだけ伝える
    showToast(t('track.stopHoldHint'));
  });
  bindTrackStopHold();
  on(el.btnTrackStopOk, 'click', confirmTrackStop);

  // カメラボタン: アプリ内カメラを開く(移動経路の記録とは無関係に撮影できる)
  on(el.btnPhotoCamera, 'click', openPhotoCamera);
  // 写真の表示: 地図のカメラの印から開く。枚数・出力済みかどうかが変わったらパネルの表示を更新する
  setPhotoHandlers({ onClick: openPhotoView, onChanged: updatePhotoPanel });
  // 名前の入力を確定したとき(Enter・欄の外へ)に保存する。閉じたときも保存する(closeModal)
  on(el.photoViewName, 'change', commitPhotoViewName);
  // 写真の表示の左右の矢印ボタン: 前・次の写真へ(名前は移る前に保存する)
  on(el.btnPhotoViewPrev, 'click', () => stepPhotoView(-1));
  on(el.btnPhotoViewNext, 'click', () => stepPhotoView(1));
  // 名前の欄の右のごみ箱: 表示中の写真を削除する
  on(el.btnPhotoDelete, 'click', deleteViewingPhoto);
  // 「一覧」: 写真の一覧(タイル)へ切り替える。押した写真の表示に戻る
  on(el.btnPhotoViewList, 'click', () => openPhotoList(viewingPhotoId));

  // 読み込み: GPX ファイルを選び、記録済みの移動経路として地図に表示する(写真は扱わない)。
  // 記録中は経路が入れ替わると記録が壊れるため受け付けない。
  // 既存の経路があるときは、クリア/追加/中止をモーダルで選んでからファイル選択へ進む。
  on(el.btnTrackImport, 'click', () => {
    if (isTrackRecording) {
      showToast(t('track.importWhileRecording'));
      return;
    }
    if (hasTrack()) {
      openTrackExistingModal('import');
      return;
    }
    openTrackImportPicker(false);
  });
  on(el.trackImportInput, 'change', importTrackFile);

  // 「クリア/追加/中止」モーダルの2ボタン。中止(キャンセル・×・背景)は
  // 共通の [data-close-modal] が閉じるだけで、経路には手を付けない。
  on(el.btnTrackExistingClear, 'click', () => resolveTrackExisting(false));
  on(el.btnTrackExistingAppend, 'click', () => resolveTrackExisting(true));

  // 出力: 記録済みの移動経路を GPX 形式でファイルに出力する(写真は写真の「出力」から)
  on(el.btnTrackExport, 'click', openTrackExportModal);
  on(el.btnTrackExportSave, 'click', handleTrackExportSave);

  // 写真の読み込み: KMZ ファイルを選び、写真を地図に表示する。経路の記録中でも読み込める
  // (経路には触れないため)。既存の写真があるときは、クリア/追加/中止を選んでからファイル選択へ進む
  on(el.btnPhotoImport, 'click', () => {
    if (getPhotoCount() > 0) {
      openPhotoExistingModal('import');
      return;
    }
    openPhotoImportPicker(false);
  });
  on(el.photoImportInput, 'change', importPhotoFile);
  // 写真の「クリア/追加/中止」モーダルの2ボタン(中止は閉じるだけで、写真には手を付けない)
  on(el.btnPhotoExistingClear, 'click', () => resolvePhotoExisting(false));
  on(el.btnPhotoExistingAppend, 'click', () => resolvePhotoExisting(true));
  // 写真の出力: 全部の写真を KMZ 形式でファイルに出力する
  on(el.btnPhotoExport, 'click', openPhotoExportModal);
  on(el.btnPhotoExportSave, 'click', handlePhotoExportSave);

  // 記録点が追加されるたびにパネル内の件数・統計表を最新化する。
  // 記録で増えたとき(読み込みではないとき)は、経路を未出力にする
  setOnTrackPointAppended(({ recorded = false } = {}) => {
    if (recorded) setTrackUnexported(true);
    updateTrackPanel();
  });

  // 移動記録からの通知(画面スリープ防止が使えない場合など)。
  // 記録開始と同時に届くため、「移動記録を開始しました」のトーストを
  // 上書きしないよう、そのトーストが消えてから表示する。
  setOnTrackNotice((msg) => {
    logHistory(msg, 'error');
    setTimeout(() => showToast(msg), (TOAST_DURATION_SEC + 0.5) * 1000);
  });

  // クリア: 記録した移動経路(線・開始点・現在地点)を消去する(写真は消さない)。
  // 出力していない経路があれば、先に出力するよう添える
  on(el.btnTrackClear, 'click', () => {
    if (!hasTrack()) {
      showToast(t('track.nothingToClear'));
      return;
    }
    let message = t('track.clearConfirm');
    if (hasUnexportedTrack()) message += `\n\n${t('track.unexportedWarning')}`;
    if (!confirm(message)) return;
    clearTrack();
    setTrackUnexported(false);
    isTrackRecording = false;
    writeTrackRecordingFlag(false);
    setTrackRecordingActive(false);
    updateTrackPanel();
    logHistory(t('track.cleared'), '');
    showToast(t('track.cleared'));
  });

  // 写真のクリア: 全部の写真を消去する(経路は消さない)。
  // 写真はアプリの中にしか無いため、出力していない写真があれば先に出力するよう添える
  on(el.btnPhotoClear, 'click', () => {
    const n = getPhotoCount();
    if (n === 0) {
      showToast(t('photo.nothingToClear'));
      return;
    }
    let message = t('photo.clearConfirm', { n });
    if (hasUnexportedPhotos()) message += `\n\n${t('photo.unexportedWarning')}`;
    if (!confirm(message)) return;
    clearPhotos();
    logHistory(t('photo.cleared'), '');
    showToast(t('photo.cleared'));
  });

  // マップ画面メニューから「マーカーの設定」モーダルを開く
  on(el.btnMapOpenMarkerSettings, 'click', () => {
    el.mapLayerPanel.hidden = true;
    openMarkerSettingsModal();
  });

  // メッセージ履歴
  on(el.btnClearMessages, 'click', clearMessageLog);
}

// ===== 時刻表示 =====
let clockTimerId = null;

// 現在時刻を HH:MM 形式で時刻表示要素に反映
function updateClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  el.mapClock.textContent = `${hh}:${mm}`;
}

// 時刻表示の ON/OFF。ON で要素を表示し1秒ごとに更新、OFF で停止・非表示
function setClockVisible(on) {
  if (clockTimerId !== null) {
    clearInterval(clockTimerId);
    clockTimerId = null;
  }
  if (on) {
    updateClock();
    clockTimerId = setInterval(updateClock, 1000);
    el.mapClock.hidden = false;
  } else {
    el.mapClock.hidden = true;
  }
}

// ===== データ件数表示 =====
// 読み込んだポイント/ルート/スポット/通行止めの件数を
// 情報・言語モーダルの「バージョン情報」内に横一列で反映(未読込は "-")。
function updateFeatureCounts() {
  const c = getFeatureCounts();
  el.countPoints.textContent = c.points == null ? '-' : String(c.points);
  el.countRoutes.textContent = c.routes == null ? '-' : String(c.routes);
  el.countSpots.textContent = c.spots == null ? '-' : String(c.spots);
  // 通行止め・通行困難地点: 現在反映されているデータの件数
  const closures = getClosureCount();
  el.countClosures.textContent = closures == null ? '-' : String(closures);
}

// マップ画面の操作要素(メニューボタン ≡・時刻)を確実に表示状態へ戻す。
// これらは #map(position: fixed で常に画面全体)の上に絶対配置しているため、
// 何らかの理由でページがスクロールすると地図はそのままでボタンだけが
// 表示領域の外(主に上)へ出てしまい「消えた」ように見える。
// モーダルを閉じたときとマップ画面に入るときに呼び、位置と表示状態を正常化する。
function normalizeMapChrome() {
  // アプリ全体は body { overflow: hidden } でスクロールしない前提。
  // 入力欄へのフォーカス等でスクロールしていたら原点に戻す
  const scroller = document.scrollingElement || document.documentElement;
  if (scroller.scrollTop !== 0 || scroller.scrollLeft !== 0) {
    scroller.scrollTop = 0;
    scroller.scrollLeft = 0;
  }
  const mapView = el.views.map;
  if (mapView && (mapView.scrollTop !== 0 || mapView.scrollLeft !== 0)) {
    mapView.scrollTop = 0;
    mapView.scrollLeft = 0;
  }

  // 表示状態も明示的に復帰(hidden / display の取り残し対策)
  el.btnMapLayers.hidden = false;
  el.btnMapLayers.style.display = '';
  // 時刻は「時刻を表示」トグルの状態に従う
  setClockVisible(el.toggleClock.checked);
}

// ===== ビュー切替 =====
// ソフトキーボード(文字入力ウインドウ)が開く入力欄かどうか。
// チェックボックス・選択リスト・色ピッカーはキーボードを開かないため対象外
const KEYBOARD_INPUT_TYPES = new Set(['text', 'number', 'search', 'tel', 'url', 'email', 'password']);
function isKeyboardInput(elem) {
  if (elem.tagName === 'TEXTAREA') return true;
  return elem.tagName === 'INPUT' && KEYBOARD_INPUT_TYPES.has(elem.type);
}

// 入力欄からフォーカスを外す。
// モバイルではフォーカスが残ったまま要素を隠すとソフトキーボードや
// 文字入力ウインドウが表示され続けるため、要素を隠す前に呼ぶ
function blurActiveElement() {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) active.blur();
}

// モーダルを閉じる。入力欄にフォーカスが残ったまま非表示にすると、モバイルでは
// ソフトキーボードや文字入力ウインドウが開いたままになる(非表示後は activeElement が
// body へ移るため外せない)。モーダルを閉じるときは必ずこの関数を通す
function closeModal(modal) {
  // 写真の表示は、閉じる前に入力中の名前を保存する(フォーカスを外すと change が来ない端末があるため先に)
  if (modal && modal.id === 'photoViewModal' && !modal.hidden) commitPhotoViewName();
  blurActiveElement();
  if (!modal) return;
  modal.hidden = true;
  // 写真の表示を閉じたら、表示していた画像の URL を手放す
  if (modal.id === 'photoViewModal') releasePhotoView();
  // 写真の一覧を閉じたら、タイルの見張りを止める(縮小画像は photos.js が写真ごとに覚えている)
  if (modal.id === 'photoListModal') releasePhotoList();
  // 写真の出力(KMZ)モーダルを閉じたら、読み出した画像を捨てる(大きいため持ち続けない)
  if (modal.id === 'photoExportModal') releasePhotoBytes();
  // 「クリア/追加/中止」モーダルを閉じたのは操作の中止。保持した用途を捨てる
  if (modal.id === 'trackExistingModal') trackExistingMode = null;
  if (modal.id === 'photoExistingModal') photoExistingMode = null;
  // 外部サイトの確認を閉じたら、開く先を捨てる
  if (modal.id === 'externalSiteModal') externalSiteHref = null;
  // 停止の確認を閉じたのは停止の取り消し(記録は続ける)。自動で閉じるタイマーも止める
  if (modal.id === 'trackStopModal') {
    trackStopBy = null;
    clearTimeout(trackStopAutoCloseTimer);
    trackStopAutoCloseTimer = null;
  }
}

// 開いているモーダルをすべて閉じる(ビュー切替時の後始末)
function closeAllModals() {
  for (const modal of document.querySelectorAll('.modal')) {
    if (modal.hidden) continue;
    closeModal(modal);
  }
}

function showView(name) {
  if (!el.views[name]) return;

  // 前の画面に残った入力状態を持ち込まない。
  // マーカーの設定のサイズ入力(数値入力欄)などにフォーカスが残っていると、
  // ハイキングマップ表示中にソフトキーボードや文字入力ウインドウが出てしまうため、
  // フォーカスを外してから、開いたままのモーダルをすべて閉じる。カメラも閉じる(映像を止める)
  blurActiveElement();
  closeAllModals();
  closeCamera();

  for (const [key, view] of Object.entries(el.views)) {
    view.hidden = (key !== name);
  }
  currentView = name;

  // ビューを切り替えたらマップ画面のメニューは閉じる。
  // 開いたまま「起動時の画面に戻る」で離れても、次にマップ画面へ入ったときは
  // メニューボタン(≡)で開くまで表示しない。
  el.mapLayerPanel.hidden = true;

  // ビュー名を body クラスに反映(地図コントロールの表示/非表示などで使用)
  for (const cls of [...document.body.classList]) {
    if (cls.startsWith('view-state-')) document.body.classList.remove(cls);
  }
  document.body.classList.add(`view-state-${name}`);

  if (name === 'map') {
    // マップビュー: メニューボタン等を確実に表示(モーダル閉じ後等の表示崩れ対策)
    normalizeMapChrome();

    // マップビュー: 緊急ポイント・ハイキングルート・通行止め等を常に表示
    setEmergencyPointsVisible(true);
    setHikingRoutesVisible(true);
    setClosuresVisible(true);
    // マップビューに入ったら現在地監視を開始。表示/追従はメニュートグルの状態に従う。
    // 先に監視を有効化してから各トグル状態を反映する(再表示の無駄打ちを避ける)。
    setLocationActiveForMapView(true, {
      onError: (msg) => {
        // 位置情報が取得できない場合(非HTTPS環境・権限拒否など)は現在地を表示できない。
        // 原因が分かるよう履歴・ステータスに出力する(連続エラーは geolocation.js 側で抑制)。
        setStatus(msg, 'error');
        logHistory(msg, 'error');
      }
    });
    applyCurrentMarkerVisible(el.toggleCurrentMarker.checked);
    setFollowCurrentLocation(el.toggleCenterCurrent.checked);
    // 移動経路を記録トグルの状態に応じて記録開始/停止ボタンの表示を更新
    updateTrackButtonState(el.toggleTrackRecording.checked);
    // 写真を撮影トグルの状態に応じてカメラボタンの表示を更新
    updatePhotoButtonState(!!el.togglePhotoCapture?.checked);
    // 時刻表示は normalizeMapChrome() でトグルの状態に従って反映済み
    requestAnimationFrame(() => resizeMap());
  } else if (name === 'home') {
    // ホーム: 全オーバーレイを非表示にして地理院地図のみ表示
    setEmergencyPointsVisible(false);
    setHikingRoutesVisible(false);
    setClosuresVisible(false);
    // 移動記録中はマップ画面を離れても記録を続ける(記録は「記録停止」ボタンか
    // 「移動経路を記録」トグル OFF でのみ終了する)。geolocation.js 側も、記録中は
    // ビューに関わらず現在地監視を継続する。
    setLocationActiveForMapView(false);
    // 記録操作ボタン群・カメラボタンはマップ画面のUIなので隠す(記録状態自体は保持する)
    updateTrackButtonState(false);
    updatePhotoButtonState(false);
    // マップ以外では時刻表示を停止・非表示(トグル状態は保持)
    setClockVisible(false);
    requestAnimationFrame(() => resizeMap());
  }
}

// ===== モーダル =====
// 情報・言語モーダル(起動画面の「情報・言語/Info & Language」から表示)。
// ご利用の注意・よくある質問・メッセージ履歴・バージョン情報・このアプリについて・
// 言語/Language をまとめる(マーカーの設定はマップ画面メニューから開く)。
// 5項目は設定ではなく情報の表示なので、スイッチではなく押すと下に開く見出しにしている。

// 見出しのボタンと中身の開閉状態をそろえる(要素が無い端末でも落ちないようにする)
function setInfoDisclosure(button, body, open) {
  if (button) button.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (body) body.hidden = !open;
}

// 見出しのボタンを押したときの開閉。onOpen は開いたときに呼ぶ
function bindInfoDisclosure(button, body, onOpen) {
  on(button, 'click', () => {
    const open = button.getAttribute('aria-expanded') !== 'true';
    setInfoDisclosure(button, body, open);
    if (open) {
      onOpen?.();
      return;
    }
    // 開いた見出しは本文の上端に残る(CSS の position: sticky)ため、長い中身を読み進めた所で
    // 閉じると、見出しが本来の位置(本文の上の外)へ戻って見えなくなる。その場合は見出しが
    // 上端に来るよう本文だけをスクロールし直す(scrollIntoView は画面ごと動かすことがあるため使わない)
    const scroller = button.closest('.modal-body');
    if (!scroller) return;
    const offset = button.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    if (offset < 0) scroller.scrollTop += offset;
  });
}

// 「よくある質問」が閉じていれば開く(ご利用の注意の参照リンクから呼ぶ)。
// 開いているときは何もしない(開くときの処理で、読んでいた答えが閉じてしまうため)
function openQuestions() {
  if (!el.btnInfoFaq || el.btnInfoFaq.getAttribute('aria-expanded') === 'true') return;
  setInfoDisclosure(el.btnInfoFaq, el.infoFaqBody, true);
  showQuestions(el.faqContent);
}

function openAppSettingsModal() {
  // 5項目は開くたびに必ず閉じた状態へ戻す。開いたままだと、次に開いたときに長い内容が
  // 広がった状態で始まり、その下にある「言語の設定」までスクロールが必要になるため
  setInfoDisclosure(el.btnInfoNotices, el.infoNoticesBody, false);
  setInfoDisclosure(el.btnInfoFaq, el.infoFaqBody, false);
  setInfoDisclosure(el.btnInfoMessages, el.infoMessagesBody, false);
  setInfoDisclosure(el.btnInfoVersion, el.infoVersionBody, false);
  setInfoDisclosure(el.btnInfoAbout, el.infoAboutBody, false);

  // 履歴は開いたときにすぐ見えるよう事前に描画しておく
  renderMessageList();

  el.appSettingsModal.hidden = false;
}

// 外部サイトを開く確認(このアプリについて のリンクから表示)。
// 開く先は「開く」が押されるまで保持し、閉じたら捨てる(closeModal)
let externalSiteHref = null;

function openExternalSiteModal(href, siteName) {
  externalSiteHref = href;
  el.externalSiteMessage.textContent = t('info.externalMessage', { site: siteName });
  el.externalSiteUrl.textContent = href;
  el.externalSiteModal.hidden = false;
}

// QRコードモーダル(起動画面の「QR」から表示)。
// いま開いている URL(location.href)をその場で QRコードにする。開くたびに作り直すのは、
// クエリ付きで開いた場合や PWA の起動 URL でも実際のアドレスとずれないようにするため。
function openQrCodeModal() {
  const url = location.href;
  el.qrCodeUrl.textContent = url;
  try {
    el.qrCodeImage.innerHTML = renderQrSvg(url);
  } catch (e) {
    // URL が長すぎる等で作れなかったとき。空欄のまま出さず理由を残す
    el.qrCodeImage.replaceChildren();
    const msg = t('qr.failed');
    el.qrCodeUrl.textContent = `${msg} (${url})`;
    logHistory(msg, 'error');
    showToast(msg);
  }
  el.qrCodeModal.hidden = false;
}

// 「言語の設定/Language Settings」の変更でリロードした直後だけ、情報・言語モーダルを
// 開き直す。フラグは一度きりの復元用なので、読み取ったら必ず削除する
// (以降の通常起動では起動画面のまま)。
function restoreAppSettingsModalAfterReload() {
  let shouldReopen = false;
  try {
    shouldReopen = sessionStorage.getItem(REOPEN_APP_SETTINGS_KEY) === '1';
    sessionStorage.removeItem(REOPEN_APP_SETTINGS_KEY);
  } catch { /* noop */ }
  if (shouldReopen) openAppSettingsModal();
}

// 情報・言語モーダルの「バージョン情報」を開いたとき、その時点の値を反映する。
async function showVersionInfo() {
  el.versionManifest.textContent = getManifestVersion() || t('common.unknown');
  // 公開データ: 現在反映されているデータのバージョン
  el.versionMapdata.textContent = getMapdataVersion() || '-';
  el.versionClosures.textContent = getClosureVersion() || '-';
  // データ件数(ポイント/ルート/スポット/通行止め)を開いた時点の最新値で反映
  updateFeatureCounts();
  // アプリシェルのバージョンはキャッシュ名から取るため非同期(他の値を先に反映する)
  el.versionAppShell.textContent = (await getCachedAppShellVersion()) || t('common.unknown');

  // 地図タイル: ダウンロード済みバージョン vs サイト最新マニフェスト
  // (オフライン地図を未ダウンロードの場合は saved が無く、対象外)。
  // 新しければ「地図データのダウンロード」からの手動更新を案内する(自動更新はしない)。
  // アプリ本体の更新確認はここでは行わない(起動時画面のボタンのタップで行う。
  // この画面を開く「情報・言語/Info & Language」もその1つ)
  const savedMap = getSavedManifestVersion();
  const latestMap = getManifestVersion();
  if (savedMap && latestMap && savedMap !== latestMap) {
    promptMapTileUpdate(savedMap, latestMap);
  }
}

// マーカーの設定モーダルを開く(マップ画面メニューから)
function openMarkerSettingsModal() {
  el.settingsModal.hidden = false;
}

// ===== 移動記録の取りまとめ =====
// 移動経路を記録トグルの状態に応じて、記録開始/停止ボタンの表示を切替
function updateTrackButtonState(enabled) {
  if (el.btnTrackToggle) el.btnTrackToggle.hidden = !enabled;
  // ボタンの見た目(開始▶/停止■)は実際の記録状態に合わせる。
  // 起動時画面へ移動しても記録は続くため、ここで一律に停止状態へは戻さない
  // (トグル OFF の場合は呼び出し元が先に finishTrackRecording している)。
  setTrackRecordingActive(isTrackRecording);
}

// 記録中フラグに応じてトグルボタンのアイコン(開始▶/停止■)とラベルを切り替える
function setTrackRecordingActive(active) {
  el.btnTrackToggle.classList.toggle('is-recording', active);
  const label = active ? t('track.stop') : t('track.start');
  el.btnTrackToggle.setAttribute('aria-label', label);
  el.btnTrackToggle.setAttribute('title', label);
}

// 実際に移動記録中かどうか(開始ボタン押下〜停止まで)
let isTrackRecording = false;

// 記録の実行中フラグ(localStorage)。記録開始で立て、停止・クリア・読み込みで降ろす。
// 停止操作を経ずにアプリが終わると立ったまま残るため、次の起動でそれを検出できる。
function writeTrackRecordingFlag(on) {
  try {
    if (on) localStorage.setItem(TRACK_RECORDING_FLAG_KEY, '1');
    else localStorage.removeItem(TRACK_RECORDING_FLAG_KEY);
  } catch { /* noop */ }
}

// 起動時に1回だけ呼ぶ。前回の記録が停止操作を経ずに終わっていたら履歴に残す。
// 経路そのものは端末に保存してあり起動時に復元されるが、記録は再開されないため、
// 中断していたあいだに歩いた区間は残らない。「■ を押していないのに止まっていた」
// の切り分けに使う(この行があれば操作ではなくアプリの中断が原因)。
function logInterruptedTrackRecording() {
  let interrupted = false;
  try { interrupted = localStorage.getItem(TRACK_RECORDING_FLAG_KEY) === '1'; } catch { /* noop */ }
  if (!interrupted) return;
  writeTrackRecordingFlag(false);
  logHistory(t('track.interrupted'), 'error');
}

// 端末に保存してある移動経路を読み出して地図に表示する(起動時に1回)。
// 記録は再開しない(→ geolocation.js の restoreSavedTrack)ため、続きを記録するには
// 改めて記録開始ボタンを押し、「追加」を選ぶ。
// 何が表示されているのかが分かるよう、復元したときは履歴に残す。
// 地図は初期表示のまま(箕面大滝・z=15)にしておく。経路の位置へ勝手に飛ぶと、
// 起動画面の地図が前回の場所に変わってしまうため。
async function restoreTrackFromStorage() {
  const restored = await restoreSavedTrack();
  if (restored === 0) return;
  const stats = getTrackStats();
  logHistory(t('track.restored', { summary: formatTrackSummary(stats, 0, 1) }), '');
}

// 端末に保存してある写真を読み出して、撮影地点の印を地図に出す(起動時に1回)
async function restorePhotosFromStorage() {
  const restored = await restorePhotos();
  if (restored > 0) logHistory(t('photo.restored', { n: restored }), '');
}

// 表示中の経路(記録点)が1つでもあるか。クリア・出力・記録開始/読み込みの確認の要否に使う
function hasTrack() {
  return getTrackStats().pointCount > 0;
}

// ===== 経路を出力(GPX)したか =====
// 経路ごとには持たず、1つの印で全体を表す(1本でも未出力があれば全部を未出力として扱う。
// 出力は常に全部の経路をまとめて書き出すため、それで足りる)。
// 記録点が増えたら未出力、出力・クリア・置き換えの読み込みで出力済みにする。
// 印が無いとき(この印を入れる前から端末に残っている経路)は、念のため未出力とみなす。
function hasUnexportedTrack() {
  if (!hasTrack()) return false;
  try { return localStorage.getItem(TRACK_UNEXPORTED_KEY) !== '0'; } catch { return true; }
}

function setTrackUnexported(on) {
  try { localStorage.setItem(TRACK_UNEXPORTED_KEY, on ? '1' : '0'); } catch { /* noop */ }
}

// 記録地点数・移動距離の統計文言(履歴・トースト用。距離は統計表と同じ小数点以下1位)。
// 経路が複数あるときは「経路 n:」を先頭に付ける。地点数0の経路は残らないため番号は付けない。
function formatTrackSummary(stats, index, total) {
  const km = (stats.distanceM / 1000).toFixed(1);
  const summary = t('track.summary', { points: stats.pointCount, km });
  if (total <= 1 || stats.pointCount === 0) return summary;
  return `${t('track.routeIndex', { n: index + 1 })}: ${summary}`;
}

// ===== レイヤーパネルの移動経路・写真の表示 =====
// 両方をまとめて最新化する(起動時・パネルを開いたとき)
function updateDataPanels() {
  updateTrackPanel();
  updatePhotoPanel();
}

// トグルの右に添える出力済みかどうか(「未出力あり」「出力済み」)。データが無ければ出さない
function setToggleStatus(elem, hasData, unexported) {
  if (!elem) return;
  elem.hidden = !hasData;
  elem.classList.toggle('is-unexported', hasData && unexported);
  elem.textContent = hasData ? t(unexported ? 'common.unexported' : 'common.exported') : '';
}

// 移動経路: トグルの右の出力済みかどうかと、トグル ON のときだけ出す統計表・ボタン行
function updateTrackPanel() {
  const on = !!el.toggleTrackRecording?.checked;
  if (el.trackStats) el.trackStats.hidden = !on;
  if (el.trackActions) el.trackActions.hidden = !on;
  // 記録開始直後の地点数0の経路だけのときは出さない(まだ何も無いため)
  setToggleStatus(el.trackStatus, hasTrack(), hasUnexportedTrack());
  if (on) renderTrackStats();
}

// 写真: トグルの右の出力済みかどうかと、トグル ON のときだけ出す統計(枚数)・ボタン行
function updatePhotoPanel() {
  // 写真が減って警告の枚数を下回ったら、次に達したときにまた警告する
  if (getPhotoCount() < photoWarnCount()) photosNearLimitWarned = false;
  const on = !!el.togglePhotoCapture?.checked;
  if (el.photoStats) el.photoStats.hidden = !on;
  if (el.photoActions) el.photoActions.hidden = !on;
  const count = getPhotoCount();
  setToggleStatus(el.photoStatus, count > 0, hasUnexportedPhotos());
  // 経路の統計と同じ形(ラベル+値の1組)で枚数を出す。写真が無いときも 0 を出す
  if (on && el.photoStats) {
    el.photoStats.replaceChildren(buildTrackStatPair(t('photo.statCount'), t('photo.statCountValue', { n: count })));
  }
}

// レイヤーパネル内の統計表を描く。経路1本につき1行で、経路が複数あるときだけ
// 行の左に「経路 n」を添える。
function renderTrackStats() {
  if (!el.trackStats) return;
  const list = getTrackStatsList();
  // 経路が無いときも 0 の行を1行出す(表の枠が消えて見えなくなるのを避ける)
  const rows = list.length > 0 ? list : [{ pointCount: 0, distanceM: 0 }];
  const showIndex = rows.length > 1;
  el.trackStats.classList.toggle('has-index', showIndex);
  el.trackStats.innerHTML = '';
  rows.forEach((stats, i) => {
    if (showIndex) {
      el.trackStats.appendChild(
        buildTrackStatCell('track-stat-index', t('track.routeIndex', { n: i + 1 }))
      );
    }
    el.trackStats.appendChild(buildTrackStatPair(t('track.statPoints'), String(stats.pointCount)));
    el.trackStats.appendChild(
      buildTrackStatPair(t('track.statDistance'), `${(stats.distanceM / 1000).toFixed(1)} (km)`)
    );
  });
}

// 統計表のセル(「経路 n」など、ラベル単体のもの)
function buildTrackStatCell(className, text) {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

// 統計表のセル(「地点数 12」のようなラベル+値の1組)
function buildTrackStatPair(label, value) {
  const wrap = document.createElement('span');
  wrap.className = 'track-stat';
  wrap.appendChild(buildTrackStatCell('track-stat-label', label));
  wrap.appendChild(buildTrackStatCell('track-stat-value', value));
  return wrap;
}

// ===== 表示中の経路があるときの選択(クリア/追加/中止) =====
// 記録開始と読み込みで同じモーダルを共用する。中止(キャンセル・×・背景)を選べるよう
// confirm ではなくモーダルにしており、閉じただけのときは何もしない。
// どちらのボタンが押されたかを判断するため、開いた用途を保持する。
let trackExistingMode = null;  // 'record' | 'import'

function openTrackExistingModal(mode) {
  trackExistingMode = mode;
  const isRecord = mode === 'record';
  el.trackExistingTitle.textContent = t(isRecord ? 'track.existingTitleRecord' : 'track.existingTitleImport');
  // 出力していない経路があれば、先に出力するよう添える
  const routes = getTrackStatsList().length;
  let message = t('track.existingMessage', { routes });
  if (hasUnexportedTrack()) message += `\n${t('track.unexportedWarning')}`;
  el.trackExistingMessage.textContent = message;
  el.btnTrackExistingClear.textContent = t(isRecord ? 'track.existingClearRecord' : 'track.existingClearImport');
  el.btnTrackExistingAppend.textContent = t(isRecord ? 'track.existingAppendRecord' : 'track.existingAppendImport');
  el.trackExistingModal.hidden = false;
}

// クリア/追加のどちらかが選ばれたとき: モーダルを閉じて、開いた用途の操作を続行する。
// ファイル選択(input.click())はこのクリック操作の延長で呼ぶ必要があるため同期的に進める。
function resolveTrackExisting(append) {
  const mode = trackExistingMode;
  trackExistingMode = null;
  closeModal(el.trackExistingModal);
  if (mode === 'record') startTrackRecordingNow(append);
  else if (mode === 'import') openTrackImportPicker(append);
}

// 移動記録を開始(記録開始ボタン)。既存の経路が表示されている場合は、
// クリア/追加/中止をモーダルで選んでから開始する(→ resolveTrackExisting)。
function beginTrackRecording() {
  if (hasTrack()) {
    openTrackExistingModal('record');
    return;
  }
  startTrackRecordingNow(false);
}

// 実際に記録を開始する。開始を履歴に残す。
// 軌跡は「クリア」まで移動記録と共に保持するため、追加時(append)はそのまま残す。
function startTrackRecordingNow(append) {
  startTrackRecording({ append });
  setTrackRecordingActive(true);
  isTrackRecording = true;
  writeTrackRecordingFlag(true);
  // クリアして開始した場合は統計表も 0 に戻す
  updateTrackPanel();
  logHistory(t('track.started'), 'success');
  showToast(t('track.started'));
}

// ===== 移動記録の停止(長押し → 確認) =====
// 記録中は画面が消えないため、ポケットの中で布越しに触れて記録停止ボタン(■)が押され、
// 停止の確認が出たままになることがあった。そこで停止は■の長押し(TRACK_STOP_HOLD_MS)に限り、
// 確認は操作が無ければ TRACK_STOP_CONFIRM_SEC 秒で閉じて記録を続ける。
// 確認を標準の confirm にしないのは、表示中はページの処理が止まり位置が記録されないため。
// このボタンはメニューボタン(≡)のすぐ左(間隔 8px)にあり、≡ を狙った指が触れることもある。
// 停止すると記録中の経路がその場で確定し、押す前の状態には戻せない
// (再開しても別の経路として記録される)。開始は取り消せるので長押しも確認も要らない。
let trackStopHoldTimer = null;       // 長押しの判定タイマー
let trackStopHoldFired = false;      // 長押しで確認を出した(指を離したときの click を無視する)
let trackStopBy = null;              // 停止の確認を開いた操作(履歴用の文言キー)
let trackStopAutoCloseTimer = null;  // 停止の確認を自動で閉じるタイマー

function bindTrackStopHold() {
  const btn = el.btnTrackToggle;
  if (!btn) return;
  btn.style.setProperty('--hold-ms', `${TRACK_STOP_HOLD_MS}ms`);
  const cancelHold = () => {
    clearTimeout(trackStopHoldTimer);
    trackStopHoldTimer = null;
    btn.classList.remove('is-holding');
  };
  btn.addEventListener('pointerdown', (e) => {
    if (!isTrackRecording || btn.hidden || e.button !== 0) return;
    cancelHold();
    trackStopHoldFired = false;
    btn.classList.add('is-holding');
    trackStopHoldTimer = setTimeout(() => {
      cancelHold();
      trackStopHoldFired = true;
      openTrackStopModal('track.stopByButton');
    }, TRACK_STOP_HOLD_MS);
  });
  // 指を離す・ボタンの外へずらす・地図の操作などに取られたら、長押しをやめる
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) {
    btn.addEventListener(type, cancelHold);
  }
  // 長押しで出る端末のメニュー(コンテキストメニュー)を出さない
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  // 長押しで確認を出した後、指を離したときの click を捨てる。端末によっては、指の下に
  // 現れた確認の背景(押すと閉じる)へ click が届き、出した確認がすぐ閉じてしまうため。
  // click が来ないまま次の操作に移ったときは、その pointerdown で印を降ろす
  document.addEventListener('pointerdown', () => { trackStopHoldFired = false; }, true);
  document.addEventListener('click', (e) => {
    if (!trackStopHoldFired || e.detail === 0) return;
    trackStopHoldFired = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
}

// 停止の確認を開く。stopBy は履歴に添える操作の文言キー
function openTrackStopModal(stopBy) {
  if (!isTrackRecording) return;
  trackStopBy = stopBy;
  el.trackStopAutoClose.textContent = t('track.stopAutoClose', { sec: TRACK_STOP_CONFIRM_SEC });
  el.trackStopModal.hidden = false;
  clearTimeout(trackStopAutoCloseTimer);
  trackStopAutoCloseTimer = setTimeout(() => closeModal(el.trackStopModal), TRACK_STOP_CONFIRM_SEC * 1000);
}

// 停止の確認で「停止する」が選ばれたとき
function confirmTrackStop() {
  const stopBy = trackStopBy;
  closeModal(el.trackStopModal);
  if (!isTrackRecording) return;
  finishTrackRecording(stopBy);
  // トグルのオフから開いたときは、ここでトグルを OFF にして保存する
  if (stopBy === 'track.stopByToggle') {
    el.toggleTrackRecording.checked = false;
    updateTrackButtonState(false);
    saveMapToggles();
  }
}

// 移動記録を終了(記録停止ボタン/トグルOFF)。記録中だったときのみ、いま記録していた経路の
// 地点数・移動距離を履歴とトーストに出す(記録中の経路は常に最後の経路)。
// 軌跡が消去される前に統計を取得する必要がある点に注意。
// stopBy には停止のきっかけとなった操作の文言キー('track.stopByButton' / 'track.stopByToggle')を
// 渡し、履歴にだけ添える(「操作していないのに止まっていた」ときの切り分け用。
// トーストは操作直後に本人が見るものなので付けない)。
function finishTrackRecording(stopBy) {
  const wasRecording = isTrackRecording;
  const list = getTrackStatsList();
  const stats = list[list.length - 1] || { pointCount: 0, distanceM: 0 };
  stopTrackRecording();
  setTrackRecordingActive(false);
  isTrackRecording = false;
  writeTrackRecordingFlag(false);
  if (wasRecording) {
    const summary = formatTrackSummary(stats, list.length - 1, list.length);
    const history = stopBy
      ? t('track.finishedBy', { by: t(stopBy), summary })
      : t('track.finished', { summary });
    logHistory(history, 'success');
    showToast(t('track.finished', { summary }));
  }
  // 地点数0で終わった経路は破棄されるため、統計表を取り直す
  updateTrackPanel();
  // 軌跡は「クリア」まで保持するため、ここではリセットしない。
}

// ===== 出力のファイル名 =====
// ファイル名は yyyymmdd-nn を既定とする。日付は経路なら記録開始の当日(最初の記録点の記録日)、
// 写真なら最初の写真の撮影日(時刻が無い場合のみ今日の日付で代替)。
// 連番は経路(GPX)と写真(KMZ)で別々に数える。同じ日に1回ずつ出力すると名前がそろう。
function formatDateStr(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function getTrackDateStr() {
  const first = getTrackSegments()[0]?.[0];
  return formatDateStr(first?.timeMs || Date.now());
}

function getPhotoDateStr() {
  return formatDateStr(getPhotos().find((p) => p.timeMs)?.timeMs || Date.now());
}

// 連番のデフォルト値: 同日の前回出力の連番 +1(保存が無い・日付が違うときは 01)。
// key は経路なら TRACK_EXPORT_SEQ_KEY、写真なら PHOTO_EXPORT_SEQ_KEY
function readNextExportSeq(key, dateStr) {
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (saved && saved.date === dateStr && Number.isInteger(saved.seq)) return saved.seq + 1;
  } catch { /* 保存なし・不正値は 01 から */ }
  return 1;
}

// 出力に使ったファイル名から日付と連番を取り出して保存する(次回デフォルトの決定用)。
// 既定の書式(yyyymmdd-連番)から外れた自由入力のときは保存しない(連番の並びに影響させない)。
// 日付部分も編集できるため、記録日と違う日付で出力した場合はその日付で保存する
// (次回は記録日で照合するため既定は 01 に戻る)。
function writeExportSeq(key, name) {
  const m = /^(\d{8})-(\d+)$/.exec(name);
  if (!m) return;
  try {
    localStorage.setItem(key, JSON.stringify({ date: m[1], seq: parseInt(m[2], 10) }));
  } catch { /* noop */ }
}

// 既定のファイル名(yyyymmdd-nn)
function defaultExportName(key, dateStr) {
  return `${dateStr}-${String(readNextExportSeq(key, dateStr)).padStart(2, '0')}`;
}

// 出力モーダルを開き、ファイル名の欄に既定の名前を入れる。拡張子を除く全体を編集できる。
// 開いた直後は未選択(全選択しない)にして、編集位置(キャレット)を末尾に置く。
function openExportNameModal(modal, input, name) {
  input.value = name;
  modal.hidden = false;
  input.focus();
  // focus() 時の選択状態はブラウザ依存のため、明示的に選択なし・キャレット末尾にする
  input.setSelectionRange(name.length, name.length);
}

// 入力されたファイル名を整える。ファイル名に使えない文字は除去し、拡張子まで入力された場合は
// 二重に付かないよう落とす。末尾に空白があると拡張子を末尾と判定できないため、
// 除去 → trim → 拡張子落とし の順に行う。空なら '' を返す
function readExportName(input) {
  return input.value
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
    .replace(/\.(gpx|kmz)$/i, '')
    .trim();
}

// Blob をファイルとしてダウンロードさせる(GPX・KMZ で共用)
function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  // click 直後の revoke はダウンロード開始前に無効化される場合があるため遅延させる
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ===== 移動経路の出力(GPX) =====
// 出力モーダルを開く。出力していない写真があるときは、写真の出し忘れの案内を添える
// (写真は写真の「出力」から別に出力する)。
function openTrackExportModal() {
  if (!hasTrack()) {
    showToast(t('track.nothingToExport'));
    return;
  }
  if (el.trackExportPhotoNote) {
    const unexportedPhotos = hasUnexportedPhotos();
    el.trackExportPhotoNote.hidden = !unexportedPhotos;
    el.trackExportPhotoNote.textContent = unexportedPhotos ? t('track.exportPhotoNote', { n: getPhotoCount() }) : '';
  }
  openExportNameModal(el.trackExportModal, el.trackExportName,
    defaultExportName(TRACK_EXPORT_SEQ_KEY, getTrackDateStr()));
}

// GPX 1.1 文字列を生成(トラック1本・経路1本ごとに trkseg 1本、各点に記録時刻を含む)。
// 経路を trkseg で分けるため、出力した GPX を読み込み直すと同じ経路構成に戻る。
// 記録点に名前があれば <name> で付ける(GPX 1.1 の順序は <time> の後)。名前は読み込んだ GPX に
// 付いていたものだけ(以前の版が撮影地点に付けた写真の名前など)で、本アプリの記録では付けない。
function buildTrackGpx(segments, name) {
  const esc = (s) => String(s)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const trksegs = segments.map((points) => {
    const trkpts = points.map((p) => {
      const time = p.timeMs ? `<time>${new Date(p.timeMs).toISOString()}</time>` : '';
      const pointName = p.name ? `<name>${esc(p.name)}</name>` : '';
      return `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}">${time}${pointName}</trkpt>`;
    }).join('\n');
    return `    <trkseg>\n${trkpts}\n    </trkseg>`;
  }).join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<gpx version="1.1" creator="minoh-hiking" xmlns="http://www.topografix.com/GPX/1/1">\n' +
    '  <trk>\n' +
    `    <name>${esc(name)}</name>\n` +
    `${trksegs}\n` +
    '  </trk>\n' +
    '</gpx>\n';
}

// 出力ボタン: GPX を生成してダウンロードし、連番を保存して出力済みにし、モーダルを閉じる
function handleTrackExportSave() {
  const name = readExportName(el.trackExportName);
  if (!name) {
    showToast(t('track.exportNeedName'));
    return;
  }
  const segments = getTrackSegments().filter((seg) => seg.length > 0);
  if (segments.length === 0) {
    showToast(t('track.nothingToExport'));
    closeModal(el.trackExportModal);
    return;
  }
  const fileName = `${name}.gpx`;
  downloadBlob(new Blob([buildTrackGpx(segments, name)], { type: 'application/gpx+xml' }), fileName);
  writeExportSeq(TRACK_EXPORT_SEQ_KEY, name);
  setTrackUnexported(false);
  updateTrackPanel();
  logHistory(t('track.exported', { name: fileName }), 'success');
  showToast(t('track.exported', { name: fileName }));
  closeModal(el.trackExportModal);
}

// ===== 写真の出力(KMZ) =====
// KMZ を組み立てるには写真の画像を読み出す必要があり、これは非同期の処理になる。
// 待ってからダウンロードすると、端末によっては操作の続きと見なされず止められるため、
// 出力モーダルを開いた時点で読み出しを始め、ボタンを押したときは同期的にダウンロードする。
let photoBytes = null;          // 読み出した画像(photoBytesFor と同順)
let photoBytesFor = null;       // 読み出した対象の写真の一覧
let photoBytesLoading = null;   // 読み出し中の Promise

// 写真の画像の読み出しを始める(済んでいれば何もしない)。済んだら resolve する
function preparePhotoBytes() {
  if (photoBytes || photoBytesLoading) return photoBytesLoading || Promise.resolve();
  const targets = getPhotos();
  const loading = loadPhotoBytes(targets).then((bytes) => {
    if (photoBytesLoading !== loading) return;   // 途中で捨てられた
    photoBytes = bytes;
    photoBytesFor = targets;
    photoBytesLoading = null;
  }).catch((err) => {
    if (photoBytesLoading === loading) photoBytesLoading = null;
    const msg = t('photo.exportFailed', { message: err?.message || err?.name || '' });
    logHistory(msg, 'error');
    showToast(msg);
  });
  photoBytesLoading = loading;
  return loading;
}

// 読み出した画像を捨てる(出力モーダルを閉じたとき。大きいため持ち続けない)
function releasePhotoBytes() {
  photoBytes = null;
  photoBytesFor = null;
  photoBytesLoading = null;
}

// 写真の出力モーダルを開く。画像の読み出しが済むまで「出力」は押せない
function openPhotoExportModal() {
  if (getPhotoCount() === 0) {
    showToast(t('photo.nothingToExport'));
    return;
  }
  el.btnPhotoExportSave.disabled = !photoBytes;
  openExportNameModal(el.photoExportModal, el.photoExportName,
    defaultExportName(PHOTO_EXPORT_SEQ_KEY, getPhotoDateStr()));
  preparePhotoBytes().then(() => {
    if (!el.photoExportModal.hidden) el.btnPhotoExportSave.disabled = !photoBytes;
  });
}

// 出力ボタン: KMZ を組み立ててダウンロードし、連番を保存してモーダルを閉じる
function handlePhotoExportSave() {
  const name = readExportName(el.photoExportName);
  if (!name) {
    showToast(t('track.exportNeedName'));
    return;
  }
  // 押したときに同期的にダウンロードするため、画像の読み出しが済んでいなければ待ってもらう
  if (!photoBytes) {
    showToast(t('photo.exportPreparing'));
    return;
  }
  if (exportPhotosKmz(name)) writeExportSeq(PHOTO_EXPORT_SEQ_KEY, name);
  closeModal(el.photoExportModal);
}

// 写真の KMZ を組み立ててダウンロードし、出力済みにする(読み出し済みの画像を使い、同期的に行う)。
// 出力できたら true を返す
function exportPhotosKmz(name) {
  if (!photoBytes || !photoBytesFor) {
    showToast(t('photo.exportPreparing'));
    return false;
  }
  const fileName = `${name}.kmz`;
  try {
    downloadBlob(buildPhotosKmz(photoBytesFor, photoBytes, name), fileName);
  } catch (err) {
    const msg = t('photo.exportFailed', { message: err?.message || err?.name || '' });
    logHistory(msg, 'error');
    showToast(msg);
    return false;
  } finally {
    releasePhotoBytes();
  }
  markPhotosExported();
  logHistory(t('photo.exported', { name: fileName }), 'success');
  showToast(t('photo.exported', { name: fileName }));
  return true;
}

// ===== 移動経路の読み込み(GPX) =====
// 既存の経路をクリアするか追加するかの選択。選択はファイル選択より前に行うため、
// 結果をここで保持してファイル選択後の処理(importTrackFile)へ引き継ぐ。
let importAppend = false;

// ファイル選択ダイアログを開く。append は選択後の反映方法として保持する。
function openTrackImportPicker(append) {
  importAppend = append;
  // 同じファイルを続けて選べるよう、選択値を毎回クリアしてから開く
  el.trackImportInput.value = '';
  el.trackImportInput.click();
}

// GPX 文字列から移動経路を取り出し、経路ごとの点列の配列で返す(<time> と <name> は任意)。
// trkseg 1本を1本の経路として扱うため、記録を分けて出力した GPX
// (本アプリの複数経路出力を含む)をそのまま複数の経路として復元できる。
// <name> は記録点の名前(以前の版が撮影地点に付けた写真の名前など)で、そのまま保持して再出力に戻す。
function parseTrackGpx(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error(t('track.importInvalidXml'));
  const toPoints = (nodes) => [...nodes]
    .map((node) => {
      const timeText = node.getElementsByTagName('time')[0]?.textContent;
      const ms = timeText ? Date.parse(timeText) : NaN;
      const nameText = node.getElementsByTagName('name')[0]?.textContent.trim();
      return {
        lat: parseFloat(node.getAttribute('lat')),
        lng: parseFloat(node.getAttribute('lon')),
        timeMs: Number.isFinite(ms) ? ms : null,
        name: nameText || null
      };
    })
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

  const segments = [...doc.getElementsByTagName('trkseg')]
    .map((seg) => toPoints(seg.getElementsByTagName('trkpt')))
    .filter((points) => points.length > 0);
  if (segments.length > 0) return segments;
  // trkseg を持たない GPX への保険: 文書順の trkpt を1本の経路として扱う
  const all = toPoints(doc.getElementsByTagName('trkpt'));
  return all.length > 0 ? [all] : [];
}

// 読み込みの失敗を履歴とトーストで知らせる(経路・写真で共用)
function reportImportFailure(err) {
  const msg = t('track.importFailed', { message: err?.message || err?.name || '' });
  logHistory(msg, 'error');
  showToast(msg);
}

// ファイル選択後: GPX を移動経路として表示する。事前に選んだ「クリア/追加」に従う。
// KMZ(写真)を選んだときは、写真の「読み込み」を案内して何もしない。
// クリアして読み込んだ経路はファイルが手元にあるため出力済みとし、追加のときは元の印のままにする。
async function importTrackFile(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  try {
    if (await isZipFile(file)) {
      showToast(t('track.importIsKmz'));
      return;
    }
    const segments = parseTrackGpx(await file.text());
    if (segments.length === 0) {
      showToast(t('track.importNoPoints'));
      return;
    }
    const count = loadTrackSegments(segments, { append: importAppend });
    if (!importAppend) setTrackUnexported(false);
    // 読み込んだ経路は記録済みの状態として扱い(記録開始ボタンは停止表示に戻す)、
    // 統計表を更新して、読み込んだものが見えるようメニューを閉じて全体を表示する
    isTrackRecording = false;
    writeTrackRecordingFlag(false);
    setTrackRecordingActive(false);
    updateTrackPanel();
    el.mapLayerPanel.hidden = true;
    fitMapToTrack();
    // 経路が複数含まれていた場合は経路数も添える
    const msg = segments.length > 1
      ? t('track.importedMulti', { name: file.name, routes: segments.length, count })
      : t('track.imported', { name: file.name, count });
    logHistory(msg, 'success');
    showToast(msg);
  } catch (err) {
    reportImportFailure(err);
  }
}

// ===== 表示中の写真があるときの選択(クリア/追加/中止) =====
// その日の最初の撮影(カメラボタン)と、写真の読み込みで同じモーダルを共用する。
// 閉じただけ(キャンセル・×・背景)のときは何もしない。開いた用途を保持する。
let photoExistingMode = null;  // 'shoot' | 'import'

function openPhotoExistingModal(mode) {
  photoExistingMode = mode;
  const isShoot = mode === 'shoot';
  el.photoExistingTitle.textContent = t(isShoot ? 'photo.existingTitleShoot' : 'photo.existingTitleImport');
  // 出力していない写真があれば、先に出力するよう添える
  let message = t('photo.existingMessage', { n: getPhotoCount() });
  if (hasUnexportedPhotos()) message += `\n${t('photo.unexportedWarning')}`;
  el.photoExistingMessage.textContent = message;
  el.btnPhotoExistingClear.textContent = t(isShoot ? 'photo.existingClearShoot' : 'photo.existingClearImport');
  el.btnPhotoExistingAppend.textContent = t(isShoot ? 'photo.existingAppendShoot' : 'photo.existingAppendImport');
  el.mapLayerPanel.hidden = true;
  el.photoExistingModal.hidden = false;
}

// クリア/追加のどちらかが選ばれたとき: モーダルを閉じて、開いた用途の操作を続行する。
// 撮影でクリアを選んだときは、ここで写真を消してからカメラを開く。
// 読み込みでクリアを選んだときは、ファイルを読めてから消す(→ importPhotoKmz)。
// ファイル選択・カメラの起動はこのクリック操作の延長で呼ぶため同期的に進める。
function resolvePhotoExisting(append) {
  const mode = photoExistingMode;
  closeModal(el.photoExistingModal);
  if (mode === 'shoot') {
    writeShootConfirmedDate(formatDateStr(Date.now()));
    if (!append) {
      clearPhotos();
      logHistory(t('photo.cleared'), '');
    }
    openPhotoCameraNow();
  } else if (mode === 'import') {
    openPhotoImportPicker(append);
  }
}

// ===== 写真の読み込み(KMZ) =====
// 既存の写真をクリアするか追加するかの選択(ファイル選択の前に選び、選択後の処理へ引き継ぐ)
let photoImportAppend = false;

function openPhotoImportPicker(append) {
  photoImportAppend = append;
  el.photoImportInput.value = '';
  el.photoImportInput.click();
}

// ファイル選択後: KMZ から写真を読み込む。GPX など KMZ 以外を選んだときは、
// 経路の「読み込み」を案内して何もしない
async function importPhotoFile(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  try {
    if (!(await isZipFile(file))) {
      showToast(t('photo.importIsNotKmz'));
      return;
    }
    await importPhotoKmz(file, { append: photoImportAppend });
  } catch (err) {
    reportImportFailure(err);
  }
}

// KMZ から写真を読み込んで地図に出す。append=false なら写真を消してから読み込む(経路には触れない)。
// 読み込んだ写真はファイルが手元にあるため出力済みのまま(未出力の写真に追加したときは未出力のまま)。
async function importPhotoKmz(file, { append }) {
  const items = await parsePhotosKmz(await file.arrayBuffer());
  if (items.length === 0) {
    showToast(t('photo.importNoPhotos'));
    return;
  }
  if (!append) await clearPhotos();
  let result;
  try {
    result = await importPhotos(items, (n) => t('photo.defaultName', { n }));
  } finally {
    // 読み込んだものが見えるよう、メニューを閉じて写真の全体を表示する
    el.mapLayerPanel.hidden = true;
    fitMapToPhotos();
  }
  const msg = result.skipped > 0
    ? t('photo.importedLimited', { name: file.name, n: result.added, skipped: result.skipped, max: PHOTO_MAX_COUNT })
    : t('photo.imported', { name: file.name, n: result.added });
  logHistory(msg, 'success');
  showToast(msg);
  // 読み込み結果のトーストが読めるよう、警告のトーストはその後に出す
  warnIfPhotosNearLimit({ delayToast: true });
}

// ===== 写真の枚数が上限に近づいたときの警告 =====
// 上限(PHOTO_MAX_COUNT)の PHOTO_WARN_RATIO に達したら、保存(撮影・読み込み)の後に
// メッセージ履歴とトーストで知らせる。何度も出さないよう、達したときに1回だけ出し、
// 写真が減って下回ったら(削除・クリア → updatePhotoPanel)また出せるようにする。
// アプリを開き直したときは、達したままでも次の保存で1回出す(覚えるのはこの起動の間だけ)。
let photosNearLimitWarned = false;

function photoWarnCount() {
  return Math.ceil(PHOTO_MAX_COUNT * PHOTO_WARN_RATIO);
}

// 警告を出したら true を返す。delayToast は、直前のトーストを読める間をおいてから出すとき
function warnIfPhotosNearLimit({ delayToast = false } = {}) {
  const n = getPhotoCount();
  if (photosNearLimitWarned || n < photoWarnCount()) return false;
  photosNearLimitWarned = true;
  const msg = t('photo.nearLimit', { n, max: PHOTO_MAX_COUNT, percent: Math.round(PHOTO_WARN_RATIO * 100) });
  logHistory(msg, 'error');
  if (delayToast) setTimeout(() => showToast(msg), (TOAST_DURATION_SEC + 0.5) * 1000);
  else showToast(msg);
  return true;
}

// ===== 写真の撮影(アプリ内カメラ) =====
// カメラボタンの表示: 「写真を撮影」ON のときだけ出す(アプリ内カメラが使えない端末では出さない)
function updatePhotoButtonState(enabled) {
  if (el.btnPhotoCamera) el.btnPhotoCamera.hidden = !enabled || !isCameraSupported();
}

// 表示中の写真について「クリア/追加」を確認した日(yyyymmdd)。
// localStorage が使えない環境では、この変数だけで覚える(その間はアプリを開き直すと聞き直す)
let shootConfirmedDate = null;

function readShootConfirmedDate() {
  try { return localStorage.getItem(PHOTO_SHOOT_CONFIRMED_KEY); } catch { return shootConfirmedDate; }
}

function writeShootConfirmedDate(dateStr) {
  shootConfirmedDate = dateStr;
  try {
    if (dateStr) localStorage.setItem(PHOTO_SHOOT_CONFIRMED_KEY, dateStr);
    else localStorage.removeItem(PHOTO_SHOOT_CONFIRMED_KEY);
  } catch { /* noop */ }
}

// 撮影中(位置の取得・保存が終わっていない)の枚数。上限の判定と既定の名前の番号に含める
let pendingShots = 0;

// カメラボタン: 写真が残っていて、その日まだ確認していなければ、先に「クリア/追加」を選んでもらう
// (前回の山行の写真に混ぜないため)。同じ日の2回目以降は聞かずにカメラを開く。
function openPhotoCamera() {
  if (el.btnPhotoCamera.hidden) return;
  const today = formatDateStr(Date.now());
  if (getPhotoCount() > 0 && readShootConfirmedDate() !== today) {
    openPhotoExistingModal('shoot');
    return;
  }
  writeShootConfirmedDate(today);
  openPhotoCameraNow();
}

// アプリ内カメラを開く。上限に達していれば開かずに知らせる
function openPhotoCameraNow() {
  if (getPhotoCount() >= PHOTO_MAX_COUNT) {
    showToast(t('photo.limitReached', { max: PHOTO_MAX_COUNT }));
    return;
  }
  el.mapLayerPanel.hidden = true;
  const photos = getPhotos();
  openCamera({
    // 既に撮った写真があれば、開いた時点で最後の1枚をサムネイルに出す
    lastPhoto: photos.length > 0 ? photos[photos.length - 1].blob : null,
    canShoot: () => {
      if (getPhotoCount() + pendingShots < PHOTO_MAX_COUNT) return true;
      setCameraStatus(t('photo.limitReached', { max: PHOTO_MAX_COUNT }));
      return false;
    },
    onShot: handlePhotoShot,
    // サムネイル: 最後の写真を開く(前後の写真へは写真の表示の矢印ボタンで移る)
    onThumb: () => {
      const list = getPhotos();
      if (list.length > 0) openPhotoView(list[list.length - 1].id);
    },
    onError: (msg) => {
      logHistory(msg, 'error');
      showToast(msg);
    },
    onIdleClose: () => showToast(t('camera.idleClosed'))
  });
}

// 撮った1枚を保存する: 位置を取り直してから写真を保存する(移動経路には何も書かない)。
// 位置が分からないときは保存しない(撮影地点の無い写真は地図に出せず、KMZ にも書けないため)
async function handlePhotoShot({ blob, timeMs }) {
  const name = t('photo.defaultName', { n: getPhotoCount() + pendingShots + 1 });
  pendingShots++;
  setCameraStatus(t('photo.locating', { name }));
  try {
    const latlng = await capturePhotoPosition();
    if (!latlng) {
      const msg = t('photo.noPosition');
      setCameraStatus(msg);
      logHistory(msg, 'error');
      showToast(msg);
      return;
    }
    await addPhoto({ name, timeMs, lat: latlng[0], lng: latlng[1], blob });
    setCameraStatus(t('photo.saved', { name }));
    logHistory(t('photo.saved', { name }), 'success');
    // 上限に近づいたら警告する(カメラの上にもトーストで出す)。警告を出したときは保存のトーストは省く
    const warned = warnIfPhotosNearLimit();
    // 撮影後にカメラが自動で閉じた後で保存が終わったときは、地図の上で知らせる
    if (!warned && !isCameraOpen()) showToast(t('photo.saved', { name }));
  } catch (err) {
    // 保存できなかった(容量不足など)
    const msg = t('photo.saveFailed', { message: err?.message || err?.name || '' });
    setCameraStatus(msg);
    logHistory(msg, 'error');
    showToast(msg);
  } finally {
    pendingShots--;
    updatePhotoPanel();
  }
}

// ===== 写真の表示(名前の変更) =====
let viewingPhotoId = null;
let viewingPhotoUrl = null;

// 撮影日時の表示(端末の現地時刻。言語に合わせた書式)
function formatPhotoTime(ms) {
  if (!Number.isFinite(ms)) return t('photo.takenAtUnknown');
  const time = new Date(ms).toLocaleString(getLang() === 'en' ? 'en-US' : 'ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });
  return t('photo.takenAt', { time });
}

// 写真の表示を開く(地図のカメラの印・カメラ画面のサムネイルから)
function openPhotoView(id) {
  if (!showPhotoInView(id)) return;
  el.mapLayerPanel.hidden = true;
  el.photoViewModal.hidden = false;
}

// 写真の表示に1枚を出す(開くとき・矢印ボタンで前後へ移るとき)。
// 見出しに「何枚目/全何枚」(撮影・読み込みの順)を出し、端の写真では < / > を押せなくする
function showPhotoInView(id) {
  const photos = getPhotos();
  const index = photos.findIndex((p) => p.id === id);
  if (index < 0) return false;
  const photo = photos[index];
  releasePhotoView();
  viewingPhotoId = id;
  viewingPhotoUrl = URL.createObjectURL(photo.blob);
  el.photoViewImage.src = viewingPhotoUrl;
  el.photoViewImage.alt = photo.name;
  el.photoViewName.value = photo.name;
  el.photoViewMeta.textContent = formatPhotoTime(photo.timeMs);
  el.photoViewTitle.textContent = t('photo.viewTitleIndex', { n: index + 1, total: photos.length });
  el.btnPhotoViewPrev.disabled = index === 0;
  el.btnPhotoViewNext.disabled = index === photos.length - 1;
  return true;
}

// 左右の矢印ボタン: 入力中の名前を保存してから、前(step=-1)・次(step=1)の写真へ移る
function stepPhotoView(step) {
  const photos = getPhotos();
  const index = photos.findIndex((p) => p.id === viewingPhotoId);
  const target = photos[index + step];
  if (index < 0 || !target) return;
  commitPhotoViewName();
  showPhotoInView(target.id);
}

// 入力中の名前を保存する。空にされたときは元の名前に戻す。
// 名前を変えた写真は未出力に戻る(→ photos.js の renamePhoto)
function commitPhotoViewName() {
  const photo = viewingPhotoId ? getPhoto(viewingPhotoId) : null;
  if (!photo) return;
  const name = el.photoViewName.value.trim();
  if (!name) {
    el.photoViewName.value = photo.name;
    return;
  }
  if (name === photo.name) return;
  renamePhoto(photo.id, name).catch((err) => {
    const msg = t('photo.saveFailed', { message: err?.message || err?.name || '' });
    logHistory(msg, 'error');
    showToast(msg);
  });
  el.photoViewImage.alt = name;
}

// ごみ箱: 表示中の写真を確認のうえ削除し、次の写真(最後の写真なら前の写真)を表示する。
// 写真が無くなったら写真の表示を閉じる。入力中の名前は、消す写真のものなので保存しない
function deleteViewingPhoto() {
  const photo = viewingPhotoId ? getPhoto(viewingPhotoId) : null;
  if (!photo) return;
  if (!confirm(t('photo.deleteConfirm', { name: photo.name }))) return;
  const photos = getPhotos();
  const index = photos.findIndex((p) => p.id === photo.id);
  const next = photos[index + 1] || photos[index - 1] || null;
  deletePhoto(photo.id).catch((err) => {
    const msg = t('photo.deleteFailed', { message: err?.message || err?.name || '' });
    logHistory(msg, 'error');
    showToast(msg);
  });
  logHistory(t('photo.deleted', { name: photo.name }), '');
  showToast(t('photo.deleted', { name: photo.name }));
  if (next) showPhotoInView(next.id);
  else closeModal(el.photoViewModal);
}

// ===== 写真の一覧(タイル) =====
// 全部の写真を撮影・読み込みの順にタイル状に並べる。押した写真の表示を開く。
// タイルの画像は、一覧の中で見える位置に近づいたものから縮小画像を作って入れる
// (200枚を一度に展開しないため。縮小画像は photos.js の getPhotoThumbUrl)。
let photoListObserver = null;

function openPhotoList(currentId) {
  const photos = getPhotos();
  if (photos.length === 0) return;
  // 写真の表示から来たときは、入力中の名前を保存して閉じる(closeModal)
  if (!el.photoViewModal.hidden) closeModal(el.photoViewModal);
  releasePhotoList();
  el.photoListTitle.textContent = t('photo.listTitle', { n: photos.length });
  if ('IntersectionObserver' in window) {
    photoListObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        photoListObserver?.unobserve(entry.target);
        loadPhotoTile(entry.target);
      }
    }, { root: el.photoListBody, rootMargin: '200px 0px' });
  }
  let currentTile = null;
  const tiles = photos.map((photo) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'photo-list-tile';
    tile.dataset.photoId = photo.id;
    tile.setAttribute('aria-label', photo.name);
    tile.title = photo.name;
    const img = document.createElement('img');
    img.alt = '';
    const name = document.createElement('span');
    name.className = 'photo-list-name';
    name.setAttribute('aria-hidden', 'true');
    name.textContent = photo.name;
    tile.append(img, name);
    tile.addEventListener('click', () => {
      closeModal(el.photoListModal);
      openPhotoView(photo.id);
    });
    if (photo.id === currentId) {
      tile.classList.add('is-current');
      currentTile = tile;
    }
    return tile;
  });
  el.photoListGrid.replaceChildren(...tiles);
  el.mapLayerPanel.hidden = true;
  el.photoListModal.hidden = false;
  // 表示していた写真のタイルが見えるよう、一覧の中だけをスクロールする
  // (scrollIntoView は画面ごと動かすことがあるため使わない)
  el.photoListBody.scrollTop = 0;
  if (currentTile) {
    const offset = currentTile.getBoundingClientRect().top - el.photoListBody.getBoundingClientRect().top;
    el.photoListBody.scrollTop = Math.max(0, offset - el.photoListBody.clientHeight / 2 + currentTile.offsetHeight / 2);
  }
  for (const tile of tiles) {
    if (photoListObserver) photoListObserver.observe(tile);
    else loadPhotoTile(tile);
  }
}

// タイルに縮小画像を入れる(作り終えたときに一覧が閉じられていても害はない)
function loadPhotoTile(tile) {
  getPhotoThumbUrl(tile.dataset.photoId).then((url) => {
    if (url) tile.querySelector('img').src = url;
  });
}

// 一覧を閉じたとき: タイルの見張りを止め、タイルを取り除く
function releasePhotoList() {
  photoListObserver?.disconnect();
  photoListObserver = null;
  el.photoListGrid?.replaceChildren();
}

// 写真の表示を閉じたとき: 表示していた画像の URL を手放す
function releasePhotoView() {
  viewingPhotoId = null;
  if (viewingPhotoUrl) URL.revokeObjectURL(viewingPhotoUrl);
  viewingPhotoUrl = null;
  if (el.photoViewImage) el.photoViewImage.removeAttribute('src');
}

// ===== 更新版の確認(起動画面のボタンのタップ時) =====
// アプリと公開データの更新版を、同じきっかけでまとめて確認する
function checkForUpdates() {
  checkAppShellUpdate();
  checkPublishedDataUpdate();
}

// ===== 起動時のバージョン確認(履歴記録) =====
// 起動時に確認したバージョン(地図/アプリ)を履歴に残す
// onApplied はキャッシュ描画と更新取得のつど呼ばれるため、履歴への記録は1回に絞る
let startupVersionLogged = false;
function logStartupVersionCheckOnce() {
  if (startupVersionLogged) return;
  startupVersionLogged = true;
  logStartupVersionCheck();
}

async function logStartupVersionCheck() {
  const v = getManifestVersion();
  const mv = v ? `v${v}` : t('common.unknown');
  const shell = (await getCachedAppShellVersion()) || t('common.unknown');
  logHistory(t('startup.versionCheck', { map: mv, app: shell }), '');
}

// 起動
init();
