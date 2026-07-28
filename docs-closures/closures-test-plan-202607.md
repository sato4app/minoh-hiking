# 通行止め・通行困難地点 表示機能・公開API テスト計画書

**バージョン:** 2.0
**最終更新日:** 2026年7月28日
**対象:** 開発担当者(minoh-hiking の表示機能と公開APIの動作確認を行う人)
**関連:** [設計書 `closures-design-202607.md`](closures-design-202607.md) / [セキュリティレビュー `closures-security-review-202607.md`](closures-security-review-202607.md)

---

## 1. このテスト計画書について

minoh-hiking 側の **通行止め・通行困難地点の表示機能** と、本リポジトリが提供する
**公開API(Vercel Function + Vercel Blob)** の動作確認手順をまとめたものです。

> **範囲:** 本アプリは表示専用のため、検証するのは **表示側(GET)** と
> **公開API 単体(curl)** です。公開UI(地点の編集・公開操作)の受け入れテストは
> 外部の運用アプリ側のテスト計画が担います。

**公開APIの実体が Vercel にしかない**ため、環境ごとにできること・できないことを
踏まえてテストします。

### 1.1 前提

- **アプリは一般公開前**のため、既存ユーザーへの影響は考慮不要。
  **本番の Vercel Blob を直接テストに使ってよい**(Preview 用の別ストア分離は不要)。
- 全テストは本番環境(`https://minoh-hiking.vercel.app`)を対象に実施できる。

### 1.2 環境ごとにできること・できないこと

| 環境 | 表示(GET) | 備考 |
|------|-----------|------|
| ローカル(python http.server) | ✗(404→表示なし) | 表示なしで他機能が壊れないことの確認に使う |
| GitHub Pages | ○(本番APIを参照) | github.io からは本番 Vercel API を直接叩く(CORS 経路の確認) |
| Vercel 本番 | ○ | テストの主戦場(一般公開前のため直接使用可) |

---

## 2. 事前準備: テストデータ

| ファイル | 内容 | 用途 |
|----------|------|------|
| test-normal.geojson | 通行止め(closed)1点 + 通行困難(difficult)1点、箕面エリア内 | 正常系 |
| test-updated.geojson | 上記から1点を削除したもの | 解除(一部削除)の確認 |
| test-empty.geojson | 0件の FeatureCollection | 全削除の確認 |
| test-bad-coords.geojson | 経度135.9など範囲外の点を含む | 400(範囲外)の確認 |
| test-dup-id.geojson | 同じ id が2点ある | 400(id重複)の確認 |

> 座標の妥当範囲は経度 135.2〜135.8/緯度 34.6〜35.1(API側で検証)。
> スキーマの詳細は[設計書 §4.2](closures-design-202607.md)を参照。

---

## 3. テスト項目

### D1. Vercel 設定の確認(最初に一度)

Vercel ダッシュボードで以下を確認する。

- [ ] Blob ストアがプロジェクトに Connect 済み
- [ ] 環境変数 `BLOB_READ_WRITE_TOKEN` が設定されている(Blob 接続で自動設定)
- [ ] 環境変数 `CLOSURES_PUBLISH_TOKEN` が Production に設定されている
- [ ] 最新デプロイが Ready(環境変数の追加・変更後は再デプロイ済みであること)

### D2. API 単体テスト(curl)

PowerShell では `curl.exe` を使う(`curl` は Invoke-WebRequest の別名のため)。

| # | 手順 | 期待結果 |
|---|------|----------|
| D2-1 | `curl.exe https://minoh-hiking.vercel.app/api/closures` | 200 + geojson(未公開なら空の FeatureCollection) |
| D2-2 | トークンなしで POST | 401(未設定なら 503 → D1へ戻る) |
| D2-3 | 誤トークン(`x-publish-token: wrong`)で POST | 401 |
| D2-4 | 正トークン + test-bad-coords | 400 + 理由「…範囲外です」 |
| D2-5 | 正トークン + test-dup-id | 400 + 理由「id が重複…」 |
| D2-6 | 正トークン + version なしデータ | 400 + 理由「version がありません」 |
| D2-7 | 正トークン + test-normal(version付き) | 200 → 直後の GET で同じ version が返る |

コマンド例:

```powershell
# D2-1: GET
curl.exe https://minoh-hiking.vercel.app/api/closures

# D2-2: トークンなし POST
curl.exe -X POST https://minoh-hiking.vercel.app/api/closures -H "Content-Type: application/json" -d "{}"

# D2-3: 誤トークン POST
curl.exe -X POST https://minoh-hiking.vercel.app/api/closures -H "Content-Type: application/json" -H "x-publish-token: wrong" -d "{}"

# D2-7: 正常データの公開(ファイル送信)
curl.exe -X POST https://minoh-hiking.vercel.app/api/closures -H "Content-Type: application/json" -H "x-publish-token: <トークン>" --data-binary "@test-normal.geojson"
```

### D3. 表示側UIの検証(minoh-hiking)

| # | 環境 | 手順 | 期待結果 |
|---|------|------|----------|
| D3-1 | ローカル | `python -m http.server` で起動しマップ表示 | 通行止めマーカーは**出ない**(API 404)。コンソール警告のみで他機能は正常。「バージョン情報」の通行止めは `-`/件数 `-` |
| D3-2 | 本番 | test-normal を公開済みの状態でマップ表示 | 赤✖(closed)・橙三角(difficult)が表示される |
| D3-3 | 本番 | マーカーをタップ | 名称・種別・理由・補足・更新日がポップアップ表示される |
| D3-4 | 本番 | 「バージョン情報」を開く | 公開中の version と件数が表示される |
| D3-5 | 本番 | ホーム/ナビ画面へ移動 | 通行止めマーカーが非表示になる(マップ画面のみ常時表示) |
| D3-6 | 本番 | 「マーカーの設定」で通行止め地点の色・形・サイズを変更 | 変更が即座にマーカーへ反映される |
| D3-7 | 本番 | 言語を English に切替 | ポップアップの種別が `Closed`/`Difficult to pass`、`Reason:`/`Updated:` になる |
| D3-8 | 本番 | URL に `?closure=true` を付けて起動 | **何も起きない**(編集パネル・専用ボタンは削除済み。通常表示のみ) |

### D4. キャッシュ・オフライン動作(本番URLで)

| # | 手順 | 期待結果 |
|---|------|----------|
| D4-1 | 公開した直後にアプリを開き直す | リロード待ちなしで新 version が表示(no-cache 動作) |
| D4-2 | 一度表示後、DevTools でオフラインにして開き直す | SW の closures-cache から最終取得分が表示される |
| D4-3 | 旧バージョンからの更新後、localStorage を確認 | `minoh-hiking.closure-data`/`minoh-hiking.closure-publish-token` が**消えている**(後始末処理の確認) |

### D5. GitHub Pages 版の確認(GETのみ)

- [ ] GitHub Pages 版アプリを開き、通行止めマーカーが表示されること
  (= 本番APIへのクロスオリジン GET + CORS が機能)

---

## 4. 連携テスト(公開 → 受信)

1. 運用アプリから新しい version で公開する
2. **minoh-hiking**: ユーザー役としてアプリを開き直す → 新しい内容・件数が表示される
3. minoh-hiking 側では何も操作していないこと(受信は開き直しだけで完了)を確認する

> 公開UI そのものの受け入れテスト(誤トークン時の E01 表示、0件公開の警告など)は
> 運用アプリ側の担当。

---

## 5. 実施順序の推奨

```
D1(Vercel設定) → D2(APIが正しい) → D3(表示が正しい)
     │
     ▼
連携テスト(公開 → 受信)
     │
     ▼
D4(キャッシュ) → D5(GitHub Pages)
```

先に API を curl で固めてから表示・連携に進むと、問題が出たときに
「API の問題」か「表示側の問題」かを切り分けやすい。

---

## 6. 変更履歴

| 日付 | バージョン | 内容 |
|------|-----------|------|
| 2026-07-19 | 1.0 | 初版(開発用PC/運用用PCの2台構成によるテスト計画) |
| 2026-07-28 | 2.0 | 表示専用化に伴い**表示側と公開API単体に範囲を限定**。編集・公開UIのテスト(旧 D3 のローカルUI検証・旧 §4 の受け入れテスト O1〜O9)を削除。表示側の検証項目(D3-1〜D3-8)を新設し、`?closure=true` が無効であることの確認と旧 localStorage キー削除の確認を追加 |
