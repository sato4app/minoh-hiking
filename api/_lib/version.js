// version の検証(公開API 仕様書 docs/publish-api-202609.md §4)
//
// 採番は送信側(MapPublisher)が行う。サーバーは送られてきた version を検証して採用するだけで、
// 値を作らない。
//
// 形式は `yyyy.nn`。nn は2桁ゼロ埋めの連番で、3桁以上は受け付けない
// (年に100回の公開は想定しない)。ゼロ埋めするため文字列の大小比較が
// そのまま版の順序になる(`2026.10 < 2026.9` のような逆転は起きない。§4.3)。
const VERSION_RE = /^\d{4}\.\d{2}$/;

// 送られてきた version が公開できる形式かどうか
export function isValidVersion(version) {
  return typeof version === 'string' && VERSION_RE.test(version);
}
