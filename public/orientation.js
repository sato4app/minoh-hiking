// 端末の向き(方位)の取得
// スマートフォンを水平に置いた状態で、画面の上が指している方位
// (真北を 0 とし、東回りに 0〜360 度)を返す。現在地点表示ボタンの扇形に使う。
//
// 取得のしかたは端末で異なる:
//   iOS   … DeviceOrientationEvent の webkitCompassHeading(非標準)。
//           Core Location が偏角を補正済みのため、そのまま真北基準で使える。
//           iOS 13 以降は requestPermission() を**ユーザー操作の中から**呼ぶ必要がある。
//   その他 … deviceorientationabsolute の alpha(磁北基準・反時計回り)。
//           画面の回転と、磁北→真北の偏角を補正して使う。
//
// 磁気センサーは値が揺れるため、円周上で平滑化してから返す(そのまま描くと扇形が震える)。
// センサーが無い(PC 等)・許可されなかった場合は null を返し、
// 呼び出し側は方位を使わない(円のまま縮める)。
//
// 精度は端末の校正状態や周囲の磁気(磁石入りケース・鉄骨・車内)に左右されるため、
// 数十度ずれることがある。方角の目安を示す用途に限る。

// 箕面付近の磁気偏角(西偏。真方位 = 磁方位 + この値)。
// 地理院地図は真北が上のため、磁北基準で来る値はこれで補正する。
// iOS の webkitCompassHeading は補正済みなので適用しない。
const DECLINATION_DEG = -7.5;

// 平滑化の強さ(0 に近いほど滑らかだが追従が遅い)
const SMOOTHING = 0.25;

// 最初の値が届くのを待つ上限[ms]。センサーは登録直後に発火するため短くてよい
const FIRST_READING_TIMEOUT_MS = 500;

let heading = null;      // 平滑化後の方位(度)。一度も取れていなければ null
let listening = false;
let eventName = null;
// 最初の値を待って届かなかったか。センサーが無い端末(PC 等)で
// 押すたびに待たされないよう、2回目からは待たずに「使えない」と返す
let firstWaitTimedOut = false;

// 0〜360 度に丸める
function normalize(deg) {
  return ((deg % 360) + 360) % 360;
}

// イベントから方位(真北基準・度)を読む。使えない値なら null
function readHeading(e) {
  // iOS: 真北基準の値がそのまま来る。
  // webkitCompassAccuracy が負のときは校正できておらず、値が信用できない
  const compass = e.webkitCompassHeading;
  if (typeof compass === 'number' && !Number.isNaN(compass)) {
    if (typeof e.webkitCompassAccuracy === 'number' && e.webkitCompassAccuracy < 0) return null;
    return normalize(compass);
  }
  // その他: alpha は磁北基準で反時計回りのため、時計回りの方位へ直す。
  // absolute が false の端末(相対的な向きしか出ない)は方位に使えない
  if (e.absolute === false) return null;
  if (typeof e.alpha !== 'number' || Number.isNaN(e.alpha)) return null;
  // 横画面では端末の上と画面の上がずれるため、画面の回転ぶんを足す
  const screenAngle = screen.orientation?.angle ?? 0;
  return normalize(360 - e.alpha + screenAngle + DECLINATION_DEG);
}

// 円周上の平滑化。0 度と 360 度をまたぐとき単純な平均では反対を向いてしまうため、
// 差を -180〜180 度に畳んでから少しずつ寄せる
function smooth(prev, next) {
  if (prev === null) return next;
  const diff = ((next - prev + 540) % 360) - 180;
  return normalize(prev + diff * SMOOTHING);
}

function onOrientation(e) {
  const raw = readHeading(e);
  if (raw === null) return;
  heading = smooth(heading, raw);
}

// 方位の受信を始める。すでに受信中なら何もしない
function startHeadingWatch() {
  if (listening || !window.DeviceOrientationEvent) return;
  // 絶対方位が来るイベントを優先する(Android 系)。無ければ通常のイベント(iOS はこちら)
  eventName = ('ondeviceorientationabsolute' in window)
    ? 'deviceorientationabsolute'
    : 'deviceorientation';
  window.addEventListener(eventName, onOrientation, true);
  listening = true;
}

// 受信を止める。直近の方位は残す(次に押したときすぐ扇形を出せるようにするため。
// 受信を再開すれば 1 フレームで最新値に入れ替わる)
export function stopHeadingWatch() {
  if (!listening) return;
  window.removeEventListener(eventName, onOrientation, true);
  listening = false;
}

// 平滑化後の方位(度・真北基準)。一度も取れていなければ null
export function getHeading() {
  return heading;
}

// 最初の値が届くまで待つ(上限あり)。すでに値があれば待たない
function waitForFirstHeading() {
  if (heading !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const started = performance.now();
    const check = () => {
      if (heading !== null || performance.now() - started >= FIRST_READING_TIMEOUT_MS) {
        resolve();
        return;
      }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

// 現在地点表示ボタンのタップから呼ぶ。必要なら利用許可を求め、受信を始めて、
// 最初の値が届くまで(上限つきで)待つ。
// 戻り値: 'granted'(方位を使える) / 'unavailable'(使えない)
//
// 判定は「許可の返事」ではなく**実際に方位が届いたか**で行う。
// requestPermission は iOS だけのものと考えがちだが Chromium にもあり、
// センサーが無い環境では 'denied' を返す。返事で打ち切ると、
// 許可の要らない端末まで方位を使えなくなってしまうため、返事にかかわらず受信を試す。
export async function prepareHeading() {
  const DeviceOrientation = window.DeviceOrientationEvent;
  if (!DeviceOrientation) return 'unavailable';

  // iOS 13 以降は許可が要る。ユーザー操作の中から呼ぶ必要があるため、
  // ボタンのハンドラから他の待ち合わせより先に呼ぶこと
  if (typeof DeviceOrientation.requestPermission === 'function') {
    try {
      await DeviceOrientation.requestPermission();
    } catch {
      // ユーザー操作の外から呼ばれた場合など。受信できるかは下で確かめる
    }
  }

  startHeadingWatch();
  if (heading === null && !firstWaitTimedOut) {
    await waitForFirstHeading();
    if (heading === null) firstWaitTimedOut = true;
  }
  // 待っても届かない(センサーが無い・許可されなかった)ときは方位を使わない
  return heading === null ? 'unavailable' : 'granted';
}
