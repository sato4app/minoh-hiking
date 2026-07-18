// メッセージ履歴モジュール
// 主要な操作・状態(起動時のバージョン確認、地図のダウンロード、移動記録の開始・終了など)を
// localStorage に蓄積し、「設定と情報」モーダルの「メッセージ履歴の表示」で一覧表示する。

import { MESSAGE_LOG_KEY, MESSAGE_LOG_MAX } from './config.js';

const el = {
  messageList: document.getElementById('messageList'),
  messageEmpty: document.getElementById('messageEmpty'),
  infoMessagesBody: document.getElementById('infoMessagesBody')
};

// 履歴に1件追加する。「設定と情報」モーダルで履歴を表示中なら即時再描画する。
export function logHistory(text, level) {
  if (!text) return;
  const log = readMessageLog();
  log.push({ t: Date.now(), text, level: level || '' });
  while (log.length > MESSAGE_LOG_MAX) log.shift();
  try { localStorage.setItem(MESSAGE_LOG_KEY, JSON.stringify(log)); } catch { /* noop */ }
  if (el.infoMessagesBody && !el.infoMessagesBody.hidden) renderMessageList();
}

function readMessageLog() {
  try {
    const raw = localStorage.getItem(MESSAGE_LOG_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// 履歴を新しい順に描画する。空なら「履歴はありません」を表示。
export function renderMessageList() {
  const log = readMessageLog();
  el.messageList.innerHTML = '';
  if (log.length === 0) {
    el.messageEmpty.hidden = false;
    return;
  }
  el.messageEmpty.hidden = true;
  for (let i = log.length - 1; i >= 0; i--) {
    const m = log[i];
    const li = document.createElement('li');
    if (m.level) li.classList.add(`level-${m.level}`);
    const time = document.createElement('span');
    time.className = 'msg-time';
    time.textContent = formatLogTime(m.t);
    const text = document.createElement('span');
    text.className = 'msg-text';
    text.textContent = m.text;
    li.appendChild(time);
    li.appendChild(text);
    el.messageList.appendChild(li);
  }
}

export function clearMessageLog() {
  if (!confirm('メッセージ履歴を全て削除します。よろしいですか?')) return;
  try { localStorage.removeItem(MESSAGE_LOG_KEY); } catch { /* noop */ }
  renderMessageList();
}

function formatLogTime(ts) {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}`;
}
