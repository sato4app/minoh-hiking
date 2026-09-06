// 「ご利用の注意とよくある質問」の描画
// 設定/Settings のトグルを ON にしたとき、faq-text.js の内容を組み立てて表示する。
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

// 「ご利用の注意」(9項目)。各項目に、詳しい説明のある質問への参照を添える
function buildNotices() {
  const list = document.createElement('ul');
  list.className = 'faq-notice-list';
  for (const notice of FAQ_NOTICES) {
    const li = document.createElement('li');
    li.textContent = pick(notice.text);
    const ref = document.createElement('span');
    ref.className = 'faq-ref';
    // 番号が複数のときの区切りは言語で変える(日本語は中黒、英語はカンマ)
    const separator = getLang() === 'en' ? ', ' : '・';
    ref.textContent = `→${notice.refs.join(separator)}`;
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
    ja: '各項目の詳しい説明は、下の「よくある質問」の該当する番号にあります。',
    en: 'Details for each item are in the numbered questions below.'
  });
  container.append(lead);

  container.append(buildQuestions());
}
