// マーカー設定モジュール
// 地図上の各マーカー(緊急ポイント/ルート/スポット/移動記録関連等)の色・形状・サイズを
// 設定UIで編集し、localStorage に保存して地図へ反映する。

import {
  MARKER_SETTINGS_KEY, MARKER_SETTINGS_REV_KEY, MARKER_TYPES, MARKER_SHAPES, MARKER_SHAPE_SYMBOLS
} from './config.js';
import {
  setEmergencyStyle,
  setHikingRouteStyle, setHikingSpotStyle,
  setClosureClosedStyle, setClosureDifficultStyle,
  shapeToSVG
} from './map.js';
import { setTrackStyle, setTrackStartStyle, setTrackCurrentStyle } from './geolocation.js';
import { t } from './i18n.js';

const el = {
  markerSettingsList: document.getElementById('markerSettingsList'),
  markerSettingsNotes: document.getElementById('markerSettingsNotes'),
  btnResetMarkerSettings: document.getElementById('btnResetMarkerSettings')
};

// ===== 既定値の変更に合わせた保存値の置き換え(各段階1回だけ) =====
// マーカー設定は全種別をまとめて保存するため、一度でも設定を変えた端末には、変えていない種別の
// 既定値もそのまま残る。既定値を変えてもその端末には反映されないため、旧既定のままの値だけを置き換える。
// 行った段階を MARKER_SETTINGS_REV_KEY に残し、以降は利用者が同じ値を選んでもそのままにする。
//   段階1(2026.63): 通行困難地点の既定サイズを 24px にした。旧既定の 20px(2026.58〜)・
//   16px(〜2026.57)だけを置き換え、利用者が選んだ他のサイズは変えない。
const MARKER_SETTINGS_REV = 1;
const CLOSURE_DIFFICULT_OLD_DEFAULT_SIZES = [20, 16];

function migrateMarkerSettings() {
  try {
    const rev = Number(localStorage.getItem(MARKER_SETTINGS_REV_KEY)) || 0;
    if (rev >= MARKER_SETTINGS_REV) return;
    const raw = localStorage.getItem(MARKER_SETTINGS_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    const difficult = saved && saved.closureDifficult;
    if (difficult && CLOSURE_DIFFICULT_OLD_DEFAULT_SIZES.includes(difficult.size)) {
      difficult.size = MARKER_TYPES.find((m) => m.key === 'closureDifficult').size;
      localStorage.setItem(MARKER_SETTINGS_KEY, JSON.stringify(saved));
    }
    // 保存が無い端末も印を付ける(以後に利用者が 20px 等を選んでも置き換えない)
    localStorage.setItem(MARKER_SETTINGS_REV_KEY, String(MARKER_SETTINGS_REV));
  } catch { /* 保存を読めない・書けない環境では何もしない(表示は既定値か保存値で続く) */ }
}
// 初期スタイルの読み出し(readMarkerSettings)より前に済ませるため、読み込み時に行う
migrateMarkerSettings();

// 設定UIの描画と「規定値に戻す」ボタンの登録(初期化時に一度呼ぶ)
export function initMarkerSettings() {
  renderMarkerSettings();
  el.btnResetMarkerSettings.addEventListener('click', resetMarkerSettings);
}

// 変更不可の属性か(config.js の MARKER_TYPES の locked で指定)
function isLocked(m, attr) {
  return Array.isArray(m.locked) && m.locked.includes(attr);
}

// 保存済みの形状が今も選択肢にあるか(廃止した ✖ 等が保存されている場合に既定値へ戻すため)
function isSelectableShape(shape) {
  return MARKER_SHAPES.includes(shape);
}

// 保存済み設定を既定値で埋めて返す(初期スタイル適用にも使用)。
// 変更不可の属性は保存値があっても既定値を使う。
export function readMarkerSettings() {
  let saved = {};
  try {
    const raw = localStorage.getItem(MARKER_SETTINGS_KEY);
    if (raw) saved = JSON.parse(raw) || {};
  } catch { /* noop */ }
  const merged = {};
  for (const m of MARKER_TYPES) {
    const s = saved[m.key] || {};
    merged[m.key] = {
      color: (!isLocked(m, 'color') && s.color) || m.color,
      shape: (!isLocked(m, 'shape') && isSelectableShape(s.shape) && s.shape) || m.shape,
      size: Number.isFinite(s.size) ? s.size : m.size
    };
  }
  return merged;
}

function writeMarkerSettings(settings) {
  try { localStorage.setItem(MARKER_SETTINGS_KEY, JSON.stringify(settings)); } catch { /* noop */ }
}

function renderMarkerSettings() {
  if (!el.markerSettingsList) return;
  const settings = readMarkerSettings();
  el.markerSettingsList.innerHTML = '';

  for (const m of MARKER_TYPES) {
    const cur = settings[m.key];
    // 表示名は辞書から導出(markerType.<key>)
    const name = t(`markerType.${m.key}`);

    const row = document.createElement('div');
    row.className = 'marker-row';

    const label = document.createElement('span');
    label.className = 'marker-label';
    // 変更不可の属性がある種別は注記番号を付ける(注記文はリスト下部に表示)
    label.textContent = m.note ? `${name} ${noteMark(m.note)}` : name;
    row.appendChild(label);

    const controls = document.createElement('div');
    controls.className = 'marker-controls';

    if (isLocked(m, 'color')) {
      // 変更不可の色は入力部品を使わず、その色で塗った見本を出す。
      // disabled の input[type=color] はブラウザによって薄く描かれ、
      // 実際と違う色(赤→ピンク等)に見えてしまうため
      const swatch = document.createElement('span');
      swatch.className = 'marker-color marker-color-locked';
      swatch.style.backgroundColor = cur.color;
      swatch.setAttribute('role', 'img');
      swatch.setAttribute('aria-label', t('markerSettings.ariaColor', { name }));
      controls.appendChild(swatch);
    } else {
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.className = 'marker-color';
      colorInput.value = cur.color;
      colorInput.setAttribute('aria-label', t('markerSettings.ariaColor', { name }));
      colorInput.addEventListener('input', () => updateMarkerSetting(m.key, 'color', colorInput.value));
      controls.appendChild(colorInput);
    }

    controls.appendChild(buildShapeControl(m, cur.shape, name));

    const sizeInput = document.createElement('input');
    sizeInput.type = 'number';
    sizeInput.className = 'marker-size';
    sizeInput.min = '1';
    sizeInput.max = '50';
    sizeInput.value = String(cur.size);
    sizeInput.setAttribute('aria-label', t('markerSettings.ariaSize', { name }));
    sizeInput.addEventListener('change', () => {
      const v = parseInt(sizeInput.value, 10);
      if (Number.isFinite(v) && v > 0) updateMarkerSetting(m.key, 'size', v);
    });
    controls.appendChild(sizeInput);

    const unit = document.createElement('span');
    unit.className = 'marker-size-unit';
    unit.textContent = 'px';
    controls.appendChild(unit);

    row.appendChild(controls);
    el.markerSettingsList.appendChild(row);
  }

  renderMarkerSettingsNotes();
}

// 形状の見本(一覧の形状欄に出す図形)の一辺(px)と、色を固定しない種別の塗り色。
// 色が固定の種別(進入禁止・警戒)は中の横棒・「!」が読めるよう少し大きくする
const SHAPE_PREVIEW_SIZE = 16;
const SHAPE_PREVIEW_SIZE_SIGN = 20;
const SHAPE_PREVIEW_COLOR = '#222';

// 形状の見本は地図のマーカーと同じ SVG で描く。記号の文字(● 等)は端末のフォントに
// よって大きさがばらつく(欧文フォントの ● は ■ の半分ほどになる)ため使わない。
// 色が固定の種別(進入禁止・警戒)はその色で、それ以外は文字色で描く
function shapePreviewSVG(m, shape) {
  if (isLocked(m, 'color')) return shapeToSVG(shape, m.color, SHAPE_PREVIEW_SIZE_SIGN);
  return shapeToSVG(shape, SHAPE_PREVIEW_COLOR, SHAPE_PREVIEW_SIZE);
}

// 形状の入力部品。一覧を狭くするため形状の見本だけを表示し、ドロップダウンを開いたときは
// 「記号 名称」を並べる。<select> は閉じた表示と選択肢の文字を分けられないので、
// 透明にした <select> を見本の枠に重ねる(開く操作・キー操作・読み上げは <select> が担う)。
// 変更不可の種別は <select> を使わず、見本だけを表示する。
function buildShapeControl(m, shape, name) {
  const box = document.createElement('span');
  box.className = 'marker-shape-box';

  const symbol = document.createElement('span');
  symbol.className = 'marker-shape-symbol';
  symbol.innerHTML = shapePreviewSVG(m, shape);
  box.appendChild(symbol);

  if (isLocked(m, 'shape')) {
    box.classList.add('marker-shape-locked');
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label',
      `${t('markerSettings.ariaShape', { name })}: ${t(`markerShape.${shape}`)}`);
    return box;
  }

  symbol.setAttribute('aria-hidden', 'true');
  const caret = document.createElement('span');
  caret.className = 'marker-shape-caret';
  caret.setAttribute('aria-hidden', 'true');
  box.appendChild(caret);

  const select = document.createElement('select');
  select.className = 'marker-shape';
  select.setAttribute('aria-label', t('markerSettings.ariaShape', { name }));
  for (const value of MARKER_SHAPES) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = `${MARKER_SHAPE_SYMBOLS[value]} ${t(`markerShape.${value}`)}`;
    if (value === shape) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => {
    symbol.innerHTML = shapePreviewSVG(m, select.value);
    updateMarkerSetting(m.key, 'shape', select.value);
  });
  box.appendChild(select);
  return box;
}

// 注記番号の表記(ラベルと注記で共用し、日英で書式を揃える)
function noteMark(n) {
  return `(*${n})`;
}

// リスト下部の注記。MARKER_TYPES で使われている注記番号だけを番号順に出す
function renderMarkerSettingsNotes() {
  if (!el.markerSettingsNotes) return;
  el.markerSettingsNotes.innerHTML = '';
  const notes = [...new Set(MARKER_TYPES.map(m => m.note).filter(Boolean))].sort((a, b) => a - b);
  for (const n of notes) {
    const span = document.createElement('span');
    span.textContent = `${noteMark(n)} ${t(`markerSettings.noteText${n}`)}`;
    el.markerSettingsNotes.appendChild(span);
  }
}

function updateMarkerSetting(key, attr, value) {
  const settings = readMarkerSettings();
  const m = MARKER_TYPES.find(x => x.key === key);
  if (!settings[key] || !m || isLocked(m, attr)) return;
  settings[key][attr] = value;
  writeMarkerSettings(settings);
  applyMarkerSettingToMap(key, settings[key]);
}

// 設定変更を地図側へ反映(未実装の種別は noop)
function applyMarkerSettingToMap(key, style) {
  if (key === 'emergency') setEmergencyStyle(style);
  else if (key === 'hikingRoute') setHikingRouteStyle(style);
  else if (key === 'spot') setHikingSpotStyle(style);
  else if (key === 'closureClosed') setClosureClosedStyle(style);
  else if (key === 'closureDifficult') setClosureDifficultStyle(style);
  else if (key === 'track') setTrackStyle(style);
  else if (key === 'trackStart') setTrackStartStyle(style);
  else if (key === 'trackCurrent') setTrackCurrentStyle(style);
}

// 規定値に戻す: config.js の MARKER_TYPES の値で localStorage を上書きし、
// UI と地図の両方に反映する
function resetMarkerSettings() {
  if (!confirm(t('markerSettings.resetConfirm'))) return;
  const defaults = {};
  for (const m of MARKER_TYPES) {
    defaults[m.key] = { color: m.color, shape: m.shape, size: m.size };
  }
  writeMarkerSettings(defaults);
  renderMarkerSettings();
  for (const m of MARKER_TYPES) {
    applyMarkerSettingToMap(m.key, defaults[m.key]);
  }
}
