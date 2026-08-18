# 箕面ハイキングマップ デプロイ手順書

**バージョン:** 1.0
**最終更新日:** 2026年8月18日
**対象:** 運用・開発担当者
**関連:**
[機能仕様 `funcspec-202608.md`](funcspec-202608.md) /
[公開API 仕様 `publish-api-202608.md`](publish-api-202608.md)

---

## 1. 本書について

本アプリの**配信のしかた**と、変更の種類ごとに**何をすればユーザーに届くか**をまとめる。

配信先が2つ（Vercel / GitHub Pages）あり、さらに地図データは**デプロイを伴わない公開**で
更新されるため、「どれを直したときに何が必要か」を取り違えやすい。判断はここに一本化する。

---

## 2. 配信先と役割

| 配信先 | 配信するもの | 反映のきっかけ |
|---|---|---|
| **Vercel** | アプリ（`public/`）+ **公開API**（`api/`）+ 公開ストア（Vercel Blob） | `main` への push（リポジトリ連携）／環境変数の変更後は再デプロイ |
| **GitHub Pages** | アプリ（`public/`）のみ | `main` への push（`.github/workflows/pages.yml` が自動実行） |

- 公開API は **Vercel にしか無い**。GitHub Pages 版アプリは `https://minoh-hiking.vercel.app/api/*` を
  クロスオリジンで参照する（[`config.js`](../public/config.js) が `github.io` を判定して切り替える。
  API 側は CORS を全許可）。
- したがって **API を止めると両方のアプリでデータが出なくなる**。

```
push (main)
  |
  +--> Vercel        :  public/ (app) + api/ (publish API) + Blob (store)
  |
  +--> GitHub Pages  :  public/ (app) only
                              |
                              +-- GET --> https://minoh-hiking.vercel.app/api/*

MapPublisher -- POST /api/mapdata, /api/closures --> Blob -- GET --> 両方のアプリ
```

> Vercel の Production Branch（既定は `main`）は Vercel の管理画面で確認できる。
> 本書は `main` を前提に書いている。

---

## 3. 変更の種類とやること（早見表）

| 変更したもの | 必要な作業 | デプロイ |
|---|---|---|
| **地図データ・通行止めの内容** | MapPublisher で公開する | **不要** |
| `public/` のコード・画像 | `SHELL_CACHE` をバンプ → push（→ [5章](#5-通常のデプロイアプリの更新)） | 要 |
| `api/` のコード | push | 要 |
| **Vercel の環境変数** | 値を設定 → **再デプロイ**（設定だけでは反映されない） | 要 |
| `public/data/tile_manifest.json`（タイル範囲） | `SHELL_CACHE` をバンプ → push | 要 |
| `docs/` のみ | push（`.md` を直したら `.pdf` も作り直す） | 影響なし |

**「データを直すたびにアプリを出し直す」必要は無い。** ポイント・ルート・スポット・通行止めは
すべて公開API 配信であり、MapPublisher からの公開だけでユーザーに届く。

---

## 4. 事前設定（初回・環境を作り直したときのみ）

Vercel プロジェクトに以下が必要。

1. **Blob ストアを接続する**（`BLOB_READ_WRITE_TOKEN` が自動で入る）
2. **環境変数 `MAP_PUBLISH_TOKEN` を設定する**
   - 公開（POST）の共有トークン。**32文字以上のランダム値**にする
   - コードや Git に入れない（`.gitignore` が `.env*` を除外している）
   - 未設定のまま公開すると `503`（サーバー側トークン未設定）になる
3. **設定後に再デプロイする**（環境変数は再デプロイで初めて有効）

> トークンを変えたときは、MapPublisher 側の保存済みトークンも入れ直す必要がある。

---

## 5. 通常のデプロイ（アプリの更新）

### 5.1 手順

1. **`public/service-worker.js` の `SHELL_CACHE` をバンプする**（`app-shell-yyyy-mm-dd.n`）
   - **これを忘れると、端末に旧 UI と新 UI が混ざったまま残る。**
     Service Worker はアプリシェルを stale-while-revalidate で配るため、
     キャッシュ名が同じだと更新の確認（`SHELL_CACHE` 比較 → confirm）が働かない
2. **JS ファイルを追加したときは `SHELL_LOCAL_PATHS` にも追加する**
3. **差し替えた旧ファイルを同じリリースで削除しない**
   - 端末には旧 `index.html` / 旧 `app.js` がキャッシュされたまま残ることがあり、
     消すと 404 になって画像が出ない・モジュールが読めない、といった壊れ方をする
   - 全端末がアプリ更新を通した後（次のリリース以降）に削除する
   - 現在の保留分は `public/service-worker.js` の注記にまとめてある
4. `main` へ push する（Vercel と GitHub Pages の両方が自動で更新される）
5. [7章](#7-動作確認)の確認を行う

### 5.2 ユーザーへの反映

- 起動時に「アプリの更新版があります」の確認が出る（「起動時にアプリの更新版を確認」が ON のとき）
- OK を押すと最新を取得して再読み込みする。**ダウンロード済みの地図タイルは消えない**
- 確認を出さない設定の端末でも、次回以降の読み込みで自然に最新化される

---

## 6. 今回の移行デプロイ（2026.12・1回限り）

地図データをアプリ同梱から公開API 配信へ切り替えるリリース。
**API とアプリを同時に出してはいけない。**

### 6.1 なぜ順序が要るか

アプリ側を先に切り替えると、初回公開が済むまでの間 `GET /api/mapdata` が空を返し、
**全ユーザーの地図からポイント・ルート・スポットが消える**。

`main` への push は Vercel と GitHub Pages の両方を同時に更新するため、
**2つのコミットに分け、間隔を空けて push する**。

### 6.2 手順

| # | 作業 | 対象 | 確認 |
|---|---|---|---|
| 0 | Vercel に `MAP_PUBLISH_TOKEN` を設定 | Vercel | [4章](#4-事前設定初回環境を作り直したときのみ) |
| 1 | **コミットA**（`api/` + `docs/` + `README.md`）を push | リポジトリ | `public/` は据え置き。ユーザーは同梱データのまま動き続ける |
| 2 | MapPublisher で **mapdata を初回公開** | MapPublisher | `2026.1` が採番される |
| 3 | 配信内容を確認 | curl | [7.1](#71-api-単体curl) |
| 4 | **コミットB**（`public/`）を push | リポジトリ | ここで初めてアプリが配信データを使う |
| 5 | 表示を確認 | ブラウザ | [7.2](#72-アプリ側ブラウザ) |

> 手順1の時点で **closures の公開トークンは `MAP_PUBLISH_TOKEN` に変わる**（旧
> `CLOSURES_PUBLISH_TOKEN` は使われない）。手順0 を飛ばすと通行止めの公開が `503` になる。

### 6.3 リリース後の後始末（次のリリースで行う）

全端末がアプリ更新を通したことを確認してから実施する。

1. `public/data/minoh-emergency-points.geojson` / `public/data/minoh-hiking-routes-spots.geojson` を削除
2. `public/closures.js` を削除
3. `vercel.json` の `/data/(.*)` のキャッシュ設定を見直す（残るのは `tile_manifest.json` のみ）
4. Vercel の環境変数 `CLOSURES_PUBLISH_TOKEN` を削除
5. Blob 上の旧履歴 `closures/history/` を一括削除（前回分1世代の方式に移行済みのため）

---

## 7. 動作確認

### 7.1 API 単体（curl）

Windows PowerShell では `curl` が別のコマンドの別名になっているため、**`curl.exe`** と書く。

```powershell
# version と件数（数百バイト）
curl.exe -s https://minoh-hiking.vercel.app/api/manifest

# 本体（件数だけ数える）
curl.exe -s https://minoh-hiking.vercel.app/api/mapdata  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).features.length))"
curl.exe -s https://minoh-hiking.vercel.app/api/closures | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).features.length))"

# 認証: トークン無しの POST は 401 になること（401 以外なら公開口が無防備）
curl.exe -s -o NUL -w "%{http_code}\n" -X POST -H "Content-Type: application/json" -d "{}" https://minoh-hiking.vercel.app/api/mapdata
```

確認すること:

- `GET /api/manifest` が `mapdata` / `closures` の version・updatedAt・件数を返す
- `GET /api/mapdata` の件数が公開した件数と一致する（初回公開なら 668 件）
- 公開のたびに version の連番が1つ進む（`2026.1` → `2026.2`）
- トークン無し・誤トークンの POST が `401`

### 7.2 アプリ側（ブラウザ）

Vercel 版・GitHub Pages 版の**両方**で確認する。

- 「ハイキングマップ表示」で緊急ポイント・ルート・スポット・通行止めが描画される
- ルート線が端点（開始・終了ポイント）まで伸びている
- 「バージョン情報」に地図データ・通行止めの version と件数が出る（`-` でない）
- 2回目に開いたとき、DevTools の Network に **`/api/mapdata` が出ない**
  （version が一致するので本体を取りに行かない）
- 公開した直後に開き直すと、新しい version と件数に変わる
- オフライン（機内モード）で開いても、前回取得した内容が表示される

---

## 8. 復旧・ロールバック

| 状況 | 対処 |
|---|---|
| 誤ったデータを公開した | **正しいデータをもう一度公開する**（全置換）。直前の内容は Blob の `previous.geojson` に1世代だけ残っている |
| 公開が `500` で失敗した | **もう一度公開する。** `manifest.json` が進んでいないため同じ version が採番される（冪等）。二重に version が飛ぶことはない |
| アプリの不具合を出してしまった | Vercel の Instant Rollback で前のデプロイに戻す。**あわせて `main` を `git revert` する**（戻さないと次の push で再発する） |
| GitHub Pages 側だけ古い | Actions の `Deploy to GitHub Pages` が失敗していないか確認し、`workflow_dispatch` で再実行する |

> ロールバックしても、端末のキャッシュは `SHELL_CACHE` の名前で判断される。
> 戻した版のキャッシュ名が新しい版と同じだと更新が検知されないため、
> **切り戻し版でもキャッシュ名を1つ進めて出し直す**のが確実。

---

## 9. トラブルシューティング

| 症状 | 主な原因 | 対処 |
|---|---|---|
| 公開が `503`（トークン未設定） | `MAP_PUBLISH_TOKEN` 未設定、または**設定後に再デプロイしていない** | 環境変数を確認して再デプロイ |
| 公開が `401` | トークン不一致 | MapPublisher の保存済みトークンを入れ直す |
| 公開が `400` | データが検証に通らない | API が返す日本語メッセージのとおりに直す（判定は [`publish-api-202608.md`](publish-api-202608.md) §6 にのみ置いている） |
| 公開したのにアプリに出ない | 端末がまだ起動し直していない | アプリを開き直す。公開は各端末が次に起動したときに反映される |
| 旧 UI と新 UI が混ざる | `SHELL_CACHE` のバンプ漏れ | キャッシュ名を進めて出し直す |
| 起動画面の画像やモジュールが 404 | 差し替えた旧ファイルを同じリリースで消した | ファイルを戻し、次のリリース以降に削除する |
| オフラインで地図データが出ない | Service Worker の掃除で `mapdata-cache` / `closures-cache` を消している | `service-worker.js` の `APP_MANAGED_CACHES` に入っているか確認する |
| GitHub Pages 版だけデータが出ない | Vercel 側の API が落ちている／CORS 設定の変更 | `curl.exe` で Vercel の API を直接確認する |

---

## 10. デプロイ前チェックリスト

- [ ] `public/` を変更した → `SHELL_CACHE` をバンプした
- [ ] JS ファイルを追加した → `SHELL_LOCAL_PATHS` に追加した
- [ ] 差し替えた旧ファイルを**このリリースでは消していない**
- [ ] 環境変数を変えた → 再デプロイする段取りになっている
- [ ] `docs/*.md` を直した → `docs/*.pdf` を作り直した
- [ ] データの内容だけの変更なら、**デプロイではなく MapPublisher からの公開**で足りると確認した

---

## 11. 変更履歴

| 版 | 日付 | 内容 |
|---|---|---|
| 1.0 | 2026-08-18 | 初版。配信先2つの役割、変更の種類ごとの作業、2026.12 の移行デプロイ手順（API とアプリを分けて出す）、確認・復旧・トラブルシューティングをまとめた |
