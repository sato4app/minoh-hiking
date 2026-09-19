// 「ご利用の注意とよくある質問」の描画
// 設定・情報/Settings & Info のトグルを ON にしたとき、faq-text.js の内容を組み立てて表示する。
//
// 中身は変わらないので、組み立ては最初の1回だけ行う。
// よくある質問は、見出しと質問だけを表示し、答えは質問を押したときに開く。
// トグルを ON にするたびに、開いていた答えを閉じて最初の表示に戻す。
// 文言は日英の両方を持つ。英語が無い項目は日本語を出す。

import { getLang } from './i18n.js';
import { FAQ_NOTICES, FAQ_SECTIONS } from './faq-text.js';

// 表示言語の文言を取り出す。未訳のときは日本語で出す(空欄にはしない)
function pick(entry) {
  const lang = getLang();
  return entry[lang] ?? entry.ja;
}

let built = false;

// 1問(質問と答え)のまとまりの id(参照リンク「→Q5」の飛び先)。
// 画面内の他の id と重ならないよう接頭辞を付ける
const questionDomId = (id) => `faq-${id}`;

// よくある質問に実在する番号(参照先が無い番号はリンクにしない)
const questionIds = new Set(FAQ_SECTIONS.flatMap((section) => section.items.map((item) => item.id)));

// 参照リンクから該当する質問へ移る。質問と答えの両方を見せるため、答えが閉じていれば開く。
// location.hash は変えない(URL に #faq-Q5 が付くと、「QR」で出すQRコードにも入ってしまうため)。
// 動かすのはモーダルの本文(スクロールする枠)だけにし、画面全体はスクロールさせない。
function jumpToQuestion(id) {
  const item = document.getElementById(questionDomId(id));
  if (!item) return;
  // 先に開いてからスクロールする(末尾近くの質問は、答えを開いた分だけ下に余裕ができ、
  // 質問を枠の上端まで送れるようになるため)
  item.open = true;
  const question = item.querySelector('.faq-q');
  const scroller = item.closest('.modal-body');
  if (scroller) {
    const top = item.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    // 質問の上に少し余白を残す(枠の上端に貼り付くと見出しと区別しにくい)。
    // なめらかにスクロールさせると、後ろの方の質問では着くまでに1秒以上かかり、
    // 下の色付けが着く前に消えてしまうため、一度で移す
    scroller.scrollTop = Math.max(0, top - 8);
  }
  // どの質問に移ったか分かるよう、少しの間だけ色を付ける(続けて押しても毎回光らせる)
  question.classList.remove('faq-q-target');
  void question.offsetWidth;
  question.classList.add('faq-q-target');
  // 読み上げを移った先から続けられるようにする。スクロールは上で済ませているので動かさない
  question.focus({ preventScroll: true });
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

// 「よくある質問」。まとまりごとに見出しを出し、質問を並べる。
// 1問ずつ details / summary で組み、質問(summary)を押すと答えを開閉する
// (開閉の状態は読み上げにも伝わり、キーボードでも Enter / Space で開閉できる)
function buildQuestions() {
  const fragment = document.createDocumentFragment();
  for (const section of FAQ_SECTIONS) {
    const heading = document.createElement('h4');
    heading.className = 'faq-section-title';
    heading.textContent = pick(section.title);
    fragment.append(heading);

    for (const item of section.items) {
      const details = document.createElement('details');
      details.className = 'faq-item';
      details.id = questionDomId(item.id);
      const q = document.createElement('summary');
      q.className = 'faq-q';
      const text = document.createElement('span');
      text.className = 'faq-q-text';
      text.textContent = `${item.id}. ${pick(item.q)}`;
      q.append(text);
      details.append(q);
      for (const paragraph of item.a) {
        const a = document.createElement('p');
        a.className = 'faq-a';
        a.textContent = pick(paragraph);
        details.append(a);
      }
      fragment.append(details);
    }
  }
  return fragment;
}

// 内容を container に組み立てる(最初の1回だけ)
function buildFaq(container) {
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
  // よくある質問は答えを閉じて並べるため、開き方を添える
  const leadQuestions = document.createElement('p');
  leadQuestions.className = 'faq-lead';
  leadQuestions.textContent = pick({
    ja: 'よくある質問は、質問を押すと答えを表示します。',
    en: 'Tap a question below to show its answer.'
  });
  container.append(lead, leadQuestions);

  container.append(buildQuestions());
}

// 「ご利用の注意とよくある質問」のトグルを ON にしたときに呼ぶ。
// 初回は中身を組み立てる。2回目以降は、開いていた答えを閉じて最初の表示
// (見出しと質問だけ)に戻す
export function showFaq(container) {
  if (!container) return;
  if (!built) {
    built = true;
    buildFaq(container);
    return;
  }
  for (const item of container.querySelectorAll('details.faq-item')) item.open = false;
}
