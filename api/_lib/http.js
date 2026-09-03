// HTTP まわりの共通処理: CORS と公開トークンの検証
// 仕様: docs/publish-api-202609.md §8(認証)・§9(CORS)

import { createHash, timingSafeEqual } from 'node:crypto';

// CORS: GET は公開データ、POST はトークンで保護されるため Origin は限定しない。
// GitHub Pages 版アプリ・MapPublisher からもクロスオリジンで参照する。
export function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-publish-token');
}

// 公開トークンの検証。問題があればこの中で応答を返し false を返す。
// 環境変数は2つのデータセットで共通(MAP_PUBLISH_TOKEN)。
export function requirePublishToken(req, res) {
  const expected = process.env.MAP_PUBLISH_TOKEN;
  if (!expected) {
    // fail-closed。環境変数は追加・変更後の再デプロイで初めて有効になる
    res.status(503).json({ error: '公開トークンが未設定です(Vercel の環境変数 MAP_PUBLISH_TOKEN を設定してください)' });
    return false;
  }
  const given = req.headers['x-publish-token'];
  if (typeof given !== 'string' || !tokenEquals(given, expected)) {
    res.status(401).json({ error: '公開トークンが正しくありません' });
    return false;
  }
  return true;
}

// トークン比較(タイミング攻撃対策に固定長ハッシュ同士で比較する)
function tokenEquals(a, b) {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}
