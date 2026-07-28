# 通行止め・通行困難地点 表示機能・公開API 設計書（実装済み版）

**バージョン:** 0.4
**最終更新日:** 2026年7月28日
**ステータス:** 実装済み（**表示専用** + 公開API: Vercel Function + Vercel Blob）
**公開API 契約バージョン:** **1.0**（→ [5章](#5-公開apiapiclosuresjs契約バージョン-10)）
**関連:** [セキュリティレビュー `closures-security-review-202607.md`](closures-security-review-202607.md) / [テスト計画 `closures-test-plan-202607.md`](closures-test-plan-202607.md) / [機能仕様書 `funcspec-202607.md`](../docs/funcspec-202607.md)

> **本アプリ（minoh-hiking）は表示専用である。** 通行止め・通行困難地点の位置指定・
> 属性編集・公開は行わず、公開されたデータを取得して描画するだけである。
>
> **公開API（`api/closures.js`）は本リポジトリが提供する。** `POST`（公開）は
> **外部の運用アプリ**（別リポジトリ）から呼ばれるため、
> [5章](#5-公開apiapiclosuresjs契約バージョン-10)が**外部向け契約の正本**である。
> 検証・レスポンスを変えるときは契約バージョンを更新し、呼び出し側にも反映すること。

---

## 1. 概要

### 1.1 目的
ハイキングマップ上に、工事による通行止めや、倒木・落石等による通行困難箇所を
地点（Point）として重ね合わせ表示する。対象地点は運用担当者が登録・判断し、
一般ユーザーへ即時公開・即時解除できる運用を可能にする。

### 1.2 背景・前提
- 通行止め／通行困難は**一時的・頻繁に変化し、解除（削除）も必要**な情報である。
  既存の geojson（緊急ポイント・ルート/スポット）と異なり、即時の反映・解除が求められる。
- 地点データの**作成・公開は外部の運用アプリ**が行う。本アプリでは作成も公開もせず、
  **公開されたデータの表示のみ**を行う。Firebase は使用しない。
- 登録・公開は**運用担当者**が行い、開発担当の作業（git commit / deploy 等）を介在させない
  （本要件が P2 採用の決め手）。

### 1.3 スコープ
- 本書は、本アプリの**表示機能**と、本リポジトリが提供する**公開API（P2）**を対象とする。
- 地点データを作成・公開する運用アプリ側の仕様は本書の対象外
  （ただし [5章](#5-公開apiapiclosuresjs契約バージョン-10)は呼び出し側向けの**契約の正本**）。

### 1.4 用語
| 用語 | 意味 |
|------|------|
| closures | 本機能で扱う通行止め・通行困難地点の総称 |
| 公開ストア | ユーザーの端末が取得しに行く共有の保存先（**Vercel Blob**） |
| 公開 | 運用アプリから公開 API へ送信し、**ユーザー**へ配信すること（Blob 全置換） |
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
[外部の運用アプリ（別リポジトリ）]              ← 本書の対象外
    │ 地点の位置指定・属性編集
    │ version を付けて公開
    ▼ POST /api/closures（x-publish-token 認証・クロスオリジン）
[Vercel Function（api/closures.js）]           ← 本リポジトリ
    │ 検証 → Blob へ全置換保存（+ 履歴スナップショット）
    ▼
[公開ストア：Vercel Blob]  closures/minoh-hiking-closure.geojson
    ▲ GET /api/closures（認証不要・no-store・CORS *）
    │   Blob 未作成・取得失敗時は空の FeatureCollection を返す
[一般ユーザーの端末：本PWA]                     ← 本リポジトリ（表示専用）
    └ 起動時に取得して全地点を地図に描画
       （オフライン時は SW の closures-cache = 最終取得を表示）
```

- 一般ユーザーには**公開された全地点をそのまま表示**する（`status` による絞り込みは行わない）。
- 本アプリは公開APIを **GET でしか呼ばない**。公開（POST）の経路は本アプリに存在しない。

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

## 5. 公開API（`api/closures.js`）＝契約バージョン 1.0

Vercel Function（ESM。`package.json` の `type: module`、`@vercel/blob` に依存）。

> **本章は、公開（POST）を行う外部の運用アプリ向けの契約の正本である。**
> 呼び出し側のドキュメントに API 仕様を書き写さず、本章を参照するだけとする
> （書き写すと必ずズレるため）。
> 検証ルール・レスポンスを変えたときは、**破壊的変更なら契約バージョンを上げ**、
> 呼び出し側にも反映すること（`api/closures.js` の先頭コメントにも同じ注意書きがある）。

### 5.0 契約サマリ（外部から実装するために必要な項目）

| 項目 | 内容 |
|------|------|
| 契約バージョン | **1.0** |
| エンドポイント | `POST https://minoh-hiking.vercel.app/api/closures` |
| 認証 | `x-publish-token` ヘッダ（値は Vercel 環境変数 `CLOSURES_PUBLISH_TOKEN` と同一） |
| CORS | 全オリジン許可・`OPTIONS` 対応済み（**呼び出し側の追加実装は不要**） |
| リクエスト | `Content-Type: application/json`、ボディは `version` を持つ FeatureCollection |
| サーバーが上書きするもの | トップレベル `updatedAt`（POST 時にサーバーが付与） |
| 成功応答 | `200 {ok, version, count, updatedAt}` |
| 失敗応答 | `400`（検証エラー・`error` に日本語説明）/ `401`（トークン不正）/ `503`（サーバー側トークン未設定）/ `500`（公開ストア保存失敗） |
| エラーコード対応 | E01=401 / E02=503 / E03=400 / E04=500 / E05=通信不能（**呼び出し側が表示するときの呼び名**） |
| 保存の意味 | **全置換**（0件送信で全消去）＋履歴スナップショット |
| 現在公開中の version の取得 | `GET /api/closures`（認証不要）のトップレベル `version` |

- **失敗時のエラー文言はサーバーが日本語で返す**（`{ error: "..." }`）。呼び出し側は
  検証ルールを再実装せず、受け取ったメッセージをそのまま運用担当者へ表示すればよい。
  これにより検証ルールが変わっても説明がそのまま届き、二重管理が発生しない。

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
- 認証を検証より前に実施（未認証者に検証詳細を返さない）。
- **この検証はサーバー側にのみ持つ。** 呼び出し側には
  「JSON として読めるか／`FeatureCollection` か／`Point` が1つ以上あるか」程度の
  最小限の一次検証だけを置き、座標範囲・`id` 一意・`version` 必須の判定は本 API に任せる。
  同じルールを両側に実装すると必ずズレるため、意図的にサーバーへ一本化している。

---

## 6. キャッシュ／オフライン（Service Worker）

- `/api/closures` は **`SHELL_CACHE` に含めない**。専用の **`closures-cache`** を用いる。
- 取得戦略は **network-first**: オンライン時は常に最新を取得して `closures-cache` を更新し、
  オフライン時はキャッシュ（最終取得）を返す。fetch は **`cache: 'no-cache'`** で
  HTTP キャッシュを再検証させる（公開直後でも最新を取得するため）。
- SW は `/api/closures` を**オリジンに依らずパス判定**で処理する（GitHub Pages 版が
  Vercel 本番の絶対 URL を叩くケースに対応）。
- activate 時は `closures-cache` と `gsi-*` を保持（旧 `app-shell-*` のみ掃除）。
- 取得元は公開API（＋SW キャッシュ）のみで、localStorage は一切使わない。

---

## 7. 公開と本アプリの関係

- **公開の操作は本アプリに存在しない。** 位置指定・属性編集・公開は
  外部の運用アプリが行い、本アプリは公開されたデータを取得して描画するだけである。
- 本アプリの役割は**公開後の確認先**である。公開前の実機プレビューは持たないため、
  運用は **公開 → 本アプリで確認 → 必要なら直して再公開** となる
  （全置換＋履歴スナップショットがあるため復旧可能）。
- 公開内容が各端末に届くのは、**次にマップを開いたとき**である（→ [6章](#6-キャッシュオフラインservice-worker)）。

---

## 8. 表示UI（ユーザー）

- **表示タイミング**: マップ表示（map ビュー）中は**常時表示**する（専用の表示トグルは設けない）。
  ホーム／ナビビューでは非表示。
- **マーカー（既定スタイル。「マーカーの設定」で色・形・サイズを変更可能）**:

  | 種別（`kind`） | 既定の形状・色 |
  |----------------|----------------|
  | closed（通行止め） | **赤い✖**（`#DC2626` / size 10） |
  | difficult（通行困難） | **橙色の三角**（`#F59E0B` / size 16） |

- **ポップアップ**: 名称（`name`／無ければ `id`）・種別・理由・補足・更新日を表示
  （すべて `escapeHtml` で XSS 対策）。
- **バージョン表示**: 「バージョン情報等」モーダルの「バージョン情報」に、現在反映されている通行止めデータの
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
| `api/closures.js` | GET/POST。トークン認証（timing-safe）・スキーマ検証・Blob 全置換保存・履歴スナップショット。**POST を呼ぶのは外部の運用アプリのみ**（先頭コメントに注意書きあり） |
| `public/config.js` | `CLOSURE_API_URL`（GitHub Pages 時は Vercel 絶対 URL、他は相対）、`MARKER_TYPES` の `closureClosed`/`closureDifficult` |
| `public/map.js` | `setClosureGeoJSON`/`setClosuresVisible`/`buildClosureLayer`、`setClosureClosedStyle`/`setClosureDifficultStyle`（マーカー設定連動、既定は `CLOSURE_FALLBACK_STYLES`）、ポップアップ（escapeHtml） |
| `public/closures.js` | `loadClosures()`（`GET /api/closures` のみ）、`getClosureVersion()`、`getClosureCount()` の3関数だけ（約50行） |
| `public/service-worker.js` | `/api/closures` を network-first + `closures-cache`（パス判定・`no-cache`） |
| `public/i18n.js` | ポップアップ用の4キーのみ（`closure.kindClosed`/`kindDifficult`/`popupReason`/`popupUpdated`） |
| `public/index.html` | 「バージョン情報」モーダルのバージョン・件数表示欄 |
| Vercel 設定 | Blob ストア接続（`BLOB_READ_WRITE_TOKEN` 自動）、環境変数 `CLOSURES_PUBLISH_TOKEN` |

> **後始末（一時コード）:** かつて運用端末に保存していた公開トークン
> （`minoh-hiking.closure-publish-token`）と反映データ（`minoh-hiking.closure-data`）を、
> `closures.js` の冒頭で `localStorage.removeItem()` して消している。
> **この4行は次のリリースで取り除くこと。**

---

## 11. セキュリティ・運用上の考慮

詳細は [セキュリティレビュー `closures-security-review-202607.md`](closures-security-review-202607.md) を参照。要点のみ:

- 公開トークンは**コードに埋め込まない**（Vercel 環境変数のみ。`.gitignore` が `.env*` を除外）。
  **十分長いランダム値＋定期ローテーション**を推奨（最優先対策）。POST パスへのレート制限
  （Vercel Firewall）も推奨。
- トークン照合は**タイミングセーフ比較**（SHA-256 + `timingSafeEqual`）。未設定時は `503` で fail-closed。
- 公開は**全置換**のため、0 件送信で全消去になる。0 件公開時の警告付き確認は
  **呼び出し側**の責務。誤操作・改ざんに備え、**履歴スナップショット**で
  事後復旧の余地を確保している。
- ポップアップは `escapeHtml` で XSS 対策。
- 公開トークンは**本アプリでは扱わない**（呼び出し側の端末にのみ保存される）。
  運用端末の限定（共用環境で公開しない）は引き続き運用ルールとする。

---

## 12. git/GitHub 運用とコード・データの分離

P2 では **「コード」と「実データ」で GitHub の扱いが正反対**になる。

| 種類 | 中身 | 置き場所 | git/GitHub |
|------|------|----------|------------|
| コード | Function・`map.js`・`app.js`・`config.js`・`closures.js`・`service-worker.js`・`index.html`・本設計書・`vercel.json` | リポジトリ | ○ git 管理 → push → Vercel 自動デプロイ |
| closures 実データ | 公開された通行止め・通行困難地点の geojson | 公開ストア（Vercel Blob） | ✕ git 非経由（API で直接更新） |
| 秘密情報 | 公開トークン（`CLOSURES_PUBLISH_TOKEN`） | Vercel 環境変数 | ✕ コミットしない |

**2つのフローの分離**
- ① 機能の開発・修正（開発担当・git 経由）: コード変更 → commit → push → 自動デプロイ。
- ② データの公開（運用担当・git 非経由）: 運用アプリで地点を編集 → 公開 → POST → Blob。

**運用上の注意**
- **再デプロイで実データは消えない**（実データはリポジトリ外の Blob にあるため）。
- データの取得元は**公開 API のみ**（同梱静的ファイルは廃止済み → §4.1）。
- 履歴は Blob の履歴スナップショットで保持（git には求めない。P1 発想への逆戻りを避ける）。

---

## 13. 対象外（当面）

- 地点データを作成・公開する外部アプリ側の実装。
- ルート単位の「迂回案内」「自動う回ルート計算」等のナビ連携。
- 本人特定つき監査ログ・複数運用者の同時編集制御（セキュリティレビュー §6 の残留リスク）。

---

## 14. 変更履歴

| 日付 | バージョン | 内容 |
|------|-----------|------|
| 2026-06-20 | 0.1（ドラフト） | 設計検討ドラフト（P2 提案・preview モード・`status` フラグ案）。※本ドラフト文書は廃止（内容は git 履歴に保存） |
| 2026-07-16 | 0.2 | 実装済み（as-built）版に更新。P2（Vercel Function + Blob）採用、`?closure=true` 編集パネル、`version` ベース全置換（`status` 廃止）、固定マーカースタイル、常時表示、履歴スナップショット、timing-safe 認証、GitHub Pages 絶対 URL を反映 |
| 2026-07-18 | 0.3 | 旧 P1 スクリプト（publish-closures.bat/ps1）を安全性の観点から廃止・削除。同梱静的ファイルと静的フォールバック（API・アプリ・SW）を廃止し、配信を公開APIに一本化（GET は Blob 未取得時に空 FeatureCollection）。公開失敗メッセージをエラーコード（E01〜E05）付きに刷新し、失敗時のバックアップ保存に改称。呼称を「ユーザー」「開発担当者」に統一 |
| 2026-07-28 | 0.4 | **表示専用化**。編集・公開機能（`?closure=true` 編集パネル・ファイル読み込み・マップに反映・公開 POST・公開トークン保存）を削除。§5 を**公開API の契約の正本**として整備し**契約バージョン 1.0** を明記、§7 を公開と本アプリの関係に置換、§10 as-built を表示専用構成に更新 |
