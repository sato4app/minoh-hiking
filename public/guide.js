// 使い方ガイド
// 起動時画面の「使い方」ボタン(と初回起動時の自動表示)から、アプリの使い方を
// 1ページずつ案内する。説明している場所だけを明るく残して周囲を暗くし、
// ページに合わせて画面(起動時画面 / ハイキングマップ表示)と表示設定パネル(≡)の
// 開閉も切り替える。
//
// 案内中に受け付ける操作は「戻る」「次へ」「閉じる」だけで、明るく残した場所も
// 含めて画面全体をオーバーレイがタップを受け止める。案内はページごとに画面を
// 切り替えるため、下の画面を自由に操作できると説明と食い違ってしまうため。
//
// 閉じたときは、開く前の画面と表示設定パネルの開閉状態に戻す。
//
// 文言は i18n の翻訳キー(guide.<キー>Title / guide.<キー>Body)から取る。ページを増やすときは
// GUIDE_STEPS に足し、i18n.js に同じキーの ja/en を追加する。

import { GUIDE_SEEN_KEY } from './config.js';
import { t } from './i18n.js';

// 明るく残す場所の外側に取る余白(px)
const GUIDE_PAD = 8;
// 吹き出しと、明るく残した場所とのすき間(px)
const TIP_GAP = 10;
// 明るく残した場所の上下に吹き出しを置くとき、これより狭ければ諦めて画面の中央に出す(px)。
// 狭すぎる帯に押し込めると本文がほとんど読めなくなるため
const TIP_MIN_HEIGHT = 120;

// ガイドの各ページ。
// - key     … 翻訳キーの一部(guide.<key>Title / guide.<key>Body)
// - view    … このページを見せる画面('home' / 'map')
// - panel   … ハイキングマップ表示の表示設定パネル(≡)を開くか(既定は閉じる)
// - targets … 明るく残す場所の CSS セレクタ。複数指定すると全部を囲む1つの枠にまとめる。
//             空にすると画面全体を暗くし、吹き出しを中央に出す
const GUIDE_STEPS = [
  {
    key: 'intro',
    view: 'home',
    targets: []
  },
  {
    key: 'showMap',
    view: 'home',
    targets: ['[data-guide="homeShowMap"]']
  },
  {
    key: 'download',
    view: 'home',
    targets: ['[data-guide="homeDownload"]']
  },
  {
    key: 'version',
    view: 'home',
    targets: ['[data-guide="homeVersion"]']
  },
  {
    key: 'settings',
    view: 'home',
    targets: ['[data-guide="homeSettings"]']
  },
  {
    key: 'guideQr',
    view: 'home',
    targets: ['[data-guide="homeGuide"]', '[data-guide="homeQr"]']
  },
  {
    // 地図に重なる情報の説明。特定の場所ではなく地図全体の話なので枠は出さない
    key: 'mapOverlay',
    view: 'map',
    targets: []
  },
  {
    // 地図の右下(縮尺・ズームレベル・ズーム・現在地点表示ボタン)。
    // Leaflet が組み立てる部分のため、data-guide ではなく Leaflet のクラス名で指す
    key: 'mapControls',
    view: 'map',
    targets: ['.leaflet-bottom.leaflet-right']
  },
  {
    key: 'mapMenu',
    view: 'map',
    panel: true,
    targets: [
      '[data-guide="mapMenuBtn"]',
      '[data-guide="panelCurrentMarker"]',
      '[data-guide="panelCenterCurrent"]'
    ]
  },
  {
    key: 'mapTrack',
    view: 'map',
    panel: true,
    targets: [
      '[data-guide="panelTrackRecording"]',
      '#trackStats',
      '[data-guide="panelTrackActions"]'
    ]
  },
  {
    key: 'mapFinish',
    view: 'map',
    panel: true,
    targets: ['[data-guide="panelMarkerSettings"]', '[data-guide="panelBack"]']
  }
];

// ===== 状態 =====
let el = null; // DOM 参照(initGuide で確定)
let hooks = null; // 画面切替などの依頼先(app.js から受け取る)
let stepIndex = null; // 表示中のページ番号(null は非表示)
let restore = null; // 開く前の画面・表示設定パネルの状態(閉じるときに戻す)

// ===== 表示した記録(初回起動時だけ自動で開くために使う) =====
// localStorage が使えない環境では「開いた」扱いにして、起動のたびに自動表示されないようにする
function readGuideSeen() {
  try {
    return localStorage.getItem(GUIDE_SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

function writeGuideSeen() {
  try {
    localStorage.setItem(GUIDE_SEEN_KEY, '1');
  } catch { /* 保存できなくてもガイド自体は動く */ }
}

// ===== 初期化 =====
// hooks で app.js の画面切替を借りる(guide.js から app.js を import すると
// 相互参照になるため、必要な操作だけ関数で受け取る)。
//   showView(name)          … 'home' / 'map' へ切り替える
//   getCurrentView()        … 表示中の画面名を返す
//   isLayerPanelOpen()      … 表示設定パネル(≡)が開いているか
//   setLayerPanelOpen(open) … 表示設定パネル(≡)を開く/閉じる
export function initGuide(options) {
  hooks = options;
  el = {
    overlay: document.getElementById('guideOverlay'),
    shadeTop: document.getElementById('guideShadeTop'),
    shadeBottom: document.getElementById('guideShadeBottom'),
    shadeLeft: document.getElementById('guideShadeLeft'),
    shadeRight: document.getElementById('guideShadeRight'),
    ring: document.getElementById('guideRing'),
    tip: document.getElementById('guideTip'),
    tipPanel: document.getElementById('guideTipPanel'),
    title: document.getElementById('guideTitle'),
    count: document.getElementById('guideCount'),
    body: document.getElementById('guideBody'),
    btnClose: document.getElementById('btnGuideClose'),
    btnPrev: document.getElementById('btnGuidePrev'),
    btnNext: document.getElementById('btnGuideNext')
  };

  el.btnClose.addEventListener('click', closeGuide);
  el.btnPrev.addEventListener('click', () => moveGuide(-1));
  el.btnNext.addEventListener('click', () => moveGuide(1));

  // 画面の向きや大きさが変わると明るく残す場所もずれるため測り直す
  window.addEventListener('resize', layoutGuide);
  window.addEventListener('orientationchange', layoutGuide);

  // パソコンでの操作(Esc で閉じる、左右キーでページ送り)
  document.addEventListener('keydown', (e) => {
    if (stepIndex === null) return;
    if (e.key === 'Escape') closeGuide();
    else if (e.key === 'ArrowRight') moveGuide(1);
    else if (e.key === 'ArrowLeft' && stepIndex > 0) moveGuide(-1);
  });
}

// ===== 開く・閉じる・ページ送り =====
// 起動時画面の「使い方」ボタンから開く
export function openGuide() {
  // 起動処理の途中(bindEvents 済み・initGuide 前)に押されることがあるため、
  // 初期化が終わるまでは何もしない
  if (!hooks || stepIndex !== null) return;
  // 閉じたときに戻す先を控える
  restore = {
    view: hooks.getCurrentView(),
    panelOpen: hooks.isLayerPanelOpen()
  };
  writeGuideSeen();
  stepIndex = 0;
  renderStep();
}

// 初回起動時だけ自動で開く。開いた時点で「見た」ことにするので、
// 途中で閉じても次回からは自動で出さない(「使い方」ボタンからは何度でも開ける)。
// モーダルが開いているときは、その操作を邪魔しないよう見送る
export function maybeAutoOpenGuide() {
  if (readGuideSeen()) return;
  if (document.querySelector('.modal:not([hidden])')) return;
  openGuide();
}

function closeGuide() {
  if (stepIndex === null) return;
  stepIndex = null;
  el.overlay.hidden = true;
  // 開く前の画面・パネルの状態に戻す。showView() はパネルを閉じるため、
  // パネルの復元は画面を戻した後に行う
  if (restore) {
    if (hooks.getCurrentView() !== restore.view) hooks.showView(restore.view);
    hooks.setLayerPanelOpen(restore.panelOpen);
    restore = null;
  }
}

// ページを送る。端をはみ出したら閉じる(最後のページの「終わり」もここを通る)
function moveGuide(delta) {
  if (stepIndex === null) return;
  const next = stepIndex + delta;
  if (next < 0 || next >= GUIDE_STEPS.length) {
    closeGuide();
    return;
  }
  stepIndex = next;
  renderStep();
}

// ===== 描画 =====
function renderStep() {
  const step = GUIDE_STEPS[stepIndex];

  // ページに必要な画面とパネルの状態にしてから測る。
  // showView() は現在地監視の開始・地図の再計算を伴うため、画面が変わるときだけ呼ぶ
  if (hooks.getCurrentView() !== step.view) hooks.showView(step.view);
  hooks.setLayerPanelOpen(step.view === 'map' && !!step.panel);

  el.title.textContent = t(`guide.${step.key}Title`);
  el.body.textContent = t(`guide.${step.key}Body`);
  el.count.textContent = `${stepIndex + 1} / ${GUIDE_STEPS.length}`;
  el.btnPrev.disabled = stepIndex === 0;
  el.btnNext.textContent = stepIndex === GUIDE_STEPS.length - 1 ? t('guide.finish') : t('guide.next');
  el.overlay.hidden = false;

  layoutGuide();
  // 画面を切り替えた直後は配置が定まっていないことがあるため、描画後にもう一度測る
  requestAnimationFrame(layoutGuide);
}

// 明るく残す場所を測る。複数を指定したときは、全部を囲む1つの枠にまとめる。
// 見つからない・大きさが無い(非表示)ときは null を返し、画面全体を暗くする
function measureTargets(selectors) {
  if (!selectors || selectors.length === 0) return null;
  let box = null;
  for (const selector of selectors) {
    for (const target of document.querySelectorAll(selector)) {
      const r = target.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      box = box === null
        ? { top: r.top, left: r.left, right: r.right, bottom: r.bottom }
        : {
          top: Math.min(box.top, r.top),
          left: Math.min(box.left, r.left),
          right: Math.max(box.right, r.right),
          bottom: Math.max(box.bottom, r.bottom)
        };
    }
  }
  return box;
}

// 4枚の帯・輪郭・吹き出しを、いまの画面に合わせて置き直す
function layoutGuide() {
  if (stepIndex === null) return;
  const box = measureTargets(GUIDE_STEPS[stepIndex].targets);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const px = (n) => `${Math.max(0, n)}px`;

  // 明るく残す枠。場所が無いページは左上に大きさ 0 の枠を置く
  // (上・左・右の帯が 0 になり、下の帯だけで画面全体が暗くなる)
  const hole = box
    ? {
      top: box.top - GUIDE_PAD,
      left: box.left - GUIDE_PAD,
      right: box.right + GUIDE_PAD,
      bottom: box.bottom + GUIDE_PAD
    }
    : { top: 0, left: 0, right: 0, bottom: 0 };

  el.shadeTop.style.cssText = `top:0;left:0;width:${px(vw)};height:${px(hole.top)}`;
  el.shadeBottom.style.cssText = `top:${px(hole.bottom)};left:0;width:${px(vw)};height:${px(vh - hole.bottom)}`;
  const bandTop = px(hole.top);
  const bandHeight = px(hole.bottom - hole.top);
  el.shadeLeft.style.cssText = `top:${bandTop};height:${bandHeight};left:0;width:${px(hole.left)}`;
  el.shadeRight.style.cssText = `top:${bandTop};height:${bandHeight};left:${px(hole.right)};width:${px(vw - hole.right)}`;

  el.ring.hidden = !box;
  if (box) {
    el.ring.style.cssText =
      `top:${px(hole.top)};left:${px(hole.left)};width:${px(hole.right - hole.left)};height:${px(hole.bottom - hole.top)}`;
  }

  // 吹き出しの縦位置。明るく残した場所と重ならない側に出す。
  // 置ける高さは本文の量とページによって変わるため、決め打ちにせず実際の高さを測る
  // (横向きの画面など、縦が狭いときに画面からはみ出さないようにするため)。
  const tip = el.tip.style;
  tip.top = '';
  tip.bottom = '';
  tip.transform = '';
  el.tipPanel.style.maxHeight = ''; // 前のページで狭めた指定を外してから測る
  const tipHeight = el.tip.getBoundingClientRect().height;
  // 置ける範囲からセーフエリア(ステータスバー・ノッチ・ホームインジケータ)を除く。
  // オーバーレイは画面いっぱい(position: fixed)のため、除かないと吹き出しの端が隠れる
  const rootStyle = getComputedStyle(document.documentElement);
  const safeInset = (name) => parseFloat(rootStyle.getPropertyValue(name)) || 0;
  const spaceBelow = vh - safeInset('--safe-area-bottom') - hole.bottom - TIP_GAP;
  const spaceAbove = hole.top - safeInset('--safe-area-top') - TIP_GAP;
  const roomiest = Math.max(spaceBelow, spaceAbove);

  if (!box || roomiest < TIP_MIN_HEIGHT) {
    // 明るく残す場所が無いページと、上下どちらも狭すぎるときは画面の中央に出す
    // (高さは CSS の max-height に任せる)
    tip.top = '50%';
    tip.transform = 'translateY(-50%)';
    return;
  }

  // どちらかにそのまま収まるならその側へ。収まらないときは広い側に置き、
  // はみ出さないよう高さを空きに合わせる(中はスクロールできる)
  const below = spaceBelow >= tipHeight
    ? true
    : (spaceAbove >= tipHeight ? false : spaceBelow >= spaceAbove);
  if (below) {
    tip.top = px(hole.bottom + TIP_GAP);
    if (tipHeight > spaceBelow) el.tipPanel.style.maxHeight = px(spaceBelow);
  } else {
    tip.bottom = px(vh - hole.top + TIP_GAP);
    if (tipHeight > spaceAbove) el.tipPanel.style.maxHeight = px(spaceAbove);
  }
}
