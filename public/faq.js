// 「ご利用の注意とよくある質問」の描画
// 設定・情報/Settings & Info のトグルを ON にしたとき、faq-text.js の内容を組み立てて表示する。
//
// 中身は変わらないので、組み立ては最初の1回だけ行う(2回目以降は表示を戻すだけ)。
// 文言は日英の両方を持てる形にしてあるが、英語は未作成のため、無ければ日本語を出す。

import { getLang } from './i18n.js';
import { FAQ_NOTICES, FAQ_SECTIONS } from './faq-text.js';

// 表示言語の文言を取り出す。未訳のときは日本語で出す(空欄にはしない)
function pick(entry) {
  const lang = getLang();
  return entry[lang] ?? entry.ja;
}

let built = false;

// 質問の要素の id(参照リンク「→Q5」の飛び先)。画面内の他の id と重ならないよう接頭辞を付ける
const questionDomId = (id) => `faq-${id}`;

// よくある質問に実在する番号(参照先が無い番号はリンクにしない)
const questionIds = new Set(FAQ_SECTIONS.flatMap((section) => section.items.map((item) => item.id)));

// 参照リンクから該当する質問へ移る。
// location.hash は変えない(URL に #faq-Q5 が付くと、「QR」で出すQRコードにも入ってしまうため)。
// 動かすのはモーダルの本文(スクロールする枠)だけにし、画面全体はスクロールさせない。
function jumpToQuestion(id) {
  const target = document.getElementById(questionDomId(id));
  if (!target) return;
  const scroller = target.closest('.modal-body');
  if (scroller) {
    const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    // 質問の上に少し余白を残す(枠の上端に貼り付くと見出しと区別しにくい)。
    // なめらかにスクロールさせると、後ろの方の質問(本文で 4,500px ほど先)では着くまでに
    // 1秒以上かかり、下の色付けが着く前に消えてしまうため、一度で移す
    scroller.scrollTop = Math.max(0, top - 8);
  }
  // どの質問に移ったか分かるよう、少しの間だけ色を付ける(続けて押しても毎回光らせる)
  target.classList.remove('faq-q-target');
  void target.offsetWidth;
  target.classList.add('faq-q-target');
  // 読み上げを移った先から続けられるようにする。スクロールは上で済ませているので動かさない
  target.focus({ preventScroll: true });
}

// 「ご利用の注意」(9項目)。各項目に、詳しい説明のある質問への参照を添える。
// 参照の番号(Q5 など)は、押すとその質問へ移るリンクにする
function buildNotices() {
  const list = document.createElement('ul');
  list.className = 'faq-notice-list';
  // 番号が複数のときの区切りは言語で変える(日本語は中黒、英語はカンマ)
  const separator = getLang() === 'en' ? ', ' : '・';
  for (const notice of FAQ_NOTICES) {
    const li = document.createElement('li');
    li.textContent = pick(notice.text);
    const ref = document.createElement('span');
    ref.className = 'faq-ref';
    ref.append('→');
    notice.refs.forEach((id, i) => {
      if (i > 0) ref.append(separator);
      if (!questionIds.has(id)) {
        ref.append(id);
        return;
      }
      const link = document.createElement('a');
      link.className = 'faq-ref-link';
      link.href = `#${questionDomId(id)}`;
      link.textContent = id;
      link.addEventListener('click', (e) => {
        e.preventDefault();
        jumpToQuestion(id);
      });
      ref.append(link);
    });
    li.append(' ', ref);
    list.append(li);
  }
  return list;
}

// 「よくある質問」。まとまりごとに見出しを出し、質問と答えを並べる
function buildQuestions() {
  const fragment = document.createDocumentFragment();
  for (const section of FAQ_SECTIONS) {
    const heading = document.createElement('h4');
    heading.className = 'faq-section-title';
    heading.textContent = pick(section.title);
    fragment.append(heading);

    for (const item of section.items) {
      const q = document.createElement('p');
      q.className = 'faq-q';
      q.id = questionDomId(item.id);
      // 参照リンクから移ったときにフォーカスを受け取れるようにする(Tab 移動の対象にはしない)
      q.tabIndex = -1;
      q.textContent = `${item.id}. ${pick(item.q)}`;
      fragment.append(q);
      for (const paragraph of item.a) {
        const a = document.createElement('p');
        a.className = 'faq-a';
        a.textContent = pick(paragraph);
        fragment.append(a);
      }
    }
  }
  return fragment;
}

// 内容を container に組み立てる。すでに組み立て済みなら何もしない
export function buildFaq(container) {
  if (built || !container) return;
  built = true;

  const noticeTitle = document.createElement('h4');
  noticeTitle.className = 'faq-section-title faq-notice-title';
  noticeTitle.textContent = pick({ ja: 'ご利用の注意', en: 'Before You Go' });
  container.append(noticeTitle, buildNotices());

  const lead = document.createElement('p');
  lead.className = 'faq-lead';
  lead.textContent = pick({
    ja: '各項目の詳しい説明は、下の「よくある質問」にあります。番号を押すと、その質問へ移ります。',
    en: 'Details for each item are in the questions below. Tap a number to jump to it.'
  });
  container.append(lead);

  container.append(buildQuestions());
}
