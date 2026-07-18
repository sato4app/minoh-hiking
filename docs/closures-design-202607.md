# 通行止め・通行困難地点 表示・公開機能 設計書（実装済み版）

**バージョン:** 0.3
**最終更新日:** 2026年7月18日
**ステータス:** 実装済み（**P2: Vercel Function + Vercel Blob**）
**関連:** [運用手順 `closures-operations-202607.md`](closures-operations-202607.md) / [セキュリティレビュー `closures-security-review-202607.md`](closures-security-review-202607.md) / [機能仕様書 `funcspec-202607.md`](funcspec-202607.md)

---

## 0. 本書について（202606 からの主な変更）

本書は、検討ドラフト（202606）を**実装済みの内容（as-built）に更新**したものである。
ドラフトからの主な確定・変更点は次のとおり。

| 項目 | ドラフト（202606） | 実装（本書 202607） |
|------|--------------------|---------------------|
| 公開方式 | P2（API+Blob）を提案 | **P2 を採用・実装**（P1 の git 公開スクリプトは安全性の観点から**廃止・削除**） |
| 運用者UI | `?preview=closures` の preview モード | **`?closure=true` の編集パネル**（preview モードは未実装・不採用） |
| 公開/非公開の区別 | 各地点の `status`（draft/published） | **`status` は廃止。** トップレベル `version` によるファイル**全置換**で公開 |
| 端末反映と公開 | 取り込み→検証→公開 | **「マップに反映」（端末のみ）** と **「公開」（ユーザー）** の2段構え |
| マーカー | `MARKER_TYPES` に追加（色変更可） | **`MARKER_TYPES` に追加**（既定: closed=赤✖ 16px / difficult=橙三角 12px。マーカー設定で変更可。当初は固定スタイルだったが 2026-07-18 に設定対象化） |
| 表示トグル | 「通行止めを表示」トグル（既定ON） | 専用トグルは設けず、**マップ表示時は常時表示** |
| 履歴 | 対象外 | **公開時に Blob へ履歴スナップショットを保存** |

---

## 1. 概要

### 1.1 目的
ハイキングマップ上に、工事による通行止めや、倒木・落石等による通行困難箇所を
地点（Point）として重ね合わせ表示する。対象地点は運用担当者が登録・判断し、
一般ユーザーへ即時公開・即時解除できる運用を可能にする。

### 1.2 背景・前提
- 通行止め／通行困難は**一時的・頻繁に変化し、解除（削除）も必要**な情報である。
  既存の geojson（緊急ポイント・ルート/スポット）と異なり、即時の反映・解除が求められる。
- 地点データの**作成は別アプリ（MapGPS → MapEditor）**で行う。本アプリでは作成せず、
  読み込み・確認・公開のみ行う。Firebase は使用しない。
- 登録・公開は**運用担当者**が行い、開発担当の作業（git commit / deploy 等）を介在させない。
  **git・PC を不要にし、スマートフォン／タブレットのブラウザだけで公開を完結**させる（本要件が P2 採用の決め手）。

### 1.3 スコープ
- 本書は、実装済みの**表示機能**と**「公開 API（P2）」による配信・公開方式**を対象とする。
- 地点データを作成する別アプリ（MapGPS 系）側は本書の対象外。
- 具体的な運用手順（担当者向け）は [運用手順書](closures-operations-202607.md) に分冊。

### 1.4 用語
| 用語 | 意味 |
|------|------|
| closures | 本機能で扱う通行止め・通行困難地点の総称 |
| 公開ストア | ユーザーの端末が取得しに行く共有の保存先（**Vercel Blob**） |
| マップに反映 | 読み込んだ geojson を**この端末のみ**に反映（localStorage 保存） |
| 公開 | 反映済みデータを公開 API へ送信し、**ユーザー**へ配信（Blob 全置換） |
| version | データのバージョン（トップレベル・必須）。更新のたびに変える |

---

## 2. 配信方式（P2 採用・実装済み）

### 2.1 検討した選択肢と結論
| 案 | 内容 | 採否 |
|----|------|------|
| アプリシェル同梱 | 既存 geojson と同様に同梱 | ✕ 変更ごとに再デプロイ＋ユーザー更新が必要で重い |
| P1: 1コマンド git 公開 | スクリプトで commit→push→自動デプロイ | ✕ **廃止・削除**（ブラウザから実行不可＋push権限を配る運用が安全上不適） |
| **P2: 同一プロジェクトの公開API** | Vercel Function 経由で公開ストア（Blob）へ保存 | **◎ 採用・実装** |
| P3: Firebase | Firestore に保存＝公開 | ✕ Firebase 不使用のため対象外 |

### 2.2 採用理由（P2）
- ブラウザ内のボタンは git push を実行できないため、押下先となる**API が必須**。P2 は
  「スマホのブラウザだけで、ボタン一つで全公開」という要件を満たす唯一の方式。
- 外部サービス依存ではなく**自プロジェクト（Vercel）自身の Function** であり、データ更新は
  **git / deploy を一切経由しない**。運用担当者の端末に git は不要。
- 静的ホスティングの PWA でユーザーに見せるには、全端末が取得しに行く**共有の置き場**が必須。
  P2 は自配信元（Vercel Blob）をその置き場とし、運用担当者の操作を1ボタンに包む。

### 2.3 P1 → P2 の移行経緯
当初（2026-07-15）は P1（`publish-closures.bat` による git 公開）で実装したが、
運用要件が「git・PC 作業をなくし、スマホのブラウザだけで公開完結」に変わり、
2026-07-16 に P2（API + Blob）へ移行した。P1 のスクリプト（`publish-closures.bat` /
`publish-closures.ps1`）は、push 権限を運用端末に配る必要があり安全上不適なため、
その後**廃止・削除**した（公開 API 障害時は 5章 の「公開」再試行と、失敗時のバックアップ保存で対応）。

---

## 3. アーキテクチャ全体像

```
[別アプリ MapGPS → MapEditor]
    │ 通行止め地点の geojson を作成（version 付き・各地点は Point）
    ▼
[運用担当者の端末ブラウザ：本PWA を ?closure=true で起動]
    │ ① ホーム「通行止め・通行困難地点」→ マップ画面＋編集パネル
    │ ② ファイル読み込み（プレビュー表示・未反映）
    │ ③ バージョン変更 →「マップに反映」（localStorage・この端末のみ）
    │ ④「公開」ボタン
    ▼ POST /api/closures（x-publish-token 認証）
[Vercel Function（api/closures.js）]
    │ 検証 → Blob へ全置換保存（+ 履歴スナップショット）
    ▼
[公開ストア：Vercel Blob]  closures/minoh-hiking-closure.geojson
    ▲ GET /api/closures（認証不要・no-store・CORS *）
    │   Blob 未作成・取得失敗時は空の FeatureCollection を返す
[一般ユーザーの端末：本PWA]
    └ 起動時に取得して全地点を地図に描画
       （オフライン時は SW の closures-cache = 最終取得を表示）
```

- 一般ユーザーには**公開された全地点をそのまま表示**する（`status` による絞り込みは行わない）。
- 「マップに反映」は**その端末だけ**、「公開」で**ユーザー**、という2段構え。

---

## 4. データ仕様

### 4.1 ファイル／配信
- 既存 `minoh-hiking-routes-spots.geojson` とは**別ファイル**。
- 本番の配信元は**公開 API（`GET /api/closures`）**＝ Vercel Blob。
- **アプリシェル（`SHELL_CACHE`）には同梱しない**（再デプロイ・更新プロンプト無しで反映するため）。
- 同梱の静的ファイルは**廃止・削除済み**（2026-07-18）。P2 移行後は公開のたびに更新する経路が
  無く陳腐化するだけのため。API 不達時は SW の `closures-cache`（最終取得）が代替し、
  それも無ければ表示なし（古い情報を出すより安全）。

### 4.2 GeoJSON スキーマ（実装）
FeatureCollection。各 Feature は Point。

**トップレベル**

| プロパティ | 型 | 必須 | 説明 |
|------------|----|------|------|
| `type` | string | ✓ | 固定値 `"FeatureCollection"` |
| `version` | string | ✓ | データのバージョン。更新のたびに変える（推奨 `日付.連番` 例 `2026-07-16.1`） |
| `updatedAt` | string | - | **公開時にサーバーが ISO 8601 で付与**（送信値は上書きされる） |
| `features` | array | ✓ | 地点の配列 |

**各 Feature の properties**（表示・スタイルに使用。API の必須検証は下記「検証」を参照）

| プロパティ | 型 | 説明 | 表示 |
|------------|----|------|------|
| `kind` | string | `"closed"`（通行止め）/ `"difficult"`（通行困難）。未指定・不明は closed 扱い | マーカー形状・色 |
| `name` | string | 名称（例「風呂谷 倒木」） | ポップアップ見出し（無ければ `id`） |
| `reason` | string | 理由（工事 / 倒木 / 落石 等） | ポップアップ「理由: …」 |
| `note` | string | 補足（例「巻き道あり」） | ポップアップ |
| `updatedAt` | string | 地点の更新日（`YYYY-MM-DD` 等） | ポップアップ「更新日: …」 |
| `id` | string | 地点の識別子（任意）。付ける場合は**全地点で一意** | ポップアップ（name が無い場合の代替） |

geometry: `{ "type": "Point", "coordinates": [経度, 緯度(, 標高)] }`

> **ドラフト（202606）からの変更:** 各地点の `status`（draft/published）と、Feature の必須
> `type: "closure"` は**廃止**した。公開/非公開はトップレベル `version` による**ファイル全置換**で表す
> （公開されたファイル内の地点はすべてユーザーに表示される）。

### 4.3 例
```json
{
  "type": "FeatureCollection",
  "version": "2026-07-16.1",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "kind": "difficult",
        "name": "風呂谷 倒木",
        "reason": "倒木",
        "note": "巻き道あり",
        "updatedAt": "2026-07-16",
        "id": "C-01"
      },
      "geometry": { "type": "Point", "coordinates": [135.476, 34.850] }
    }
  ]
}
```
> `updatedAt`（トップレベル）は公開時にサーバーが付与するため、送信ファイルに含める必要はない。

### 4.4 可視性
- 一般ユーザー・運用担当者を問わず、**公開されたファイル内の全地点を描画**する。
- draft/published のような UI 上の出し分けは行わない（`status` を廃止したため）。
- 一部解除は「その地点を含まない geojson を公開」、全解除は「0 件の geojson を公開」で行う（全置換）。

---

## 5. 公開API（実装: `api/closures.js`）

Vercel Function（ESM。`package.json` の `type: module`、`@vercel/blob` に依存）。

### 5.1 エンドポイント
| メソッド | パス | 認証 | 説明 |
|----------|------|------|------|
| `OPTIONS` | `/api/closures` | 不要 | CORS プリフライト（204） |
| `GET` | `/api/closures` | 不要 | 公開ストアの最新 geojson を返す |
| `POST` | `/api/closures` | **必要** | 受け取った geojson を Blob へ全置換保存（+ 履歴） |

- CORS: `Access-Control-Allow-Origin: *` / `Methods: GET, POST, OPTIONS` /
  `Headers: Content-Type, x-publish-token`（GitHub Pages 版から参照するため）。

### 5.2 保存先（Vercel Blob）
| 用途 | パス |
|------|------|
| 公開データ（全置換対象） | `closures/minoh-hiking-closure.geojson` |
| 履歴スナップショット | `closures/history/{updatedAt}-v{version}.geojson`（ランダムサフィックス付き） |

- Blob 接続時に `BLOB_READ_WRITE_TOKEN` が自動付与される。
- 保存は `allowOverwrite: true` / `addRandomSuffix: false` / `cacheControlMaxAge: 60`（最小）。
  **CDN キャッシュ回避のため、GET 時は Blob URL に毎回ユニークなクエリを付けて取得**する。

### 5.3 GET の挙動
1. `head(BLOB_PATH)` で Blob の存在を確認し、あればユニーククエリ付きで本体を取得して返す。
2. Blob 未作成・取得失敗時は `200` で空の `FeatureCollection`（`version: ""`, `features: []`）を返す
   （アプリの表示を止めない）。静的ファイルへのフォールバックは廃止（→ §4.1）。
- ヘッダ: `Cache-Control: no-store` / `Content-Type: application/geo+json; charset=utf-8`。

### 5.4 POST の挙動（公開）
1. **トークン未設定**（環境変数 `CLOSURES_PUBLISH_TOKEN` が無い）→ `503`（fail-closed）。
2. **トークン照合**: ヘッダ `x-publish-token` を、**SHA-256 ハッシュ同士の `timingSafeEqual`**
   （タイミング攻撃対策）で照合。不一致は `401`。
3. **入力検証**（下記 5.5）→ 不正は `400`。
4. `updatedAt` をサーバー時刻（ISO 8601）で付与し、`put` で Blob を**全置換保存**。
5. 履歴スナップショットを保存（失敗しても公開自体は成立させる）。
6. 成功 `200`（`{ ok, version, count, updatedAt }`）。Blob 保存失敗は `500`。

### 5.5 入力検証（`validateClosureGeoJSON`）
- `type === "FeatureCollection"` かつ `features` が配列であること。
- `version` が空でない文字列であること（**公開にはバージョンが必須**）。
- 各 Feature が `Feature` かつ `geometry.type === "Point"` で `coordinates` が配列であること。
- 座標が箕面エリアの範囲内: **経度 135.2〜135.8 / 緯度 34.6〜35.1**（範囲外は入力ミスとして 400）。
- `id` を付ける場合は**全地点で一意**（重複は 400）。
- 認証を検証より前に実施（未認証者に検証詳細を返さない）。クライアント側（app.js）でも
  同等の一次検証を行う（二重チェック）。

---

## 6. キャッシュ／オフライン（Service Worker）

- `/api/closures` は **`SHELL_CACHE` に含めない**。専用の **`closures-cache`** を用いる。
- 取得戦略は **network-first**: オンライン時は常に最新を取得して `closures-cache` を更新し、
  オフライン時はキャッシュ（最終取得）を返す。fetch は **`cache: 'no-cache'`** で
  HTTP キャッシュを再検証させる（公開直後でも最新を取得するため）。
- SW は `/api/closures` を**オリジンに依らずパス判定**で処理する（GitHub Pages 版が
  Vercel 本番の絶対 URL を叩くケースに対応）。
- activate 時は `closures-cache` と `gsi-*` を保持（旧 `app-shell-*` のみ掃除）。
- アプリ側は取得できた配信データと localStorage の「マップに反映」データを **version で突合**し、
  一致すれば localStorage を削除する**自己修復**を行う（公開完了後に素直に配信版へ戻す）。

---

## 7. 運用担当者向けフロー（`?closure=true` 編集パネル）

> preview モード（`?preview=closures`）は**実装せず**、`?closure=true` の編集パネル方式を採用した。
> 詳細な操作手順は [運用手順書](closures-operations-202607.md) を参照。

### 7.1 編集機能の有効化
- URL `?closure=true` で起動すると、sessionStorage フラグ `minoh-hiking.closure-flag` を立てる
  （同一タブ内のリロードでは維持。タブを閉じれば消えるため、直接アクセスでは有効にならない）。
- フラグがあるとき**のみ**、ホームに「通行止め・通行困難地点」ボタンを表示する。

### 7.2 編集パネル（マップ画面右上）
ボタン押下で map ビューへ移動し、右上に編集パネルを開く。項目は次のとおり。

| 要素 | 動作 |
|------|------|
| バージョン入力 | 新しい version を入力する欄（現在値と異なる値にすると「マップに反映」が押せる） |
| ファイル読み込み | geojson を選択し、地図に**プレビュー表示**（未反映。JSON/形式を一次検証） |
| マップに反映 | 入力 version を付与して **localStorage（`minoh-hiking.closure-data`）に保存**。この端末のみに反映 |
| 公開 | 反映済みデータを `POST /api/closures` でユーザーへ公開 |
| キャンセル | 未反映の読み込みを破棄し、反映済み表示に戻す（マップ画面を離れると自動キャンセル） |

- **「マップに反映」の活性条件**: ファイル読み込み済み、かつ version が現在値から変更されている。
- **「公開」**: 反映済みデータが必要。0 件公開時は「全地点が消える」旨の**警告付き確認**を表示。
  公開トークンは初回に `prompt` で入力して localStorage（`minoh-hiking.closure-publish-token`）に保存し、
  `401`（トークン誤り）時は削除して再入力を促す。
- **公開失敗時**: 失敗メッセージは**エラーコード（E01〜E05）付き**で表示し、運用担当者が
  開発担当者へコードを伝えるだけで切り分けできる（分類は運用手順書 §9）。あわせて編集内容を
  **端末にバックアップ保存**でき（`minoh-hiking-closure.geojson`）、やり直し・開発担当者への連携に使える。

### 7.3 端末反映と公開の関係
- ファイル読み込み＝プレビュー（未反映）、マップに反映＝この端末のみ、公開＝ユーザー、の3段階。
- 「公開」は反映済みデータ（`version` 付き）に対して行う。バージョンは各端末の
  「新しいデータが来た」判定に使うため、更新のたびに必ず変える。

---

## 8. 表示UI（ユーザー）

- **表示タイミング**: マップ表示（map ビュー）中は**常時表示**する（専用の表示トグルは設けない）。
  ホーム／ナビビューでは非表示。
- **マーカー（既定スタイル。「マーカーの設定」で色・形・サイズを変更可能）**:

  | 種別（`kind`） | 既定の形状・色 |
  |----------------|----------------|
  | closed（通行止め） | **赤い✖**（`#DC2626` / size 16） |
  | difficult（通行困難） | **橙色の三角**（`#F59E0B` / size 12） |

- **ポップアップ**: 名称（`name`／無ければ `id`）・種別・理由・補足・更新日を表示
  （すべて `escapeHtml` で XSS 対策）。
- **バージョン表示**: 「設定と情報」モーダルの「バージョン情報」に、現在反映されている通行止めデータの
  `version` を表示する。
- スタイルは `MARKER_TYPES`（`closureClosed` / `closureDifficult`）の既定値を「マーカーの設定」で
  変更できる。`map.js` は設定未適用時のフォールバック `CLOSURE_FALLBACK_STYLES` を持つ。

---

## 9. ドラフトの保留事項の扱い

202606 §9 の保留事項（`status` フラグの編集場所・id マージ方針・作業コピー仕様）は、
**`status` を廃止して `version` ベースの全置換に切り替えたことで解消**した。

- 公開/非公開の区別が不要になったため、`status` の編集場所の議論は発生しない。
- 「テスト→公開」は、対象を反映した geojson を**新しい version で公開**することで成立する。
- id は任意（一意制約のみ）。過去の公開判断を id で継承する必要がないため、マージ方針は不要。

---

## 10. アプリ側の実装（as-built）

| ファイル | 実装内容 |
|----------|----------|
| `api/closures.js`（新規） | GET/POST。トークン認証（timing-safe）・スキーマ検証・Blob 全置換保存・履歴スナップショット |
| `public/config.js` | closures 用キー（`CLOSURE_FLAG_KEY`/`CLOSURE_DATA_KEY`/`CLOSURE_TOKEN_KEY`）、`CLOSURE_FILE_NAME`（バックアップ保存のファイル名）、`CLOSURE_API_URL`（GitHub Pages 時は Vercel 絶対 URL、他は相対） |
| `public/map.js` | `setClosureGeoJSON`/`setClosuresVisible`/`buildClosureLayer`、`setClosureClosedStyle`/`setClosureDifficultStyle`（マーカー設定連動、既定は `CLOSURE_FALLBACK_STYLES`）、ポップアップ（escapeHtml） |
| `public/closures.js`（app.js から分離） | `?closure=true` 検出、編集パネル（読み込み/反映/公開/キャンセル）、`loadClosures`（API→静的→localStorage フォールバック＋自己修復）、公開 POST（失敗時 E01〜E05 案内・バックアップ保存） |
| `public/service-worker.js` | `/api/closures` を network-first + `closures-cache`（パス判定・`no-cache`） |
| `public/index.html` | ホームの「通行止め・通行困難地点」ボタン（既定 hidden）、編集パネル、「設定と情報」モーダルのバージョン・件数表示欄 |
| Vercel 設定 | Blob ストア接続（`BLOB_READ_WRITE_TOKEN` 自動）、環境変数 `CLOSURES_PUBLISH_TOKEN` |

---

## 11. セキュリティ・運用上の考慮

詳細は [セキュリティレビュー `closures-security-review-202607.md`](closures-security-review-202607.md) を参照。要点のみ:

- 公開トークンは**コードに埋め込まない**（Vercel 環境変数のみ。`.gitignore` が `.env*` を除外）。
  **十分長いランダム値＋定期ローテーション**を推奨（最優先対策）。POST パスへのレート制限
  （Vercel Firewall）も推奨。
- トークン照合は**タイミングセーフ比較**（SHA-256 + `timingSafeEqual`）。未設定時は `503` で fail-closed。
- 公開は**全置換**のため、0 件送信で全消去になる。**0 件公開時の警告付き確認**を実装済み。
  誤操作・改ざんに備え、**履歴スナップショット**で事後復旧の余地を確保。
- ポップアップは `escapeHtml` で XSS 対策。トークンを localStorage に保存するため、運用端末の限定
  （共用環境で公開しない）を運用ルールとする。

---

## 12. git/GitHub 運用とコード・データの分離

P2 では **「コード」と「実データ」で GitHub の扱いが正反対**になる。

| 種類 | 中身 | 置き場所 | git/GitHub |
|------|------|----------|------------|
| コード | Function・`map.js`・`app.js`・`config.js`・`service-worker.js`・`index.html`・本設計書・`vercel.json` | リポジトリ | ○ git 管理 → push → Vercel 自動デプロイ |
| closures 実データ | 公開された通行止め・通行困難地点の geojson | 公開ストア（Vercel Blob） | ✕ git 非経由（API で直接更新） |
| 秘密情報 | 公開トークン（`CLOSURES_PUBLISH_TOKEN`） | Vercel 環境変数 | ✕ コミットしない |

**2つのフローの分離**
- ① 機能の開発・修正（開発担当・git 経由）: コード変更 → commit → push → 自動デプロイ。
- ② データの公開（運用担当・git 非経由）: 編集パネルで読み込み → 反映 → 「公開」→ POST → Blob。

**運用上の注意**
- **再デプロイで実データは消えない**（実データはリポジトリ外の Blob にあるため）。
- データの取得元は**公開 API のみ**（同梱静的ファイルは廃止済み → §4.1）。
- 履歴は Blob の履歴スナップショットで保持（git には求めない。P1 発想への逆戻りを避ける）。

---

## 13. 対象外（当面）

- 別アプリ（MapGPS 系）側の改修。
- ルート単位の「迂回案内」「自動う回ルート計算」等のナビ連携。
- 本人特定つき監査ログ・複数運用者の同時編集制御（セキュリティレビュー §6 の残留リスク）。

---

## 14. 変更履歴

| 日付 | バージョン | 内容 |
|------|-----------|------|
| 2026-06-20 | 0.1（ドラフト） | 設計検討ドラフト（P2 提案・preview モード・`status` フラグ案）。※本ドラフト文書は廃止（内容は git 履歴に保存） |
| 2026-07-16 | 0.2 | 実装済み（as-built）版に更新。P2（Vercel Function + Blob）採用、`?closure=true` 編集パネル、`version` ベース全置換（`status` 廃止）、固定マーカースタイル、常時表示、履歴スナップショット、timing-safe 認証、GitHub Pages 絶対 URL を反映 |
| 2026-07-18 | 0.3 | 旧 P1 スクリプト（publish-closures.bat/ps1）を安全性の観点から廃止・削除。同梱静的ファイルと静的フォールバック（API・アプリ・SW）を廃止し、配信を公開APIに一本化（GET は Blob 未取得時に空 FeatureCollection）。公開失敗メッセージをエラーコード（E01〜E05）付きに刷新し、失敗時のバックアップ保存に改称。呼称を「ユーザー」「開発担当者」に統一 |
