// 通行止め・通行困難地点(closures)モジュール(app.js から分離)
// - 起動時の読み込み(公開API / localStorage)と地図への反映
// - MapGPS からの起動時のみ有効になる編集パネル(ファイル読み込み/マップに反映/公開/キャンセル)
// ビュー切替・現在ビューの判定は app.js が担うため、initClosures() で受け取る(循環importを避ける)。

import { setClosureGeoJSON, setClosuresVisible } from './map.js';
import {
  CLOSURE_FLAG_KEY, CLOSURE_FILE_NAME, CLOSURE_DATA_KEY,
  CLOSURE_API_URL, CLOSURE_TOKEN_KEY
} from './config.js';
import { logHistory, showToast } from './messages.js';

// ===== DOM要素 =====
const el = {
  // ホーム(MapGPS からの起動時のみ表示)
  btnClosureEdit: document.getElementById('btnClosureEdit'),
  // 編集パネル(マップ右上)
  closureEditPanel: document.getElementById('closureEditPanel'),
  closureVersionInput: document.getElementById('closureVersionInput'),
  btnClosureLoadFile: document.getElementById('btnClosureLoadFile'),
  btnClosureApply: document.getElementById('btnClosureApply'),
  btnClosurePublish: document.getElementById('btnClosurePublish'),
  btnClosureCancel: document.getElementById('btnClosureCancel'),
  closureFileInput: document.getElementById('closureFileInput'),
  // メニューパネル(編集パネル表示時に閉じる)
  mapLayerPanel: document.getElementById('mapLayerPanel')
};

// ===== 状態 =====
// 現在マップに反映されている(有効な)closures データ。
// 「マップに反映」済みデータ(localStorage)があれば同梱ファイルより優先する。
let activeClosureData = null;
// 編集パネルを表示中か(マップ画面を離れたら自動キャンセルする)
let closureEditActive = false;
// ファイル読み込みで取り込んだ未反映の geojson(プレビュー表示のみ)
let loadedClosureData = null;

// app.js から受け取る操作(ビュー切替・現在ビュー判定)
const deps = {
  showView: () => { },
  isMapView: () => false
};

// 編集パネルのイベント登録(初期化時に一度呼ぶ)
export function initClosures({ showView, isMapView }) {
  deps.showView = showView;
  deps.isMapView = isMapView;
  // ホームのボタン(MapGPS からの起動時のみ表示): マップ画面へ移動して編集パネルを開く
  el.btnClosureEdit.addEventListener('click', enterClosureEditMode);
  // 編集パネル: ファイル読み込み / マップに反映 / 公開 / キャンセル
  el.btnClosureLoadFile.addEventListener('click', () => el.closureFileInput.click());
  el.closureFileInput.addEventListener('change', handleClosureFileSelected);
  el.closureVersionInput.addEventListener('input', updateClosureApplyEnabled);
  el.btnClosureApply.addEventListener('click', applyClosureData);
  el.btnClosurePublish.addEventListener('click', publishClosureData);
  el.btnClosureCancel.addEventListener('click', () => cancelClosureEdit());
}

// MapGPS からの起動判定
// URL に ?closure=true が付いていれば通行止め・通行困難の編集機能を有効化する。
// 判定結果は sessionStorage に保持し、同一タブ内のリロードでは維持される。
export function applyClosureFlag() {
  const params = new URLSearchParams(location.search);
  if (params.get('closure') === 'true') {
    sessionStorage.setItem(CLOSURE_FLAG_KEY, '1');
  }
  el.btnClosureEdit.hidden = sessionStorage.getItem(CLOSURE_FLAG_KEY) !== '1';
}

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
export async function loadClosures() {
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

// 現在反映されているデータのバージョン(未反映は空文字)
export function getClosureVersion() {
  return activeClosureData?.version || '';
}

// 現在反映されているデータの件数(未反映は null)。データ件数表示で使用。
export function getClosureCount() {
  return activeClosureData ? activeClosureData.features.length : null;
}

// ホームのボタンから編集モードへ: マップ画面を表示し、右上に編集パネルを出す
function enterClosureEditMode() {
  closureEditActive = true;
  loadedClosureData = null;
  el.closureVersionInput.value = getClosureVersion();
  updateClosureApplyEnabled();
  deps.showView('map');
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
    if (deps.isMapView()) setClosuresVisible(true);
  }
  exitClosureEditPanel();
  if (!silent && hadPreview) showToast('読み込んだ内容を反映せずにキャンセルしました');
}

// マップ画面を離れるときの自動キャンセル(編集パネル表示中のみ)。app.js のビュー切替から呼ぶ。
export function autoCancelOnLeaveMap() {
  if (closureEditActive) cancelClosureEdit(true);
}
