// アプリのエントリポイント
// - SPA ビュー切替(home / map / nav)+ 各モーダル
// - 現在地・移動経路の記録操作(トラック)の取りまとめ
// - 各機能モジュール(tiles / update / messages / marker-settings / map)の初期化と連携
//
// 機能別の実装は以下のモジュールに分離している:
//   tiles.js          … オフライン地図のDL・マニフェスト・更新バナー
//   update.js         … アプリシェルの更新確認
//   messages.js       … メッセージ履歴
//   marker-settings.js… マーカーの色・形状・サイズ設定
//   map.js            … Leaflet 地図・オーバーレイ・現在地/トラック

import {
  initMap, resizeMap,
  loadEmergencyPointsLayer, setEmergencyPointsVisible,
  loadHikingRoutesLayer, setHikingRoutesVisible,
  setClosureGeoJSON, setClosuresVisible,
  getFeatureCounts,
  setLocationActiveForMapView, setCurrentMarkerVisible, setFollowCurrentLocation,
  setTrackStyle, setTrackStartStyle, setTrackCurrentStyle,
  startTrackRecording, stopTrackRecording, getTrackStats, clearTrack
} from './map.js';
import {
  TOAST_DURATION_SEC, EMERGENCY_URL, HIKING_ROUTES_URL,
  CLOSURE_FLAG_KEY, CLOSURE_FILE_NAME, CLOSURE_DATA_KEY,
  CLOSURE_API_URL, CLOSURE_TOKEN_KEY
} from './config.js';
import { logHistory, renderMessageList, clearMessageLog } from './messages.js';
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

  // 一時メッセージ(トースト)
  toast: document.getElementById('toast'),

  // ホーム
  btnOpenDownload: document.getElementById('btnOpenDownload'),
  btnOpenSettingsInfo: document.getElementById('btnOpenSettingsInfo'),
  // 通行止め・通行困難地点(MapGPS からの起動時のみ表示)
  btnClosureEdit: document.getElementById('btnClosureEdit'),

  // 設定と情報モーダル(起動画面の「設定と情報」から表示)
  infoSettingsModal: document.getElementById('infoSettingsModal'),
  toggleStartupUpdateCheck: document.getElementById('toggleStartupUpdateCheck'),
  btnInfoOpenMarkerSettings: document.getElementById('btnInfoOpenMarkerSettings'),
  btnInfoOpenImageSettings: document.getElementById('btnInfoOpenImageSettings'),
  toggleInfoVersion: document.getElementById('toggleInfoVersion'),
  infoVersionBody: document.getElementById('infoVersionBody'),
  toggleInfoMessages: document.getElementById('toggleInfoMessages'),
  infoMessagesBody: document.getElementById('infoMessagesBody'),
  toggleInfoAbout: document.getElementById('toggleInfoAbout'),
  infoAboutBody: document.getElementById('infoAboutBody'),
  versionManifest: document.getElementById('versionManifest'),
  versionAppShell: document.getElementById('versionAppShell'),
  // 通行止め・通行困難地点のバージョン表示欄(バージョン情報内)
  versionClosures: document.getElementById('versionClosures'),
  btnClearMessages: document.getElementById('btnClearMessages'),

  // マップ
  btnMapLayers: document.getElementById('btnMapLayers'),
  mapLayerPanel: document.getElementById('mapLayerPanel'),
  mapClock: document.getElementById('mapClock'),
  toggleClock: document.getElementById('toggleClock'),
  // データ件数表示(ポイント/ルート/スポット/通行止め)
  countPoints: document.getElementById('countPoints'),
  countRoutes: document.getElementById('countRoutes'),
  countSpots: document.getElementById('countSpots'),
  countClosures: document.getElementById('countClosures'),
  // 現在地点の表示・地図追従トグル(移動経路を記録の上に配置)
  toggleCurrentMarker: document.getElementById('toggleCurrentMarker'),
  toggleCenterCurrent: document.getElementById('toggleCenterCurrent'),
  toggleTrackRecording: document.getElementById('toggleTrackRecording'),
  // 移動経路を記録 ON のとき表示する操作ボタン群(記録開始・停止トグル/写真撮影)
  mapTrackActions: document.getElementById('mapTrackActions'),
  btnTrackToggle: document.getElementById('btnTrackToggle'),
  btnTrackPhoto: document.getElementById('btnTrackPhoto'),
  // レイヤーパネル内: 移動経路の統計表示(サイズ)・クリア
  btnTrackStats: document.getElementById('btnTrackStats'),
  btnTrackClear: document.getElementById('btnTrackClear'),
  // 通行止め・通行困難地点の編集パネル(マップ右上)
  closureEditPanel: document.getElementById('closureEditPanel'),
  closureVersionInput: document.getElementById('closureVersionInput'),
  btnClosureLoadFile: document.getElementById('btnClosureLoadFile'),
  btnClosureApply: document.getElementById('btnClosureApply'),
  btnClosurePublish: document.getElementById('btnClosurePublish'),
  btnClosureCancel: document.getElementById('btnClosureCancel'),
  closureFileInput: document.getElementById('closureFileInput'),

  // 設定モーダル
  settingsModal: document.getElementById('settingsModal'),
  settingsTitle: document.getElementById('settingsTitle'),

  // マップ画面メニュー内の設定ショートカット
  btnMapOpenMarkerSettings: document.getElementById('btnMapOpenMarkerSettings'),
  btnMapOpenImageSettings: document.getElementById('btnMapOpenImageSettings')
};

// ===== 初期化 =====
async function init() {
  // MapGPS からの起動フラグはネットワークに依存しないため最初に反映する
  applyClosureFlag();
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
  loadClosures().then(() => {
    if (currentView === 'map') setClosuresVisible(true);
    updateFeatureCounts();
  });
  setTrackStyle(markerSettings.track);
  setTrackStartStyle(markerSettings.trackStart);
  setTrackCurrentStyle(markerSettings.trackCurrent);

  // 初期表示はホーム(オーバーレイは非表示のまま)
  showView('home');
  requestAnimationFrame(() => resizeMap());
}

// MapGPS からの起動判定
// URL に ?closure=true が付いていれば通行止め・通行困難の編集機能を有効化する。
// 判定結果は sessionStorage に保持し、同一タブ内のリロードでは維持される。
function applyClosureFlag() {
  const params = new URLSearchParams(location.search);
  if (params.get('closure') === 'true') {
    sessionStorage.setItem(CLOSURE_FLAG_KEY, '1');
  }
  el.btnClosureEdit.hidden = sessionStorage.getItem(CLOSURE_FLAG_KEY) !== '1';
}

// ===== 通行止め・通行困難地点(closures) =====
// 現在マップに反映されている(有効な)closures データ。
// 「マップに反映」済みデータ(localStorage)があれば同梱ファイルより優先する。
let activeClosureData = null;
// 編集パネルを表示中か(マップ画面を離れたら自動キャンセルする)
let closureEditActive = false;
// ファイル読み込みで取り込んだ未反映の geojson(プレビュー表示のみ)
let loadedClosureData = null;

function readAppliedClosureData() {
  try {
    const raw = localStorage.getItem(CLOSURE_DATA_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.warn('反映済み closures データの読込失敗:', err);
    return null;
  }
}

// 起動時の読み込み: 公開API(Vercel Function + Blob)から最新を取得し、
// 「マップに反映」済みデータ(localStorage)があればバージョンを比較する。
// - 一致: 「公開」が完了しているのでサーバー側を正とし、
//   localStorage を削除する(以降の公開が素直に反映されるようにする自己修復)
// - 不一致: 未公開の反映データとして localStorage を優先する
// API に届かないとき(オフライン等)は SW の closures-cache が最終取得を返す。
// それも無い場合は表示なしとする(古い情報を出すより安全)。
async function loadClosures() {
  let served = null;
  try {
    // no-cache: HTTPキャッシュを再検証し、公開直後でも最新版を取得する
    // (SW 未制御の初回ロードでも有効。SW 経由時は SW 側でも同様に扱う)
    const res = await fetch(CLOSURE_API_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    served = await res.json();
  } catch (apiErr) {
    console.warn('通行止め・通行困難地点の公開API読込失敗:', apiErr);
  }
  const applied = readAppliedClosureData();
  let data = served;
  if (applied) {
    if (served && applied.version === served.version) {
      localStorage.removeItem(CLOSURE_DATA_KEY);
    } else {
      data = applied;
    }
  }
  if (!data) return;
  activeClosureData = data;
  setClosureGeoJSON(data);
}

function getClosureVersion() {
  return activeClosureData?.version || '';
}

// ホームのボタンから編集モードへ: マップ画面を表示し、右上に編集パネルを出す
function enterClosureEditMode() {
  closureEditActive = true;
  loadedClosureData = null;
  el.closureVersionInput.value = getClosureVersion();
  updateClosureApplyEnabled();
  showView('map');
  // メニューパネルが開いたまま残っていると編集パネル(z-index が下)を覆うため閉じる
  el.mapLayerPanel.hidden = true;
  el.closureEditPanel.hidden = false;
}

function exitClosureEditPanel() {
  closureEditActive = false;
  el.closureEditPanel.hidden = true;
}

// 読み込んだ geojson の妥当性確認。問題なければ null、あればエラーメッセージを返す
function validateClosureGeoJSON(data) {
  if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
    return 'FeatureCollection 形式の geojson ではありません';
  }
  if (data.features.length > 0 &&
      !data.features.some((f) => f?.geometry?.type === 'Point')) {
    return 'Point 地物が含まれていません';
  }
  return null;
}

// ファイル読み込み: 選択された geojson を解析し、マップにプレビュー表示する(未反映)
async function handleClosureFileSelected() {
  const file = el.closureFileInput.files && el.closureFileInput.files[0];
  // 同じファイルを選び直しても change が発火するよう毎回リセットする
  el.closureFileInput.value = '';
  if (!file) return;

  let data = null;
  try {
    data = JSON.parse(await file.text());
  } catch {
    showToast(`${file.name} を JSON として読み込めませんでした`);
    return;
  }
  const error = validateClosureGeoJSON(data);
  if (error) {
    showToast(`読み込み失敗: ${error}`);
    return;
  }

  loadedClosureData = data;
  setClosureGeoJSON(data);
  setClosuresVisible(true);
  updateClosureApplyEnabled();
  showToast(`${file.name} を読み込みました(${data.features.length} 件)。反映にはバージョンの変更が必要です`);
}

// 「マップに反映」の活性制御: ファイル読み込み済みで、かつバージョンが
// 現在の値から変更されている(空でない)ときのみ押せる
function updateClosureApplyEnabled() {
  const v = el.closureVersionInput.value.trim();
  el.btnClosureApply.disabled = !(loadedClosureData && v && v !== getClosureVersion());
}

// マップに反映: 読み込んだ geojson を新しいバージョンとしてこの端末に保存する。
// ユーザーへの公開は、続けて「公開」ボタン(公開APIへの送信)で行う。
function applyClosureData() {
  if (!loadedClosureData) return;
  const version = el.closureVersionInput.value.trim();
  if (!version || version === getClosureVersion()) {
    showToast('新しいバージョンを入力してください');
    return;
  }
  const data = { ...loadedClosureData, version };
  const count = data.features.length;
  if (!confirm(`バージョン ${version}(${count} 件)をこの端末のマップに反映します。よろしいですか?`)) {
    return;
  }
  try {
    localStorage.setItem(CLOSURE_DATA_KEY, JSON.stringify(data));
  } catch (err) {
    showToast(`保存に失敗しました: ${err.message}`);
    return;
  }
  activeClosureData = data;
  loadedClosureData = null;
  setClosureGeoJSON(data);
  setClosuresVisible(true);
  updateClosureApplyEnabled();
  logHistory(`通行止め・通行困難地点を反映しました(バージョン ${version} / ${count} 件)`, 'success');
  // パネルは閉じずに残し、続けて「公開」を押せるようにする
  alert(
    `バージョン ${version}(${count} 件)をこの端末のマップに反映しました。\n` +
    'ユーザーへ公開するには、続けて「公開」を押してください。'
  );
}

// 公開: 反映済みデータを公開API(POST /api/closures)へ送信し、ユーザーへ公開する。
// git・PC は不要で、スマホ/タブレットのブラウザだけで完結する。
// 公開トークンは初回に入力してこの端末に保存する(認証失敗時は削除して再入力を促す)。
async function publishClosureData() {
  const data = activeClosureData;
  if (!data || !data.version) {
    showToast('先に「ファイル読み込み」→「マップに反映」でデータを反映してください');
    return;
  }
  if (loadedClosureData) {
    showToast('未反映の読み込みデータがあります。先に「マップに反映」を押してください');
    return;
  }
  const count = data.features.length;
  const emptyWarn = count === 0 ? '\n【注意】0 件のため、公開中の全地点が地図から消えます。' : '';
  if (!confirm(`バージョン ${data.version}(${count} 件)をユーザーへ公開します。よろしいですか?${emptyWarn}`)) {
    return;
  }
  let token = localStorage.getItem(CLOSURE_TOKEN_KEY) || '';
  if (!token) {
    token = (prompt('公開トークンを入力してください(この端末に保存されます)') || '').trim();
    if (!token) return;
  }
  el.btnClosurePublish.disabled = true;
  try {
    const res = await fetch(CLOSURE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-publish-token': token },
      body: JSON.stringify(data)
    });
    // 失敗時はエラーコード(E01〜E05)付きで案内する。運用担当者が開発担当者へ
    // コードを伝えるだけで原因を切り分けられるようにする(運用手順書 §9)。
    if (res.status === 401) {
      // E01: 入力した公開トークンが違う。運用担当者が再入力で解決できる
      localStorage.removeItem(CLOSURE_TOKEN_KEY);
      alert(
        '【E01】公開トークンが正しくありません。\n\n' +
        'もう一度「公開」を押して、正しいトークンを入力してください。\n' +
        'トークンが分からないときは、開発担当者に確認してください。'
      );
      return;
    }
    if (!res.ok) {
      const detail = await readApiError(res);
      if (res.status === 400) {
        // E03: 送信データの不備。データ(geojson)側を直せば解決できる
        alert(
          '【E03】公開データに不備があります。\n\n' +
          `理由: ${detail}\n\n` +
          'バージョンを変えたか、地点の座標・IDが正しいかを確認し、\n' +
          'データを作り直してからやり直してください。'
        );
        return;
      }
      if (res.status === 503) {
        // E02: サーバー側の公開トークン未設定。操作では直らず開発担当者対応
        alert(
          '【E02】公開機能がサーバー側でまだ設定されていません。\n\n' +
          'この画面の操作では直りません。\n' +
          '開発担当者に「エラー E02(公開トークン未設定)」と伝えてください。'
        );
        return;
      }
      // E04: 公開ストア(Blob)への保存失敗。多くは時間をおくと回復。続く場合は開発担当者対応
      alert(
        '【E04】公開データの保存に失敗しました(サーバー側)。\n\n' +
        `詳細: ${detail}\n\n` +
        '少し時間をおいて、もう一度「公開」をお試しください。\n' +
        '何度も続くときは、開発担当者に「エラー E04(公開ストア保存失敗)」と伝えてください。'
      );
      offerEmergencyDownload(data);
      return;
    }
    localStorage.setItem(CLOSURE_TOKEN_KEY, token);
    logHistory(`通行止め・通行困難地点を公開しました(バージョン ${data.version} / ${count} 件)`, 'success');
    exitClosureEditPanel();
    alert(
      `バージョン ${data.version}(${count} 件)をユーザーへ公開しました。\n` +
      '各端末には次回のマップ表示時に反映されます。'
    );
  } catch (err) {
    // E05: API に接続できない(通信断・CORS・サーバー障害など)
    alert(
      '【E05】公開サーバーに接続できませんでした(通信エラー)。\n\n' +
      'まず通信状況(電波・Wi-Fi)を確認して、もう一度お試しください。\n' +
      `続くときは、開発担当者に「エラー E05(通信エラー): ${err.message}」と伝えてください。`
    );
    offerEmergencyDownload(data);
  } finally {
    el.btnClosurePublish.disabled = false;
  }
}

// APIのエラー応答から表示用メッセージを取り出す
async function readApiError(res) {
  try {
    const body = await res.json();
    if (body && body.error) return body.error;
  } catch { /* JSON でない応答はステータスのみ表示 */ }
  return `HTTP ${res.status}`;
}

// 公開に失敗したとき、編集内容を端末に保存できるようにする(作業のやり直し防止・
// 開発担当者への連携用のバックアップ)。公開自体はあくまで「公開」ボタン(API)で行う。
function offerEmergencyDownload(data) {
  if (!confirm(
    `今回のデータをこの端末に保存しますか?(ファイル名: ${CLOSURE_FILE_NAME})\n` +
    '保存しておくと、あとで公開をやり直したり、開発担当者に渡して調べてもらえます。'
  )) return;
  downloadClosureFile(data);
}

// 反映した geojson を公開用にダウンロードする
function downloadClosureFile(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/geo+json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = CLOSURE_FILE_NAME;
  a.click();
  // click 直後の revoke はダウンロード開始前に無効化される場合があるため遅延させる
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// キャンセル: 未反映の読み込みデータを破棄して反映済みデータの表示へ戻し、
// 通常のハイキングマップ表示に戻る。silent=true はビュー遷移時の自動キャンセル
function cancelClosureEdit(silent = false) {
  const hadPreview = !!loadedClosureData;
  loadedClosureData = null;
  if (hadPreview) {
    setClosureGeoJSON(activeClosureData);
    if (currentView === 'map') setClosuresVisible(true);
  }
  exitClosureEditPanel();
  if (!silent && hadPreview) showToast('読み込んだ内容を反映せずにキャンセルしました');
}

function bindEvents() {
  // ホームメニュー: data-view 属性でビュー切替
  for (const btn of document.querySelectorAll('[data-view]')) {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  }
  el.btnOpenDownload.addEventListener('click', openDownloadModal);
  // 通行止め・通行困難地点(ホーム・MapGPS からの起動時のみ表示):
  // マップ画面へ移動して編集パネルを開く
  el.btnClosureEdit.addEventListener('click', enterClosureEditMode);
  // 編集パネル: ファイル読み込み / マップに反映 / 公開 / キャンセル
  el.btnClosureLoadFile.addEventListener('click', () => el.closureFileInput.click());
  el.closureFileInput.addEventListener('change', handleClosureFileSelected);
  el.closureVersionInput.addEventListener('input', updateClosureApplyEnabled);
  el.btnClosureApply.addEventListener('click', applyClosureData);
  el.btnClosurePublish.addEventListener('click', publishClosureData);
  el.btnClosureCancel.addEventListener('click', () => cancelClosureEdit());
  // 起動画面の「設定と情報」ボタンは設定と情報モーダルを表示
  el.btnOpenSettingsInfo.addEventListener('click', openSettingsInfoModal);

  // 設定: 起動時の更新確認トグル(localStorage に保存)
  el.toggleStartupUpdateCheck.addEventListener('change', (e) => {
    writeStartupUpdateCheckEnabled(e.target.checked);
  });
  // 設定: マップ画面メニューと同じ設定項目を既存モーダルで開く
  el.btnInfoOpenMarkerSettings.addEventListener('click', () => openSettingsModal('marker'));
  el.btnInfoOpenImageSettings.addEventListener('click', () => openSettingsModal('image'));

  // 情報: 各トグルで内容領域の表示/非表示を切替
  el.toggleInfoVersion.addEventListener('change', (e) => {
    el.infoVersionBody.hidden = !e.target.checked;
  });
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
      // 設定モーダルを閉じた後、現在のビュー状態(マップ画面の戻る/メニュー
      // ボタン等)を正規化して表示崩れを防ぐ
      if (modal && modal.id === 'settingsModal' && currentView === 'map') {
        showView('map');
      }
    });
  }

  // マップ表示設定
  el.btnMapLayers.addEventListener('click', () => {
    el.mapLayerPanel.hidden = !el.mapLayerPanel.hidden;
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
  // 時刻表示トグル(「設定と情報」内): ON でメニューボタンの左に現在時刻を表示
  el.toggleClock.addEventListener('change', (e) => setClockVisible(e.target.checked));
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
    // 記録操作ボタン群(記録開始/停止・写真撮影)の表示を切替。
    // 現在地の監視は「現在地点をマーカー表示」等のトグルが管理するため、ここでは触らない。
    updateTrackButtonState(on);
  });

  // 記録開始・停止トグルボタン: 移動経路を記録トグル ON のときのみ表示・操作可。
  // 記録中なら停止、停止中なら開始する(押下ごとにアイコンが切り替わる)。
  el.btnTrackToggle.addEventListener('click', () => {
    // ボタンが表示されている(=移動経路を記録 ON で現在地表示が有効)ときのみ動作。
    // checked の値に依存すると、位置情報エラーで checked が戻されたとき無言で
    // 効かなくなるため、ボタン自身の表示状態で判定する。
    if (el.mapTrackActions.hidden) return;
    if (isTrackRecording) finishTrackRecording();
    else beginTrackRecording();
  });
  // 写真撮影ボタン(端末のカメラ/写真選択を起動)
  el.btnTrackPhoto.addEventListener('click', () => {
    if (el.mapTrackActions.hidden) return;
    capturePhoto();
  });

  // サイズ: 現在の移動経路の統計(記録地点数・写真枚数・移動距離)を表示
  el.btnTrackStats.addEventListener('click', () => {
    const stats = getTrackStats();
    const km = (stats.distanceM / 1000).toFixed(2);
    showToast(`記録地点 ${stats.pointCount} 点 / 写真 ${trackPhotoCount} 枚 / 移動距離 ${km} km`);
  });

  // クリア: 記録した移動経路(線・開始点・現在地点)を消去
  el.btnTrackClear.addEventListener('click', () => {
    const stats = getTrackStats();
    if (stats.pointCount === 0) {
      showToast('クリアする移動経路がありません');
      return;
    }
    if (!confirm('記録した移動経路をクリアします。よろしいですか?')) return;
    clearTrack();
    isTrackRecording = false;
    setTrackRecordingActive(false);
    trackPhotoCount = 0;
    logHistory('移動経路をクリアしました', '');
    showToast('移動経路をクリアしました');
  });

  // マップ画面メニューから設定モーダルを直接開く(起動画面に戻る必要なし)
  el.btnMapOpenMarkerSettings.addEventListener('click', () => {
    el.mapLayerPanel.hidden = true;
    openSettingsModal('marker');
  });
  el.btnMapOpenImageSettings.addEventListener('click', () => {
    el.mapLayerPanel.hidden = true;
    openSettingsModal('image');
  });

  // メッセージ履歴
  el.btnClearMessages.addEventListener('click', clearMessageLog);
}

// ===== 一時メッセージ(トースト) =====
let toastTimerId = null;

// 画面中央下に一時メッセージを表示し、config.js の秒数で自動的に閉じる
function showToast(text) {
  if (!el.toast || !text) return;
  el.toast.textContent = text;
  el.toast.hidden = false;
  // hidden 解除直後に表示クラスを付けてフェードインさせる
  requestAnimationFrame(() => el.toast.classList.add('toast-show'));

  if (toastTimerId !== null) clearTimeout(toastTimerId);
  const ms = Math.max(0, (Number(TOAST_DURATION_SEC) || 0) * 1000);
  toastTimerId = setTimeout(() => {
    el.toast.classList.remove('toast-show');
    // フェードアウト(0.25s)後に hidden へ
    toastTimerId = setTimeout(() => {
      el.toast.hidden = true;
      toastTimerId = null;
    }, 250);
  }, ms);
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
// 「設定と情報」のバージョン情報内に横一列で反映(未読込は "-")。
function updateFeatureCounts() {
  const c = getFeatureCounts();
  el.countPoints.textContent = c.points == null ? '-' : String(c.points);
  el.countRoutes.textContent = c.routes == null ? '-' : String(c.routes);
  el.countSpots.textContent = c.spots == null ? '-' : String(c.spots);
  // 通行止め・通行困難地点: 現在反映されているデータの件数
  el.countClosures.textContent = activeClosureData ? String(activeClosureData.features.length) : '-';
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
    // マップビュー: メニューボタンを確実に表示(モーダル閉じ後等の表示崩れ対策)
    el.btnMapLayers.hidden = false;
    el.btnMapLayers.style.display = '';

    // マップビュー: 緊急ポイント・ハイキングルート・通行止め等を常に表示
    setEmergencyPointsVisible(true);
    setHikingRoutesVisible(true);
    setClosuresVisible(true);
    // マップビューに入ったら現在地監視を開始。表示/追従はメニュートグルの状態に従う。
    // 先に監視を有効化してから各トグル状態を反映する(再表示の無駄打ちを避ける)。
    setLocationActiveForMapView(true, {
      onError: (msg) => {
        // 位置情報が取得できない場合(非HTTPS環境・権限拒否など)は現在地を表示できない。
        // 原因が分かるよう履歴・ステータスに出力する(連続エラーは map.js 側で抑制)。
        setStatus(msg, 'error');
        logHistory(msg, 'error');
      }
    });
    setCurrentMarkerVisible(el.toggleCurrentMarker.checked);
    setFollowCurrentLocation(el.toggleCenterCurrent.checked);
    // 移動経路を記録トグルの状態に応じて操作ボタン群(記録開始/写真撮影/記録停止)の表示を更新
    updateTrackButtonState(el.toggleTrackRecording.checked);
    // 時刻表示トグルの状態に従って時刻を表示
    setClockVisible(el.toggleClock.checked);
    requestAnimationFrame(() => resizeMap());
  } else if (name === 'home' || name === 'nav') {
    // 通行止め・通行困難地点の編集中にマップ画面を離れたら自動キャンセルする
    if (closureEditActive) cancelClosureEdit(true);
    // ホーム/ナビ: 全オーバーレイを非表示にして地理院地図のみ表示
    setEmergencyPointsVisible(false);
    setHikingRoutesVisible(false);
    setClosuresVisible(false);
    // 軌跡が消去される前に終了処理(統計の出力)を行ってから現在地監視を停止
    finishTrackRecording();
    setLocationActiveForMapView(false);
    updateTrackButtonState(false);
    // マップ以外では時刻表示を停止・非表示(トグル状態は保持)
    setClockVisible(false);
    requestAnimationFrame(() => resizeMap());
  }
}

// ===== モーダル =====
// 設定と情報モーダル(起動画面の「設定と情報」から表示)。
// 設定(マーカー/撮影画像の解像度への入口)を上、情報(時刻表示・更新確認・
// バージョン情報・メッセージ履歴・このアプリについて)を下に配置する。
async function openSettingsInfoModal() {
  // 起動時の更新確認トグルを現在の設定値で初期化
  el.toggleStartupUpdateCheck.checked = readStartupUpdateCheckEnabled();

  // --- 情報: トグルを既定状態(バージョン情報のみオン)にリセット ---
  el.toggleInfoVersion.checked = true;
  el.infoVersionBody.hidden = false;
  el.toggleInfoMessages.checked = false;
  el.infoMessagesBody.hidden = true;
  el.toggleInfoAbout.checked = false;
  el.infoAboutBody.hidden = true;

  // バージョン情報を反映
  el.versionManifest.textContent = getManifestVersion() || '不明';
  const shell = (await getCachedAppShellVersion()) || '不明';
  el.versionAppShell.textContent = shell;
  // 通行止め・通行困難地点: 現在反映されているデータのバージョン
  el.versionClosures.textContent = getClosureVersion() || '-';
  // データ件数(ポイント/ルート/スポット/通行止め)を開いた時点の最新値で反映
  updateFeatureCounts();

  // 履歴は開いたときにすぐ見えるよう事前に描画しておく
  renderMessageList();

  el.infoSettingsModal.hidden = false;

  // バージョン情報トグルがオンなら、地図/アプリの更新有無を確認して
  // 新しいものがあれば更新の confirm を表示する
  checkUpdatesFromInfoModal();
}

// 「設定と情報」モーダルを開いたときの更新チェック。
// 「バージョン情報」トグルがオンのとき、地図タイルとアプリ(アプリシェル)の
// バージョンをサイトの最新と比較し、新しいものがあればそれぞれ別の confirm で案内する。
// メッセージ表示・更新処理は update.js に集約している。
async function checkUpdatesFromInfoModal() {
  if (!el.toggleInfoVersion.checked) return;

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

// section を指定するとそのセクションのみ表示(未指定なら全セクション)
function openSettingsModal(section) {
  const sections = el.settingsModal.querySelectorAll('.settings-section');
  for (const s of sections) {
    s.hidden = section ? (s.dataset.section !== section) : false;
  }
  if (el.settingsTitle) {
    if (section === 'marker') el.settingsTitle.textContent = 'マーカーの設定';
    else if (section === 'image') el.settingsTitle.textContent = '撮影画像の解像度の設定';
    else el.settingsTitle.textContent = '設定';
  }
  el.settingsModal.hidden = false;
}

// ===== 移動経路(トラック)記録の取りまとめ =====
// 移動経路を記録トグルの状態に応じて、操作ボタン群(記録開始/写真撮影/記録停止)の表示を切替
function updateTrackButtonState(enabled) {
  if (el.mapTrackActions) el.mapTrackActions.hidden = !enabled;
  // ON のときはパネルを左にずらし、操作ボタン群のアイコンが見えるようにする
  if (el.mapLayerPanel) el.mapLayerPanel.classList.toggle('track-active', enabled);
  if (!enabled) {
    // OFF に戻したら記録状態も初期化(記録開始を操作可能・記録停止を無効に)
    setTrackRecordingActive(false);
  }
}

// 記録中フラグに応じてトグルボタンのアイコン(開始▶/停止■)とラベルを切り替える
function setTrackRecordingActive(active) {
  el.btnTrackToggle.classList.toggle('is-recording', active);
  const label = active ? '記録停止' : '記録開始';
  el.btnTrackToggle.setAttribute('aria-label', label);
  el.btnTrackToggle.setAttribute('title', label);
}

// 実際に移動記録中かどうか(開始ボタン押下〜停止まで)
let isTrackRecording = false;
// 今回の記録中に撮影した写真の枚数
let trackPhotoCount = 0;

// 移動記録を開始(記録開始ボタン)。開始を履歴に残す。
// 写真枚数や軌跡は「クリア」までトラックと共に保持するため、ここではリセットしない。
function beginTrackRecording() {
  startTrackRecording();
  setTrackRecordingActive(true);
  isTrackRecording = true;
  logHistory('移動記録を開始しました', 'success');
  showToast('移動記録を開始しました');
}

// 移動記録を終了(記録停止/トグルOFF/画面遷移)。記録中だったときのみ、
// 記録地点数・撮影写真枚数・合計移動距離を履歴(メッセージ)に出力する。
// 軌跡が消去される前に統計を取得する必要がある点に注意。
function finishTrackRecording() {
  const wasRecording = isTrackRecording;
  const stats = getTrackStats();
  stopTrackRecording();
  setTrackRecordingActive(false);
  isTrackRecording = false;
  if (wasRecording) {
    const km = (stats.distanceM / 1000).toFixed(2);
    const summary = `移動記録を終了しました(記録地点 ${stats.pointCount} 点 / 写真 ${trackPhotoCount} 枚 / 移動距離 ${km} km)`;
    logHistory(summary, 'success');
    showToast(summary);
  }
  // 写真枚数・軌跡は「クリア」まで保持するため、ここではリセットしない。
}

// 写真撮影: 端末のカメラ/写真選択ダイアログを起動(取得後の保存処理は今後実装)
function capturePhoto() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment';
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    // TODO: 撮影した写真の保存・記録への紐付けは今後実装
    if (file) {
      // 記録中の撮影枚数をカウント(終了時の統計メッセージに使用)
      if (isTrackRecording) trackPhotoCount++;
      console.log('写真を取得:', file.name);
    }
  });
  input.click();
}

// ===== 起動時のバージョン確認(履歴記録) =====
// 起動時に確認したバージョン(地図/アプリ)を履歴に残す
async function logStartupVersionCheck() {
  const v = getManifestVersion();
  const mv = v ? `v${v}` : '不明';
  const shell = (await getCachedAppShellVersion()) || '不明';
  logHistory(`起動時のバージョン確認: 地図 ${mv} / アプリ ${shell}`, '');
}

// 起動
init();
