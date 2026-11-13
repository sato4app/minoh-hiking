// アプリ内カメラモジュール(「写真を撮影」の撮影。移動経路の記録とは別の機能)
// 端末のカメラアプリを呼び出す(<input type="file" capture>)のではなく、getUserMedia で
// カメラの映像をこの画面の中に出し、シャッターで1コマを取り込む。
// カメラアプリへ切り替えると本アプリがバックグラウンドになり、撮影中は位置が記録されず、
// メモリの少ない端末ではそのまま終了させられて記録も写真も失うおそれがあるため。
// 画面の中で撮るので、撮影中もスリープ防止と位置の監視が続く。
//
// このモジュールは撮影だけを担い、撮った画像(JPEG)と撮影時刻を onShot に渡す。
// 位置の取得・保存・地図への表示は app.js / photos.js が行う。
// 1回開くごとに1枚だけ撮る。シャッターを押すと映像をその場で止め(撮ったコマを見せたまま)、
// 保存が済んだら app.js がカメラを閉じて、撮った写真の表示を開く(続けて撮るときは写真の表示の「撮影」から)。
import { PHOTO_MAX_EDGE_PX, PHOTO_JPEG_QUALITY, CAMERA_IDLE_CLOSE_SEC } from './config.js';
import { t } from './i18n.js';

const el = {
  overlay: document.getElementById('cameraOverlay'),
  video: document.getElementById('cameraVideo'),
  flash: document.getElementById('cameraFlash'),
  status: document.getElementById('cameraStatus'),
  btnClose: document.getElementById('btnCameraClose'),
  btnShutter: document.getElementById('btnCameraShutter')
};

let stream = null;
let idleTimer = null;
// 開くたびに増やす番号。保存を待つ間に閉じて開き直したとき、前の撮影の保存で新しいカメラを閉じないため
let session = 0;
// openCamera で受け取る処理(撮影前の確認・撮影・エラー・自動で閉じたとき)
let handlers = {};

// この端末でアプリ内カメラが使えるか(使えなければカメラボタンを出さない)
export function isCameraSupported() {
  return !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') && !!el.overlay;
}

export function isCameraOpen() {
  return !!el.overlay && !el.overlay.hidden;
}

// カメラ画面を開く。
// - canShoot(): シャッターを押したとき、撮ってよいか(上限枚数など。だめなら false を返し、理由は自分で知らせる)
// - onShot({ blob, timeMs, closeIfWaiting }): 撮った画像(JPEG)と撮影時刻。
//   closeIfWaiting() は、この撮影のカメラ画面が(保存を待って)まだ開いていれば閉じて true を返す
//   (× などで既に閉じられていれば何もせず false)。保存が済んだとき・失敗したときに呼ぶ
// - onError(message): カメラを起動できなかったとき
// - onIdleClose(): 操作が無く自動で閉じたとき
export async function openCamera(options = {}) {
  if (!isCameraSupported() || isCameraOpen()) return;
  handlers = options;
  session++;
  el.btnShutter.disabled = false;
  setCameraStatus(t('camera.starting'));
  el.overlay.hidden = false;
  resetIdleTimer();
  let s;
  try {
    s = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
  } catch (err) {
    closeCamera();
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    handlers.onError?.(denied ? t('camera.denied') : t('camera.failed', { message: err?.message || err?.name || '' }));
    return;
  }
  // 許可を尋ねている間に閉じられていたら、取れた映像はすぐ止める
  if (!isCameraOpen()) {
    s.getTracks().forEach((track) => track.stop());
    return;
  }
  stream = s;
  el.video.srcObject = stream;
  try { await el.video.play(); } catch { /* autoplay 属性で再生される */ }
  setCameraStatus('');
}

// カメラ画面を閉じ、映像を止める。止めないとカメラが使われたままになり電池を使い続ける。
export function closeCamera() {
  clearTimeout(idleTimer);
  idleTimer = null;
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  if (el.video) el.video.srcObject = null;
  if (el.overlay) el.overlay.hidden = true;
}

// カメラ画面の下部に出す状態の文言(位置の取得中・保存した など)
export function setCameraStatus(text) {
  if (el.status) el.status.textContent = text || '';
}

// 操作が無いまま開いているカメラを閉じる(ポケットの中で開いたままになるのを防ぐ)
function resetIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!isCameraOpen()) return;
    closeCamera();
    handlers.onIdleClose?.();
  }, CAMERA_IDLE_CLOSE_SEC * 1000);
}

// シャッター: 映像の今のコマを、長辺 PHOTO_MAX_EDGE_PX に縮めて JPEG にする。
// 撮ったら映像を止めてシャッターを押せなくし、保存が済むのを待つ(閉じるのは onShot 側)
function takeShot() {
  resetIdleTimer();
  const video = el.video;
  if (el.btnShutter.disabled) return;
  if (!stream || !video.videoWidth || !video.videoHeight) return;
  if (handlers.canShoot && !handlers.canShoot()) return;
  el.btnShutter.disabled = true;
  const shotSession = session;
  const closeIfWaiting = () => {
    if (session !== shotSession || !isCameraOpen()) return false;
    closeCamera();
    return true;
  };
  const timeMs = Date.now();
  const scale = Math.min(1, PHOTO_MAX_EDGE_PX / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  // 撮れたことが分かるよう、画面を一瞬白く光らせる
  el.flash.classList.remove('is-flashing');
  void el.flash.offsetWidth;
  el.flash.classList.add('is-flashing');
  // 撮ったコマを見せたまま止める(保存を待つ間の画面)
  video.pause();
  canvas.toBlob((blob) => {
    if (!blob) {
      closeIfWaiting();
      handlers.onError?.(t('camera.failed', { message: 'toBlob' }));
      return;
    }
    handlers.onShot?.({ blob, timeMs, closeIfWaiting });
  }, 'image/jpeg', PHOTO_JPEG_QUALITY);
}

if (el.overlay) {
  el.btnShutter.addEventListener('click', takeShot);
  el.btnClose.addEventListener('click', closeCamera);
  // 画面に触れていれば使っているとみなし、自動で閉じるまでの時間を延ばす
  el.overlay.addEventListener('pointerdown', resetIdleTimer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isCameraOpen()) closeCamera();
  });
  // 他のアプリへ切り替えた・画面が消えたときは閉じる(映像を止め、カメラを手放す)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' && isCameraOpen()) closeCamera();
  });
}
