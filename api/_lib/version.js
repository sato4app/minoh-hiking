// version の採番(公開API 仕様書 docs/publish-api-202608.md §4)
//
// mapdata は `yyyy.n`、closures は `yyyy-mm.n`。n は1桁を前提としゼロ埋めしない。
// ゼロ埋めしないため文字列の大小比較は `2026.10 < 2026.9` と逆転する。
// 更新判定は等値比較のみで行い、大小比較はどこにも実装しない(§4.3)。

// Vercel Functions は UTC で動作する。UTC のまま期間を判定すると
// 「9月1日 08:00 JST の公開が 8月扱い」になるため、必ず JST に変換する(§4.2-2)。
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 現在の期間文字列。period='year' なら `yyyy`、'month' なら `yyyy-mm`
export function currentPeriod(period, now = new Date()) {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const year = String(jst.getUTCFullYear());
  if (period === 'year') return year;
  return `${year}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}`;
}

// version を期間と連番に分解する。形式が違えば null(契約1.0 時代の手入力形式など)
export function parseVersion(version, period) {
  if (typeof version !== 'string') return null;
  const re = period === 'year' ? /^(\d{4})\.(\d+)$/ : /^(\d{4}-\d{2})\.(\d+)$/;
  const m = re.exec(version.trim());
  if (!m) return null;
  return { period: m[1], n: Number(m[2]) };
}

// 次に採番する version を返す(§4.2)。
// - 期間が変わっていれば n=1、同じなら n+1
// - 現在の version の期間がサーバー時刻より未来(時計ずれ)なら、期間を戻さず n だけ加算する
// - パースできない version は、現在の期間の n=1 から始める
export function nextVersion(currentVersion, period, now = new Date()) {
  const nowPeriod = currentPeriod(period, now);
  const parsed = parseVersion(currentVersion, period);
  if (!parsed) return `${nowPeriod}.1`;
  // 期間の比較は固定長の文字列同士(yyyy / yyyy-mm)なので大小比較で判定できる。
  // ゼロ埋めしない連番 n には使わないこと。
  if (parsed.period >= nowPeriod) return `${parsed.period}.${parsed.n + 1}`;
  return `${nowPeriod}.1`;
}
