// アプリシェル各ファイルの内容ハッシュ(revision)一覧を生成する。
//
// Service Worker の install は、この一覧と「前回インストール時の一覧」を突き合わせ、
// 内容が変わっていないファイルを旧キャッシュから複製する(ネットワークに出ない)。
// これが無いと、SHELL_CACHE を上げるたびにシェル全 25 件を取り直すことになり、
// 弱電波では更新直後の起動がそのぶん待たされる。
//
// 実行タイミング: デプロイ時に自動実行する(手で書き換える一覧ではない)。
//   - Vercel        : vercel.json の buildCommand
//   - GitHub Pages  : .github/workflows/pages.yml のステップ
// ローカル配信(python -m http.server 等)では未生成のことがあるが、その場合
// Service Worker は従来どおり全件をネットワークから取り直すだけで、動作は壊れない。
//
// 対象は service-worker.js の SHELL_LOCAL_PATHS から読み取るため、
// シェルにファイルを足したときにこのスクリプトを直す必要はない。
// (CDN 資産は URL にバージョンが入っており内容が変わらないため対象外)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const publicDir = path.join(import.meta.dirname, '..', 'public');
const swFile = path.join(publicDir, 'service-worker.js');
const outFile = path.join(publicDir, 'shell-revisions.json');

const source = fs.readFileSync(swFile, 'utf8');
const block = source.match(/const SHELL_LOCAL_PATHS = \[([\s\S]*?)\n\];/);
if (!block) {
  console.error('[shell-revisions] service-worker.js から SHELL_LOCAL_PATHS を読み取れませんでした');
  process.exit(1);
}

// 行コメントを除いてから文字列リテラルを拾う(コメント中の './...' を拾わないため)
const entries = block[1]
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, ''))
  .join('\n');
const paths = [...entries.matchAll(/'([^']+)'/g)].map((m) => m[1]);

const revisions = {};
const missing = [];
for (const p of paths) {
  // './' は SW スコープ直下 = index.html を指す
  const rel = p.replace(/^\.\//, '') || 'index.html';
  const file = path.join(publicDir, rel);
  if (!fs.existsSync(file)) { missing.push(p); continue; }
  revisions[p] = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 12);
}

fs.writeFileSync(outFile, JSON.stringify(revisions, null, 2) + '\n');
console.log(`[shell-revisions] ${Object.keys(revisions).length} 件を public/shell-revisions.json に出力しました`);
if (missing.length) {
  // 一覧に載っているのに public/ に無いファイル。offline 起動が壊れる兆候なので目立たせる。
  // (一覧から除くだけなので、該当ファイルは毎回ネットワークから取り直される)
  console.warn(`[shell-revisions] ⚠ public/ に見つからないパス: ${missing.join(', ')}`);
}
