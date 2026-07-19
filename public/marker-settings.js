// マーカー設定モジュール
// 地図上の各マーカー(緊急ポイント/ルート/スポット/移動記録関連等)の色・形状・サイズを
// 設定UIで編集し、localStorage に保存して地図へ反映する。

import {
  MARKER_SETTINGS_KEY, MARKER_TYPES, MARKER_SHAPES
} from './config.js';
import {
  setEmergencyStyle,
  setHikingRouteStyle, setHikingSpotStyle,
  setClosureClosedStyle, setClosureDifficultStyle
} from './map.js';
import { setTrackStyle, setTrackStartStyle, setTrackCurrentStyle } from './geolocation.js';
import { t } from './i18n.js';

const el = {
  markerSettingsList: document.getElementById('markerSettingsList'),
  btnResetMarkerSettings: document.getElementById('btnResetMarkerSettings')
};

// 設定UIの描画と「規定値に戻す」ボタンの登録(初期化時に一度呼ぶ)
export function initMarkerSettings() {
  renderMarkerSettings();
  el.btnResetMarkerSettings.addEventListener('click', resetMarkerSettings);
}

// 保存済み設定を既定値で埋めて返す(初期スタイル適用にも使用)
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
      color: s.color || m.color,
      shape: s.shape || m.shape,
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
    label.textContent = name;
    row.appendChild(label);

    const controls = document.createElement('div');
    controls.className = 'marker-controls';

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'marker-color';
    colorInput.value = cur.color;
    colorInput.setAttribute('aria-label', t('markerSettings.ariaColor', { name }));
    colorInput.addEventListener('input', () => updateMarkerSetting(m.key, 'color', colorInput.value));
    controls.appendChild(colorInput);

    const shapeSelect = document.createElement('select');
    shapeSelect.className = 'marker-shape';
    shapeSelect.setAttribute('aria-label', t('markerSettings.ariaShape', { name }));
    for (const shape of MARKER_SHAPES) {
      const opt = document.createElement('option');
      opt.value = shape;
      opt.textContent = t(`markerShape.${shape}`);
      if (shape === cur.shape) opt.selected = true;
      shapeSelect.appendChild(opt);
    }
    shapeSelect.addEventListener('change', () => updateMarkerSetting(m.key, 'shape', shapeSelect.value));
    controls.appendChild(shapeSelect);

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
}

function updateMarkerSetting(key, attr, value) {
  const settings = readMarkerSettings();
  if (!settings[key]) return;
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
