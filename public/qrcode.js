// QRコード生成モジュール
// 起動時画面の「QRコード」ボタンから、いま開いている URL を QRコードにして表示する。
//
// オフライン起動でも動くよう外部ライブラリ(CDN)には依存せず、JIS X 0510 / ISO 18004 の
// 手順をそのまま実装している(バイトモード固定・誤り訂正レベルは呼び出し側で指定)。
// 生成物は SVG 文字列。ラスタ画像と違って拡大しても崩れず、印刷にも耐える。
//
// 処理の流れ:
//   文字列 → UTF-8 バイト列 → ビット列(モード/文字数/データ/埋め草)
//   → ブロック分割 + Reed-Solomon 誤り訂正符号の付加 → インターリーブ
//   → 機能パターン(位置検出・タイミング・位置合わせ)の配置 → データ配置
//   → 8種のマスクを試して減点法で最良を選択 → 形式情報・型番情報の書き込み

// 誤り訂正レベル。数字は形式情報に書き込むビット値(JIS の規定値で、レベルの序列とは異なる)
export const ECC_LEVELS = {
  L: { name: 'L', formatBits: 1, index: 0 },
  M: { name: 'M', formatBits: 0, index: 1 },
  Q: { name: 'Q', formatBits: 3, index: 2 },
  H: { name: 'H', formatBits: 2, index: 3 }
};

// 型番(1〜40)ごとの、1ブロックあたりの誤り訂正コードワード数。行は L/M/Q/H、添字は型番
// (添字 0 は型番 0 が無いための番人)
const ECC_CODEWORDS_PER_BLOCK = [
  // 0   1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16  17  18  19  20  21  22  23  24  25  26  27  28  29  30  31  32  33  34  35  36  37  38  39  40
  [-1,  7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // L
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28], // M
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // Q
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]  // H
];

// 型番ごとの誤り訂正ブロック数。行と添字の意味は上と同じ
const ECC_BLOCKS = [
  // 0   1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16  17  18  19  20  21  22  23  24  25  26  27  28  29  30  31  32  33  34  35  36  37  38  39  40
  [-1,  1,  1,  1,  1,  1,  2,  2,  2,  2,  4,  4,  4,  4,  4,  6,  6,  6,  6,  7,  8,  8,  9,  9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25], // L
  [-1,  1,  1,  1,  2,  2,  4,  4,  4,  5,  5,  5,  8,  9,  9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49], // M
  [-1,  1,  1,  2,  2,  4,  4,  6,  6,  8,  8,  8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68], // Q
  [-1,  1,  1,  2,  4,  4,  4,  5,  6,  8,  8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]  // H
];

// マスクパターン(0〜7)。座標ごとに反転するかどうかを返す
const MASK_FUNCS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
  (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0,
  (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0
];

// マスク選択の減点法の重み(規格が定める固定値)
const PENALTY_N1 = 3;   // 同色が5個以上連続
const PENALTY_N2 = 3;   // 同色の2×2ブロック
const PENALTY_N3 = 40;  // 位置検出パターンに似た並び
const PENALTY_N4 = 10;  // 明暗の割合の偏り

// ===== 公開API =====

// 文字列から QRコードのモジュール行列を作る。
// 戻り値は { size, modules }(modules[y][x] が true なら黒)
export function buildQrMatrix(text, { ecc = 'M' } = {}) {
  const level = ECC_LEVELS[ecc] || ECC_LEVELS.M;
  const data = new TextEncoder().encode(String(text));
  const version = selectVersion(data.length, level);
  const codewords = buildCodewords(data, version, level);
  return buildMatrix(codewords, version, level);
}

// 文字列から QRコードの SVG 文字列を作る。
// margin は周囲に空ける明色の余白(モジュール数)。規格上 4 以上が必要で、
// これを削ると読み取り機がコードの外周を認識できなくなる
export function renderQrSvg(text, { ecc = 'M', margin = 4 } = {}) {
  const { size, modules } = buildQrMatrix(text, { ecc });
  const total = size + margin * 2;

  // 黒モジュールを1本の path にまとめる(要素数を抑えて描画を軽くする)
  let path = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y][x]) path += `M${x + margin},${y + margin}h1v1h-1z`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" ` +
    `shape-rendering="crispEdges" aria-hidden="true">` +
    `<rect width="${total}" height="${total}" fill="#fff"/>` +
    `<path d="${path}" fill="#000"/></svg>`;
}

// ===== 符号化(データ → コードワード列) =====

// 収まる最小の型番を選ぶ。40型でも入らない場合は例外を投げる
function selectVersion(byteLength, level) {
  for (let version = 1; version <= 40; version++) {
    const capacityBits = getNumDataCodewords(version, level) * 8;
    // モード指示子(4bit) + 文字数指示子 + データ本体
    const usedBits = 4 + getCharCountBits(version) + byteLength * 8;
    if (usedBits <= capacityBits) return version;
  }
  throw new Error('QRコードに収まらない長さです');
}

// バイトモードの文字数指示子のビット数(型番で変わる)
function getCharCountBits(version) {
  return version <= 9 ? 8 : 16;
}

// 機能パターン等を除いた、データ+誤り訂正に使えるモジュール数
function getNumRawDataModules(version) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;  // 位置合わせパターン
    if (version >= 7) result -= 36;                  // 型番情報(2箇所×18bit)
  }
  return result;
}

// データコードワード数(全コードワード数 − 誤り訂正コードワード数)
function getNumDataCodewords(version, level) {
  return Math.floor(getNumRawDataModules(version) / 8)
    - ECC_CODEWORDS_PER_BLOCK[level.index][version] * ECC_BLOCKS[level.index][version];
}

// ビット列 → データコードワード → 誤り訂正付きのコードワード列
function buildCodewords(data, version, level) {
  const bits = [];
  const appendBits = (value, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };

  appendBits(0b0100, 4);                       // バイトモード
  appendBits(data.length, getCharCountBits(version));
  for (const b of data) appendBits(b, 8);

  const capacityBits = getNumDataCodewords(version, level) * 8;
  appendBits(0, Math.min(4, capacityBits - bits.length));  // 終端パターン
  appendBits(0, (8 - bits.length % 8) % 8);                // バイト境界まで詰める

  // 残りは 0xEC / 0x11 を交互に入れる(規格で定められた埋め草)
  for (let pad = 0xEC; bits.length < capacityBits; pad ^= 0xEC ^ 0x11) appendBits(pad, 8);

  const dataCodewords = new Uint8Array(bits.length / 8);
  bits.forEach((bit, i) => { dataCodewords[i >>> 3] |= bit << (7 - (i & 7)); });

  return addEccAndInterleave(dataCodewords, version, level);
}

// ブロックごとに Reed-Solomon 符号を付け、規格の順序でインターリーブする
function addEccAndInterleave(data, version, level) {
  const numBlocks = ECC_BLOCKS[level.index][version];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[level.index][version];
  const rawCodewords = Math.floor(getNumRawDataModules(version) / 8);
  // ブロックの長さは1コードワードだけ違う2種類になる(短い方が numShortBlocks 個)
  const numShortBlocks = numBlocks - rawCodewords % numBlocks;
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const divisor = reedSolomonComputeDivisor(blockEccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const len = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
    const dat = Array.from(data.slice(k, k + len));
    k += len;
    const ecc = reedSolomonComputeRemainder(dat, divisor);
    // 短いブロックは末尾に番人を置き、長いブロックと桁を揃えてから取り出す
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }

  const result = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      // 短いブロックに足した番人は書き出さない
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
    });
  }
  return result;
}

// ===== Reed-Solomon(GF(256)、原始多項式 0x11D) =====

// 次数 degree の生成多項式の係数(最高次を除く)
function reedSolomonComputeDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

// data を生成多項式で割った剰余(= 誤り訂正コードワード)
function reedSolomonComputeRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= gfMultiply(coef, factor); });
  }
  return result;
}

// GF(256) の乗算
function gfMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11D);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xFF;
}

// ===== 描画(コードワード列 → モジュール行列) =====

function buildMatrix(codewords, version, level) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  // 機能パターン(データを置けない領域)の印。マスクの適用対象からも外す
  const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));

  const setFunction = (x, y, dark) => {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    modules[y][x] = dark;
    isFunction[y][x] = true;
  };

  // タイミングパターン(6行目・6列目の明暗の繰り返し)
  for (let i = 0; i < size; i++) {
    setFunction(6, i, i % 2 === 0);
    setFunction(i, 6, i % 2 === 0);
  }

  // 位置検出パターン(左上・右上・左下)。分離パターンごと 9×9 で塗る
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFunction(cx + dx, cy + dy, dist !== 2 && dist !== 4);
      }
    }
  }

  // 位置合わせパターン(位置検出パターンと重なる3隅は除く)
  const alignPos = getAlignmentPatternPositions(version);
  for (let i = 0; i < alignPos.length; i++) {
    for (let j = 0; j < alignPos.length; j++) {
      const isCorner = (i === 0 && j === 0)
        || (i === 0 && j === alignPos.length - 1)
        || (i === alignPos.length - 1 && j === 0);
      if (isCorner) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFunction(alignPos[i] + dx, alignPos[j] + dy,
            Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  // 形式情報の領域を仮の値で予約しておく(マスク決定後に本来の値で書き直す)
  drawFormatBits(modules, isFunction, size, level, 0, setFunction);
  drawVersionBits(version, size, setFunction);

  drawCodewords(codewords, modules, isFunction, size);

  // 8種類のマスクを試し、減点が最も少ないものを採用する
  let bestMask = 0;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(modules, isFunction, size, mask);
    drawFormatBits(modules, isFunction, size, level, mask, setFunction);
    const penalty = getPenaltyScore(modules, size);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
    }
    applyMask(modules, isFunction, size, mask);  // 同じマスクをもう一度当てて元に戻す
  }
  applyMask(modules, isFunction, size, bestMask);
  drawFormatBits(modules, isFunction, size, level, bestMask, setFunction);

  return { size, modules, version, mask: bestMask };
}

// 位置合わせパターンの中心座標(型番から算出する)
function getAlignmentPatternPositions(version) {
  if (version === 1) return [];
  const num = Math.floor(version / 7) + 2;
  // 型番32だけは計算式の結果と規格の値が食い違うため、規格側の 26 を使う
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (num * 2 - 2)) * 2;
  const result = [6];
  for (let pos = version * 4 + 10; result.length < num; pos -= step) result.splice(1, 0, pos);
  return result;
}

// 形式情報(誤り訂正レベル + マスク番号)を BCH 符号にして2箇所へ書き込む
function drawFormatBits(modules, isFunction, size, level, mask, setFunction) {
  const data = (level.formatBits << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i) => ((bits >>> i) & 1) !== 0;

  // 左上(位置検出パターンの内側を回り込む形)
  for (let i = 0; i <= 5; i++) setFunction(8, i, bit(i));
  setFunction(8, 7, bit(6));
  setFunction(8, 8, bit(7));
  setFunction(7, 8, bit(8));
  for (let i = 9; i < 15; i++) setFunction(14 - i, 8, bit(i));

  // 右上・左下(同じ内容の複製)
  for (let i = 0; i < 8; i++) setFunction(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) setFunction(8, size - 15 + i, bit(i));
  setFunction(8, size - 8, true);  // 常に黒のモジュール
}

// 型番情報(7型以上のみ)を BCH 符号にして2箇所へ書き込む
function drawVersionBits(version, size, setFunction) {
  if (version < 7) return;
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
  const bits = (version << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) !== 0;
    const a = size - 11 + i % 3;
    const b = Math.floor(i / 3);
    setFunction(a, b, dark);
    setFunction(b, a, dark);
  }
}

// コードワードを右下から2列ずつ、上下に折り返しながら配置する
function drawCodewords(codewords, modules, isFunction, size) {
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;  // 6列目はタイミングパターンなので飛ばす
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && i < codewords.length * 8) {
          modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
    }
  }
}

// マスクを適用する(XOR なので、同じマスクをもう一度当てれば元に戻る)
function applyMask(modules, isFunction, size, mask) {
  const fn = MASK_FUNCS[mask];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isFunction[y][x] && fn(x, y)) modules[y][x] = !modules[y][x];
    }
  }
}

// ===== マスク選択の減点法 =====

function getPenaltyScore(modules, size) {
  let result = 0;

  // 行・列ごとに「同色の連続」と「位置検出パターンに似た並び」を数える
  for (const isRow of [true, false]) {
    for (let i = 0; i < size; i++) {
      let runColor = false;
      let runLen = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let j = 0; j < size; j++) {
        const dark = isRow ? modules[i][j] : modules[j][i];
        if (dark === runColor) {
          runLen++;
          if (runLen === 5) result += PENALTY_N1;
          else if (runLen > 5) result++;
        } else {
          addRunHistory(history, runLen, size);
          if (!runColor) result += countFinderLikePatterns(history) * PENALTY_N3;
          runColor = dark;
          runLen = 1;
        }
      }
      result += terminateRunHistory(history, runColor, runLen, size) * PENALTY_N3;
    }
  }

  // 同色の 2×2 ブロック
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) {
        result += PENALTY_N2;
      }
    }
  }

  // 明暗の割合が 50% からどれだけ離れているか(5%ごとに減点)
  let dark = 0;
  for (const row of modules) for (const c of row) if (c) dark++;
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  return result + k * PENALTY_N4;
}

// 直近7本の連続長を記録する(先頭は明色の余白を足して数える)
function addRunHistory(history, runLen, size) {
  if (history[0] === 0) runLen += size;  // 行頭の外側は明色の余白とみなす
  history.pop();
  history.unshift(runLen);
}

// 行末まで来たときの締め(外側の明色の余白を足してから数える)
function terminateRunHistory(history, runColor, runLen, size) {
  if (runColor) {
    addRunHistory(history, runLen, size);
    runLen = 0;
  }
  addRunHistory(history, runLen + size, size);
  return countFinderLikePatterns(history);
}

// 1:1:3:1:1 の並び(位置検出パターンと紛らわしい)の数を数える
function countFinderLikePatterns(history) {
  const n = history[1];
  const core = n > 0 && history[2] === n && history[3] === n * 3
    && history[4] === n && history[5] === n;
  return (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0)
    + (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0);
}
