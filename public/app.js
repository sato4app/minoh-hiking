// アプリのエントリポイント
// - SPA ビュー切替(home / map / nav)+ 各モーダル
// - 現在地・移動記録(移動経路の記録)の操作の取りまとめ
// - 各機能モジュールの初期化と連携
//
// 機能別の実装は以下のモジュールに分離している:
//   tiles.js          … オフライン地図のDL・マニフェスト・更新バナー
//   update.js         … アプリシェルの更新確認
//   messages.js       … メッセージ履歴・トースト
//   marker-settings.js… マーカーの色・形状・サイズ設定
//   map.js            … Leaflet 地図・オーバーレイ
//   geolocation.js    … 現在地表示・移動経路の記録
//   closures.js       … 通行止め・通行困難地点の表示(公開API から取得)

import {
  initMap, resizeMap,
  loadEmergencyPointsLayer, setEmergencyPointsVisible,
  loadHikingRoutesLayer, setHikingRoutesVisible,
  setClosuresVisible, setClosureClosedStyle, setClosureDifficultStyle,
  setZoomDisplayVisible, getFeatureCounts
} from './map.js';
import {
  setLocationActiveForMapView, setCurrentMarkerVisible, setFollowCurrentLocation,
  setTrackStyle, setTrackStartStyle, setTrackCurrentStyle,
  startTrackRecording, stopTrackRecording, getTrackStats, getTrackStatsList,
  getTrackSegments, clearTrack, loadTrackSegments, fitMapToTrack,
  setOnTrackPointAppended, setOnTrackNotice
} from './geolocation.js';
import { loadClosures, getClosureVersion, getClosureCount } from './closures.js';
import {
  EMERGENCY_URL, HIKING_ROUTES_URL, TRACK_EXPORT_SEQ_KEY, REOPEN_APP_SETTINGS_KEY,
  TOAST_DURATION_SEC
} from './config.js';
import { getLang, setLang, t, applyStaticTranslations } from './i18n.js';
import { logHistory, renderMessageList, clearMessageLog, showToast } from './messages.js';
import {
  checkAppShellUpdate, promptAppShellUpdate, promptMapTileUpdate,
  readStartupUpdateCheckEnabled, writeStartupUpdateCheckEnabled,
  getCachedAppShellVersion
} from './update.js';
import {
  loadManifest, getManifestVersion, getSavedManifestVersion,
  evaluateManifestVersion, onSWControllerChange,
  openDownloadModal, refreshStorageInfo,
  migrateLegacyPackages, initTilesEvents, setStatus
} from './tiles.js';
import { readMarkerSettings, initMarkerSettings } from './marker-settings.js';

// ===== 状態 =====
let currentView = 'home';

// ===== DOM要素 =====
const el = {
  // ビュー
  views: {
    home: document.getElementById('viewHome'),
    map: document.getElementById('viewMap'),
    nav: document.getElementById('viewNav')
  },

  // ホーム
  btnOpenDownload: document.getElementById('btnOpenDownload'),
  btnOpenSettingsInfo: document.getElementById('btnOpenSettingsInfo'),
  btnOpenAppSettings: document.getElementById('btnOpenAppSettings'),

  // バージョン情報モーダル(起動画面の「バージョン情報」から表示)
  infoSettingsModal: document.getElementById('infoSettingsModal'),
  toggleStartupUpdateCheck: document.getElementById('toggleStartupUpdateCheck'),
  versionManifest: document.getElementById('versionManifest'),
  versionAppShell: document.getElementById('versionAppShell'),
  // 通行止め・通行困難地点のバージョン表示欄(バージョン情報内)
  versionClosures: document.getElementById('versionClosures'),

  // 設定モーダル(起動画面の「設定/Settings」から表示)
  appSettingsModal: document.getElementById('appSettingsModal'),
  languageSelect: document.getElementById('languageSelect'),
  toggleInfoMessages: document.getElementById('toggleInfoMessages'),
  infoMessagesBody: document.getElementById('infoMessagesBody'),
  toggleInfoAbout: document.getElementById('toggleInfoAbout'),
  infoAboutBody: document.getElementById('infoAboutBody'),
  btnClearMessages: document.getElementById('btnClearMessages'),
  btnOpenMarkerSettings: document.getElementById('btnOpenMarkerSettings'),

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
  // レイヤーパネル内: 移動経路の統計表(経路ごとの地点数・移動距離)・出力・クリア。
  // 統計は経路の本数に応じて app.js が組み立てる
  trackStats: document.getElementById('trackStats'),
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
  // 移動経路の出力(GPX)モーダル
  trackExportModal: document.getElementById('trackExportModal'),
  trackExportPrefix: document.getElementById('trackExportPrefix'),
  trackExportSuffix: document.getElementById('trackExportSuffix'),
  btnTrackExportSave: document.getElementById('btnTrackExportSave'),

  // マーカーの設定モーダル
  settingsModal: document.getElementById('settingsModal'),

  // マップ画面メニュー内の設定ショートカット
  btnMapOpenMarkerSettings: document.getElementById('btnMapOpenMarkerSettings')
};

// ===== 初期化 =====
async function init() {
  // 選択言語が英語のとき、静的なHTML文言(data-i18n属性)を一括置換する。
  // 以降の confirm・トースト等の動的文言より必ず先に適用する
  applyStaticTranslations();
  await loadManifest();

  // SW 登録 + 更新検知
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('service-worker.js');
    } catch (err) {
      console.warn('SW登録失敗:', err);
    }
    navigator.serviceWorker.addEventListener('controllerchange', onSWControllerChange);
  }

  bindEvents();
  initTilesEvents();
  initMarkerSettings();
  renderMessageList();
  // 言語変更によるリロード直後なら、設定モーダルを開いた状態に戻す
  restoreAppSettingsModalAfterReload();
  await migrateLegacyPackages();
  await refreshStorageInfo();
  evaluateManifestVersion();
  // 起動時に確認したバージョンを履歴に残す
  logStartupVersionCheck();
  // service-worker.js の SHELL_CACHE とキャッシュ済みバージョンを比較し
  // 不一致なら confirm を出してアプリ全体を最新に更新
  // (「起動時にアプリの更新版を確認」が ON のときのみ)
  if (readStartupUpdateCheckEnabled()) checkAppShellUpdate();

  // 共有地図を初期化(箕面大滝中心 / z=15、ホーム/マップで共通)
  initMap('map');
  // ズームレベル表示は「ズームレベルを表示」トグルの状態に従う
  setZoomDisplayVisible(el.toggleZoomDisplay.checked);
  // 各オーバーレイはバックグラウンドで読込み、map ビュー時のみ表示。
  // マーカースタイルは保存済み設定(無ければ config.js の既定値)を初期描画に反映。
  const markerSettings = readMarkerSettings();
  loadEmergencyPointsLayer(EMERGENCY_URL, markerSettings.emergency).then(() => {
    if (currentView === 'map') setEmergencyPointsVisible(true);
    updateFeatureCounts();
  });
  loadHikingRoutesLayer(HIKING_ROUTES_URL, markerSettings.hikingRoute, markerSettings.spot).then(() => {
    if (currentView === 'map') setHikingRoutesVisible(true);
    updateFeatureCounts();
  });
  // 通行止め・通行困難地点のマーカースタイルは読込前に設定しておく
  // (setClosureGeoJSON でのレイヤー構築時に反映される)
  setClosureClosedStyle(markerSettings.closureClosed);
  setClosureDifficultStyle(markerSettings.closureDifficult);
  loadClosures().then(() => {
    if (currentView === 'map') setClosuresVisible(true);
    updateFeatureCounts();
  });
  setTrackStyle(markerSettings.track);
  setTrackStartStyle(markerSettings.trackStart);
  setTrackCurrentStyle(markerSettings.trackCurrent);
  // 統計表の中身は経路の本数に応じて組み立てるため、初期状態(0件の1行)を描画しておく
  updateTrackStatsDisplay();

  // 初期表示はホーム(オーバーレイは非表示のまま)
  showView('home');
  requestAnimationFrame(() => resizeMap());
}

function bindEvents() {
  // ホームメニュー: data-view 属性でビュー切替
  for (const btn of document.querySelectorAll('[data-view]')) {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  }
  el.btnOpenDownload.addEventListener('click', openDownloadModal);
  // 起動画面の「バージョン情報」ボタンはバージョン情報モーダルを表示
  el.btnOpenSettingsInfo.addEventListener('click', openSettingsInfoModal);
  // 起動画面の「設定/Settings」ボタンは設定モーダルを表示
  el.btnOpenAppSettings.addEventListener('click', openAppSettingsModal);

  // 言語/Language(設定モーダル): 現在の設定値を表示し、変更時は保存して
  // リロードし、選択言語で全文言を再表示する。
  // リロードすると起動画面に戻ってしまうため、フラグを立てて再読み込み後に
  // 設定モーダルを開き直す(操作を続けられるようにする)
  el.languageSelect.value = getLang();
  el.languageSelect.addEventListener('change', (e) => {
    setLang(e.target.value);
    try { sessionStorage.setItem(REOPEN_APP_SETTINGS_KEY, '1'); } catch { /* noop */ }
    location.reload();
  });
  // バージョン情報: 起動時の更新確認トグル(localStorage に保存)
  el.toggleStartupUpdateCheck.addEventListener('change', (e) => {
    writeStartupUpdateCheckEnabled(e.target.checked);
  });

  // 設定: 各トグルで内容領域の表示/非表示を切替
  el.toggleInfoMessages.addEventListener('change', (e) => {
    el.infoMessagesBody.hidden = !e.target.checked;
    if (e.target.checked) renderMessageList();
  });
  el.toggleInfoAbout.addEventListener('change', (e) => {
    el.infoAboutBody.hidden = !e.target.checked;
  });

  // モーダル閉じる(各モーダル内の [data-close-modal] が、その親モーダルを閉じる)
  for (const elem of document.querySelectorAll('[data-close-modal]')) {
    elem.addEventListener('click', () => {
      const modal = elem.closest('.modal');
      if (modal) modal.hidden = true;
      // 入力欄にフォーカスが残っているとモバイルではキーボードが開いたままになり、
      // 表示領域がずれたままになるため明示的に外す
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      // 設定モーダルを閉じた後、現在のビュー状態(マップ画面の戻る/メニュー
      // ボタン等)を正規化して表示崩れを防ぐ
      if (modal && modal.id === 'settingsModal' && currentView === 'map') {
        showView('map');
      }
      // 「クリア/追加/中止」モーダルを閉じたのは操作の中止。保持した用途を捨てる
      if (modal && modal.id === 'trackExistingModal') trackExistingMode = null;
      // どのモーダルを閉じた場合も、マップ画面の操作要素を確実に表示状態へ戻す
      if (currentView === 'map') normalizeMapChrome();
    });
  }

  // マップ表示設定(開くとき、移動経路の統計表を最新化する)
  el.btnMapLayers.addEventListener('click', () => {
    el.mapLayerPanel.hidden = !el.mapLayerPanel.hidden;
    if (!el.mapLayerPanel.hidden) updateTrackStatsDisplay();
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
  // 時刻表示トグル(「バージョン情報等」内): ON でメニューボタンの左に現在時刻を表示
  el.toggleClock.addEventListener('change', (e) => setClockVisible(e.target.checked));
  // ズームレベル表示トグル(設定モーダル内): ON で地図右下に現在のズームレベルを表示。
  // 表示要素は地図コントロール内にあり、マップ・ナビ画面でのみ出るためビュー切替の反映は不要。
  el.toggleZoomDisplay.addEventListener('change', (e) => setZoomDisplayVisible(e.target.checked));
  // 現在地点をマーカー表示: 現在地マーカー(青丸)・精度円の表示/非表示を切替
  el.toggleCurrentMarker.addEventListener('change', (e) => setCurrentMarkerVisible(e.target.checked));
  // 現在地点は中央に表示: 地図を現在地へ追従させるか切替
  el.toggleCenterCurrent.addEventListener('change', (e) => setFollowCurrentLocation(e.target.checked));
  el.toggleTrackRecording.addEventListener('change', (e) => {
    const on = e.target.checked;
    if (!on) {
      // OFF: 軌跡が消去される前に終了処理(統計の出力)を行う
      finishTrackRecording();
    }
    // 記録開始・停止ボタンの表示を切替。
    // 現在地の監視は「現在地点をマーカー表示」等のトグルが管理するため、ここでは触らない。
    updateTrackButtonState(on);
  });

  // 記録開始・停止トグルボタン: 移動経路を記録トグル ON のときのみ表示・操作可。
  // 記録中なら停止、停止中なら開始する(押下ごとにアイコンが切り替わる)。
  el.btnTrackToggle.addEventListener('click', () => {
    // ボタンが表示されている(=移動経路を記録 ON で現在地表示が有効)ときのみ動作。
    // checked の値に依存すると、位置情報エラーで checked が戻されたとき無言で
    // 効かなくなるため、ボタン自身の表示状態で判定する。
    if (el.btnTrackToggle.hidden) return;
    if (isTrackRecording) finishTrackRecording();
    else beginTrackRecording();
  });

  // 読み込み: GPX ファイルを選び、記録済みの移動経路として地図に表示する。
  // 記録中は経路が入れ替わると記録が壊れるため受け付けない。
  // 既存の経路があるときは、クリア/追加/中止をモーダルで選んでからファイル選択へ進む。
  el.btnTrackImport.addEventListener('click', () => {
    if (isTrackRecording) {
      showToast(t('track.importWhileRecording'));
      return;
    }
    if (getTrackStats().pointCount > 0) {
      openTrackExistingModal('import');
      return;
    }
    openTrackImportPicker(false);
  });
  el.trackImportInput.addEventListener('change', importTrackGpx);

  // 「クリア/追加/中止」モーダルの2ボタン。中止(キャンセル・×・背景)は
  // 共通の [data-close-modal] が閉じるだけで、経路には手を付けない。
  el.btnTrackExistingClear.addEventListener('click', () => resolveTrackExisting(false));
  el.btnTrackExistingAppend.addEventListener('click', () => resolveTrackExisting(true));

  // 出力: 記録済みの移動経路を GPX 形式でファイルに出力する
  el.btnTrackExport.addEventListener('click', openTrackExportModal);
  el.btnTrackExportSave.addEventListener('click', exportTrackGpx);

  // 記録点が追加されるたびにパネル内の統計表を最新化する
  setOnTrackPointAppended(updateTrackStatsDisplay);

  // 移動記録からの通知(画面スリープ防止が使えない場合など)。
  // 記録開始と同時に届くため、「移動記録を開始しました」のトーストを
  // 上書きしないよう、そのトーストが消えてから表示する。
  setOnTrackNotice((msg) => {
    logHistory(msg, 'error');
    setTimeout(() => showToast(msg), (TOAST_DURATION_SEC + 0.5) * 1000);
  });

  // クリア: 記録した移動経路(線・開始点・現在地点)を消去
  el.btnTrackClear.addEventListener('click', () => {
    const stats = getTrackStats();
    if (stats.pointCount === 0) {
      showToast(t('track.nothingToClear'));
      return;
    }
    if (!confirm(t('track.clearConfirm'))) return;
    clearTrack();
    isTrackRecording = false;
    setTrackRecordingActive(false);
    updateTrackStatsDisplay();
    logHistory(t('track.cleared'), '');
    showToast(t('track.cleared'));
  });

  // マップ画面メニューから「マーカーの設定」モーダルを開く
  el.btnMapOpenMarkerSettings.addEventListener('click', () => {
    el.mapLayerPanel.hidden = true;
    openMarkerSettingsModal();
  });

  // 設定モーダルから「マーカーの設定」モーダルを開く(設定モーダルは閉じる)
  el.btnOpenMarkerSettings.addEventListener('click', () => {
    el.appSettingsModal.hidden = true;
    openMarkerSettingsModal();
  });

  // メッセージ履歴
  el.btnClearMessages.addEventListener('click', clearMessageLog);
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
// 「バージョン情報等」のバージョン情報内に横一列で反映(未読込は "-")。
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
function showView(name) {
  if (!el.views[name]) return;
  for (const [key, view] of Object.entries(el.views)) {
    view.hidden = (key !== name);
  }
  currentView = name;

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
    setCurrentMarkerVisible(el.toggleCurrentMarker.checked);
    setFollowCurrentLocation(el.toggleCenterCurrent.checked);
    // 移動経路を記録トグルの状態に応じて記録開始/停止ボタンの表示を更新
    updateTrackButtonState(el.toggleTrackRecording.checked);
    // 時刻表示は normalizeMapChrome() でトグルの状態に従って反映済み
    requestAnimationFrame(() => resizeMap());
  } else if (name === 'home' || name === 'nav') {
    // ホーム/ナビ: 全オーバーレイを非表示にして地理院地図のみ表示
    setEmergencyPointsVisible(false);
    setHikingRoutesVisible(false);
    setClosuresVisible(false);
    // 移動記録中はマップ画面を離れても記録を続ける(記録は「記録停止」ボタンか
    // 「移動経路を記録」トグル OFF でのみ終了する)。geolocation.js 側も、記録中は
    // ビューに関わらず現在地監視を継続する。
    setLocationActiveForMapView(false);
    // 記録操作ボタン群はマップ画面のUIなので隠す(記録状態自体は保持する)
    updateTrackButtonState(false);
    // マップ以外では時刻表示を停止・非表示(トグル状態は保持)
    setClockVisible(false);
    requestAnimationFrame(() => resizeMap());
  }
}

// ===== モーダル =====
// バージョン情報モーダル(起動画面の「バージョン情報」から表示)。
// 内容は「起動時にアプリの更新版を確認」トグルと、バージョン情報(常時表示)のみ。
async function openSettingsInfoModal() {
  // 起動時の更新確認トグルを現在の設定値で初期化
  el.toggleStartupUpdateCheck.checked = readStartupUpdateCheckEnabled();

  // バージョン情報を反映
  el.versionManifest.textContent = getManifestVersion() || t('common.unknown');
  const shell = (await getCachedAppShellVersion()) || t('common.unknown');
  el.versionAppShell.textContent = shell;
  // 通行止め・通行困難地点: 現在反映されているデータのバージョン
  el.versionClosures.textContent = getClosureVersion() || '-';
  // データ件数(ポイント/ルート/スポット/通行止め)を開いた時点の最新値で反映
  updateFeatureCounts();

  el.infoSettingsModal.hidden = false;

  // 地図/アプリの更新有無を確認して、新しいものがあれば更新の confirm を表示する
  checkUpdatesFromInfoModal();
}

// 設定モーダル(起動画面の「設定/Settings」から表示)。
// 時刻を表示・メッセージ履歴・このアプリについて・マーカーの設定・言語/Language をまとめる。
// 時刻表示トグルは現在の表示状態を保持したまま表示する。
function openAppSettingsModal() {
  // メッセージ履歴・このアプリについては既定状態(オフ)にリセット
  el.toggleInfoMessages.checked = false;
  el.infoMessagesBody.hidden = true;
  el.toggleInfoAbout.checked = false;
  el.infoAboutBody.hidden = true;

  // 履歴はトグルを開いたときにすぐ見えるよう事前に描画しておく
  renderMessageList();

  el.appSettingsModal.hidden = false;
}

// 「言語の設定/Language Settings」の変更でリロードした直後だけ、設定モーダルを
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

// バージョン情報モーダルを開いたときの更新チェック。
// 地図タイルとアプリ(アプリシェル)のバージョンをサイトの最新と比較し、
// 新しいものがあればそれぞれ別の confirm で案内する。
// メッセージ表示・更新処理は update.js に集約している。
async function checkUpdatesFromInfoModal() {
  // 地図タイル → アプリの順に確認する。アプリ更新は OK で即再読み込みするため最後に確認する
  // (先に出すと地図タイルの案内が表示される前に画面が再読込される)。

  // 地図タイル: ダウンロード済みバージョン vs サイト最新マニフェスト
  // (オフライン地図を未ダウンロードの場合は saved が無く、対象外)。案内のみで自動更新はしない。
  const savedMap = getSavedManifestVersion();
  const latestMap = getManifestVersion();
  if (savedMap && latestMap && savedMap !== latestMap) {
    promptMapTileUpdate(savedMap, latestMap);
  }

  // アプリ: キャッシュ済みアプリシェル vs サイトの service-worker.js。OK なら再読み込みして更新。
  await promptAppShellUpdate();
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

// 記録地点数・移動距離の統計文言(記録終了時のメッセージに使用)。
// 移動距離は統計表と同じ小数点以下1位までの表記にそろえる。
// 経路が複数あるときは、どの経路の統計かが分かるよう「経路 n:」を先頭に付ける。
// 地点数0(位置が一度も取得できなかった記録)の経路は残らないため番号は付けない。
function formatTrackSummary(stats, index, total) {
  const km = (stats.distanceM / 1000).toFixed(1);
  const summary = t('track.summary', { points: stats.pointCount, km });
  if (total <= 1 || stats.pointCount === 0) return summary;
  return `${t('track.routeIndex', { n: index + 1 })}: ${summary}`;
}

// レイヤーパネル内の統計表を現在の記録内容で更新する。経路1本につき1行を出し、
// 移動距離は小数点以下1位までの km 表記(例: 0.2 (km))。
// 経路が複数あるときのみ、行の左に「経路 n」を添える(1本以下では付けない)。
function updateTrackStatsDisplay() {
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
  el.trackExistingMessage.textContent = t('track.existingMessage', { routes: getTrackStatsList().length });
  el.btnTrackExistingClear.textContent = t(isRecord ? 'track.existingClearRecord' : 'track.existingClearImport');
  el.btnTrackExistingAppend.textContent = t(isRecord ? 'track.existingAppendRecord' : 'track.existingAppendImport');
  el.trackExistingModal.hidden = false;
}

// クリア/追加のどちらかが選ばれたとき: モーダルを閉じて、開いた用途の操作を続行する。
// ファイル選択(input.click())はこのクリック操作の延長で呼ぶ必要があるため同期的に進める。
function resolveTrackExisting(append) {
  const mode = trackExistingMode;
  trackExistingMode = null;
  el.trackExistingModal.hidden = true;
  if (mode === 'record') startTrackRecordingNow(append);
  else if (mode === 'import') openTrackImportPicker(append);
}

// 移動記録を開始(記録開始ボタン)。既存の経路が表示されている場合は、
// クリア/追加/中止をモーダルで選んでから開始する(→ resolveTrackExisting)。
function beginTrackRecording() {
  if (getTrackStats().pointCount > 0) {
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
  // クリアして開始した場合は統計表も 0 に戻す
  updateTrackStatsDisplay();
  logHistory(t('track.started'), 'success');
  showToast(t('track.started'));
}

// 移動記録を終了(記録停止/トグルOFF/画面遷移)。記録中だったときのみ、
// いま記録していた経路の地点数・移動距離を履歴(メッセージ)に出力する。
// 記録中の経路は常に最後の経路なので、統計の末尾がその経路のもの。
// 軌跡が消去される前に統計を取得する必要がある点に注意。
function finishTrackRecording() {
  const wasRecording = isTrackRecording;
  const list = getTrackStatsList();
  const stats = list[list.length - 1] || { pointCount: 0, distanceM: 0 };
  stopTrackRecording();
  setTrackRecordingActive(false);
  isTrackRecording = false;
  if (wasRecording) {
    const summary = t('track.finished', {
      summary: formatTrackSummary(stats, list.length - 1, list.length)
    });
    logHistory(summary, 'success');
    showToast(summary);
  }
  // 地点数0で終わった経路は破棄されるため、統計表を取り直す
  updateTrackStatsDisplay();
  // 軌跡は「クリア」まで保持するため、ここではリセットしない。
}

// ===== 移動経路の出力(GPX) =====
// ファイル名の日付部分(yyyymmdd)。記録開始の当日=最初の記録点の記録日を使う
// (記録点に時刻が無い場合のみ今日の日付で代替)。
function getTrackDateStr() {
  const first = getTrackSegments()[0]?.[0];
  const firstMs = first?.timeMs || Date.now();
  const d = new Date(firstMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

// 連番のデフォルト値: 同日の前回出力の連番 +1(保存が無い・日付が違うときは 01)
function readNextExportSeq(dateStr) {
  try {
    const saved = JSON.parse(localStorage.getItem(TRACK_EXPORT_SEQ_KEY));
    if (saved && saved.date === dateStr && Number.isInteger(saved.seq)) return saved.seq + 1;
  } catch { /* 保存なし・不正値は 01 から */ }
  return 1;
}

// 出力に使った連番を保存する(次回デフォルトの決定用)。
// 連番部分が数値でない自由入力のときは保存しない(連番の並びに影響させない)。
function writeExportSeq(dateStr, suffix) {
  if (!/^\d+$/.test(suffix)) return;
  try {
    localStorage.setItem(TRACK_EXPORT_SEQ_KEY, JSON.stringify({ date: dateStr, seq: parseInt(suffix, 10) }));
  } catch { /* noop */ }
}

// 出力モーダルを開く。ファイル名は yyyymmdd-nn を既定とし、
// 日付部分は固定表示、連番以降(nn…)のみ編集できる。
function openTrackExportModal() {
  const stats = getTrackStats();
  if (stats.pointCount === 0) {
    showToast(t('track.nothingToExport'));
    return;
  }
  const dateStr = getTrackDateStr();
  el.trackExportPrefix.textContent = `${dateStr}-`;
  el.trackExportSuffix.value = String(readNextExportSeq(dateStr)).padStart(2, '0');
  el.trackExportModal.hidden = false;
  el.trackExportSuffix.focus();
  el.trackExportSuffix.select();
}

// GPX 1.1 文字列を生成(トラック1本・経路1本ごとに trkseg 1本、各点に記録時刻を含む)。
// 経路を trkseg で分けるため、出力した GPX を読み込み直すと同じ経路構成に戻る。
function buildTrackGpx(segments, name) {
  const esc = (s) => String(s)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const trksegs = segments.map((points) => {
    const trkpts = points.map((p) => {
      const time = p.timeMs ? `<time>${new Date(p.timeMs).toISOString()}</time>` : '';
      return `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}">${time}</trkpt>`;
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

// 出力ボタン: GPX を生成してダウンロードし、連番を保存してモーダルを閉じる
function exportTrackGpx() {
  const segments = getTrackSegments();
  if (segments.length === 0) {
    showToast(t('track.nothingToExport'));
    el.trackExportModal.hidden = true;
    return;
  }
  // 連番以降(編集可能部分): ファイル名に使えない文字は除去して検証する
  const suffix = el.trackExportSuffix.value.trim().replace(/[\\/:*?"<>|]/g, '');
  if (!suffix) {
    showToast(t('track.exportNeedSuffix'));
    return;
  }
  const dateStr = el.trackExportPrefix.textContent.replace(/-$/, '');
  const name = `${dateStr}-${suffix}`;
  const fileName = `${name}.gpx`;
  const blob = new Blob([buildTrackGpx(segments, name)], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  // click 直後の revoke はダウンロード開始前に無効化される場合があるため遅延させる
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  writeExportSeq(dateStr, suffix);
  el.trackExportModal.hidden = true;
  logHistory(t('track.exported', { name: fileName }), 'success');
  showToast(t('track.exported', { name: fileName }));
}

// ===== 移動経路の読み込み(GPX) =====
// 既存の経路をクリアするか追加するかの選択。選択はファイル選択より前に行うため、
// 結果をここで保持してファイル選択後の処理(importTrackGpx)へ引き継ぐ。
let importAppend = false;

// ファイル選択ダイアログを開く。append は選択後の反映方法として保持する。
function openTrackImportPicker(append) {
  importAppend = append;
  // 同じファイルを続けて選べるよう、選択値を毎回クリアしてから開く
  el.trackImportInput.value = '';
  el.trackImportInput.click();
}

// GPX 文字列から移動経路を取り出し、経路ごとの点列の配列で返す(<time> は任意)。
// trkseg 1本を1本の経路として扱うため、記録を分けて出力した GPX
// (本アプリの複数経路出力を含む)をそのまま複数の経路として復元できる。
function parseTrackGpx(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error(t('track.importInvalidXml'));
  const toPoints = (nodes) => [...nodes]
    .map((node) => {
      const timeText = node.getElementsByTagName('time')[0]?.textContent;
      const ms = timeText ? Date.parse(timeText) : NaN;
      return {
        lat: parseFloat(node.getAttribute('lat')),
        lng: parseFloat(node.getAttribute('lon')),
        timeMs: Number.isFinite(ms) ? ms : null
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

// ファイル選択後: GPX を解析して移動経路として表示し、統計と地図表示を合わせる
async function importTrackGpx(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  try {
    const segments = parseTrackGpx(await file.text());
    if (segments.length === 0) {
      showToast(t('track.importNoPoints'));
      return;
    }
    const count = loadTrackSegments(segments, { append: importAppend });
    // 読み込んだ経路は記録済みの状態として扱う(記録開始ボタンは停止表示に戻す)
    isTrackRecording = false;
    setTrackRecordingActive(false);
    updateTrackStatsDisplay();
    // 読み込んだ経路が見えるよう、メニューを閉じて全体を表示する
    el.mapLayerPanel.hidden = true;
    fitMapToTrack();
    // 経路が複数含まれていた場合は経路数も添える
    const msg = segments.length > 1
      ? t('track.importedMulti', { name: file.name, routes: segments.length, count })
      : t('track.imported', { name: file.name, count });
    logHistory(msg, 'success');
    showToast(msg);
  } catch (err) {
    const msg = t('track.importFailed', { message: err.message });
    logHistory(msg, 'error');
    showToast(msg);
  }
}

// ===== 起動時のバージョン確認(履歴記録) =====
// 起動時に確認したバージョン(地図/アプリ)を履歴に残す
async function logStartupVersionCheck() {
  const v = getManifestVersion();
  const mv = v ? `v${v}` : t('common.unknown');
  const shell = (await getCachedAppShellVersion()) || t('common.unknown');
  logHistory(t('startup.versionCheck', { map: mv, app: shell }), '');
}

// 起動
init();
