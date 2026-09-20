# 他リポジトリへの MIT License 追加手順

**バージョン:** 1.0
**最終更新日:** 2026年9月20日
**対象:** 運用・開発担当者

---

## 1. 本書について

minoh-hiking で行った **MIT License の登録**を、sato4app の他の公開リポジトリにも広げるための手順。
「どこを直せば GitHub に『MIT license』と表示されるか」と、「何を対象外にするか」をまとめる。

本書は minoh-hiking の `docs/` に置いているが、**内容は全リポジトリ共通**である。

---

## 2. 前提

- **ライセンスはリポジトリごとに登録する。** アカウント全体へ一括で付ける仕組みは無い。
  共通の設定ファイルを置ける `.github` リポジトリの仕組みがあるが、**LICENSE はその対象外**
  （複製・ダウンロードしたときに一緒に付いていく必要があるため）。
- **GitHub の設定画面で行う作業は無い。** リポジトリの一番上の階層に `LICENSE` を置けば、
  GitHub が中身を読み取り、リポジトリのページ右側「About」に「MIT license」と表示する。
- **現状（2026-09-20）:** 公開リポジトリ19件のうち、ライセンスがあるのは minoh-hiking だけ。

### 対象リポジトリと作業フォルダ（`C:\Users\showa\Documents` 以下）

| リポジトリ | 作業フォルダ | 作成年 |
|---|---|---|
| ColorSample | `アプリ(PWA対応)\ColorSample` | 2026 |
| log-timer | `アプリ(PWA対応)\log-timer` | 2026 |
| PayNote | `アプリ(PWA対応)\PayNote` | 2026 |
| Portfolio | `アプリ(PWA対応)\Portfolio` | 2026 |
| TabataTimer | `アプリ(PWA対応)\TabataTimer` | 2025 |
| DownloadArea | `ハイキングアプリ\DownloadArea` | 2026 |
| GeoReferencer | `ハイキングアプリ\GeoReferencer` | 2025 |
| MapEditor | `ハイキングアプリ\MapEditor` | 2025 |
| MapGPS | `ハイキングアプリ\MapGPS` | 2025 |
| MapPublisher | `ハイキングアプリ\MapPublisher` | 2026 |
| PointGPS | `ハイキングアプリ\PointGPS` | 2025 |
| PointMarker | `ハイキングアプリ\PointMarker` | 2025 |
| rename-files | `ツール(PWA非対応)\rename-files` | 2026 |
| ResizeImage | `ツール(PWA非対応)\ResizeImage` | 2025 |
| esp32-1st-check | `電子工作\ESP32-C3\esp32-1st-check` | 2026 |
| esp32-splinkler | `電子工作\ESP32-C3\esp32-splinkler` | 2026 |
| gnss-scope | `電子工作\gnss-scope` | 2026 |
| **ClosureEditor** | **作業フォルダ無し**（`_過去の遺物倉庫\ClosureEditor` に zip のみ） | 2026 |

- MapGPS・ResizeImage・TabataTimer は `_過去の遺物倉庫` などにも古い作業フォルダがある。
  **上の表のフォルダ**（現在使っている方）で作業する。
- ClosureEditor は手元に無いため [5章](#5-作業フォルダが無いとき-github-の画面で追加する)の方法をとる。

---

## 3. 手順（手元でまとめて追加する）

リポジトリ1件ごとに ①〜⑥ を行う。①〜④ は作業フォルダの中で実行する。

**① 追加できる状態か確かめる**

```powershell
cd <作業フォルダ>
git status --short          # 何も出ないこと（手元だけの変更が無い）
git branch --show-current   # main であること
git fetch origin; git status -sb   # ahead/behind が付かないこと
```

- 手元だけの変更があるときは、先にそれをコミットするか、④ で `LICENSE` だけを add する。
- behind のときは先に `git pull` する。

**② `LICENSE` を置く**

minoh-hiking の LICENSE をひな形にする（MIT の定型文。書き換えるのは**年と著作者名の1行だけ**）。

```powershell
copy "C:\Users\showa\Documents\ハイキングアプリ\minoh-hiking\LICENSE" .\LICENSE
```

置いた後、3行目を確認する。

```
Copyright (c) <年> sato4app
```

- 年は、そのリポジトリを**作った年**（[2章](#2-前提)の表）にそろえる。
- 著作者名は `sato4app`（minoh-hiking と同じ表記）。

**③ 対象外にするものがあれば、README に「ライセンス」の節を足す**

自分が作ったものだけで構成されているリポジトリでは不要。対象外がある場合（→ [7章](#7-リポジトリ別のメモ対象外の候補)）は、
README の末尾に次の形で書く。minoh-hiking の README と同じ書き方。

```markdown
### ライセンス

  ソースコードは [MIT License](LICENSE) で公開している（Copyright (c) <年> sato4app）。

  ただし、**次のものは MIT License の対象外**とする。

  | 場所 | 内容 | 扱い |
  |------|------|------|
  | `<パス>` | <何か> | <理由。例: 配布元の利用条件に従う> |
```

**④ コミットする**

`LICENSE`（と ③ の README）**だけ**をコミットする。ほかの変更を巻き込まない。

```powershell
git add LICENSE README.md
git commit -m "MIT License を追加"
```

**⑤ push する**

```powershell
git push origin main
```

**⑥ 表示を確かめる**

- リポジトリのページを開き、右側の「About」に **「MIT license」** と出ていること。
- まとめて確かめるときは、次のコマンドでも見られる。

```powershell
curl.exe -s "https://api.github.com/users/sato4app/repos?per_page=100" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>JSON.parse(s).forEach(r=>console.log((r.license?r.license.spdx_id:'(なし)').padEnd(8),r.name)))"
```

---

## 4. LICENSE 追加後に手元で必要なこと

GitHub の画面（[5章](#5-作業フォルダが無いとき-github-の画面で追加する)）で追加したときは、**次のコミットの前に `git pull`** を実行する。
GitHub 側にコミットが1つ増えているため、そのままでは push が断られる。

---

## 5. 作業フォルダが無いとき: GitHub の画面で追加する

1. リポジトリのページを開く
2. **「Add file」→「Create new file」**
3. ファイル名に `LICENSE` と入力する（右側に **「Choose a license template」** が出る）
4. **「MIT License」** を選び、**Year** と **Full name**（`sato4app`）を確認して **「Review and submit」**
5. 「Commit directly to the main branch」のまま **「Commit changes」**

---

## 6. これから作るリポジトリ

GitHub でリポジトリを新規作成する画面の **「Add license」** で **「MIT License」** を選ぶ。
最初から LICENSE 入りで作られるので、本書の手順は不要になる。

---

## 7. リポジトリ別のメモ（対象外の候補）

調査時点（2026-09-20）に見つかったもの。③ の README に書く候補。

| リポジトリ | 対象外の候補 | 理由 |
|---|---|---|
| gnss-scope | `data\minoh-emergency-points.geojson`・`data\minoh-hiking-routes-spots.geojson` | ハイキングマップのデータ（緊急ポイント・ルート）。自分の著作物ではない |
| gnss-scope | `vendor\leaflet\` | 外部ライブラリ Leaflet。**BSD-2 のライセンス文書が同梱されていない**ため、あわせて置く（→ [9章](#9-注意事項)） |
| GeoReferencer | `cli\sample\sample-map.png`・`cli\sample\pointGPS.xlsx` | ハイキングマップを元にしたサンプルなら対象外 |
| Portfolio | `projects\*\` のアイコン・サムネイル | 各アプリからのコピー。アイコンは公開の対象（→ [8章](#8-ai-で生成した画像アイコンの扱い)）。**コピー元のリポジトリの README と扱いをそろえる** |
| PointMarker / MapGPS | `icons\mbrisetting3_99522.svg` | 名前から、アイコン配布サイトのものと思われる（**要確認**） |
| PointGPS / MapGPS | `tutorial\audio\*.wav`（10件） | 作った人・作り方の**確認が必要**（読み上げサービスの利用条件など） |

- **アプリアイコン（各リポジトリの `icons\` など）は対象外にしない。** 公開の対象に含める
  （→ [8章](#8-ai-で生成した画像アイコンの扱い)）。
- DownloadArea・MapEditor・MapPublisher に入っている PDF は自分の文書のため、MIT のままでよい。
- rename-files・ResizeImage はコードだけで、対象外は無い。

---

## 8. AI で生成した画像（アイコン）の扱い

**方針: アプリアイコンなどの AI で生成した画像は、公開の対象に含める**（README で対象外にしない）。
必要があれば、リポジトリごとに個別に判断する。

ただし、**「自分の著作物として MIT で許諾する」とは書かない。** AI が生成した画像は、人の創作的な
関与が乏しいと著作権が認められないことがあり、扱いは国や作り方によって変わるためである。
LICENSE（MIT）は**ソースコードに対するもの**とし、画像については「AI で生成したもので、著作権を
主張しない」と README に添える。

### README への記載例

対象のリポジトリの README（③ の「ライセンス」の節）に、次の1行を足す。minoh-hiking の README が実例。
**製品名（サービス名）は書かず「生成AI」とする。** 作り直したときに記載を直さずに済み、この注記の目的
（著作権を主張しないこと）にはサービス名が要らないため。どのサービスで作ったかは、公開しない記録
（仕様書など）に残す。

```markdown
  ※ アプリアイコンは生成AI で作成したもので、著作権を主張していない。
```

英語で書く場合:

```markdown
  Note: The app icon was generated by AI and is not subject to copyright.
```

### 確かめること

- **生成に使ったサービスの利用条件**で、生成物を配布してよいことを確認する。
- **AI 生成ではない画像・素材は、この方針の対象外。** 配布サイトのアイコン、他の人が作った画像・
  データ・音声は、従来どおり[7章](#7-リポジトリ別のメモ対象外の候補)のとおり対象外として扱う。
- 画像の中に**他の著作物（地図・写真・ロゴなど）が含まれていないか**。含まれていれば、AI で
  生成したかどうかに関わらず、その部分の条件に従う。

---

## 9. 注意事項

- **自分のものでないものは MIT で許諾できない。** 他の人が作ったデータ・画像・音声、配布サイトの
  素材、同梱した外部ライブラリは対象外にする。**LICENSE を置く前に、リポジトリの中身を一度見る**
  （[7章](#7-リポジトリ別のメモ対象外の候補)が調査時点の一覧）。
- **AI で生成した画像は、公開の対象に含めるが「自分の著作物」としては書かない**
  （→ [8章](#8-ai-で生成した画像アイコンの扱い)）。
- **同梱した外部ライブラリは、そのライブラリのライセンス文書も一緒に置く。** 例えば Leaflet（BSD-2）は
  著作権表示とライセンス文の保持が条件で、gnss-scope には `leaflet.js` と `leaflet.css` しか入っていない。
  配布元から `LICENSE` を取得して `vendor\leaflet\LICENSE` として置く（→ [7章](#7-リポジトリ別のメモ対象外の候補)）。
- **LICENSE ファイルの本文には手を加えない。** GitHub は定型の MIT と照らし合わせて判定しているため、
  対象外の説明などを書き足すと「MIT license」と表示されず「Other」になることがある。
  **対象外は README に書く**（③ の形）。
- **一度公開したライセンスは、後から取り消せない。** MIT で公開した版は、その後に方針を変えても、
  受け取った人はその版を使い続けられる。**対象外にするものは、LICENSE を入れる前に決める。**
- **年は「作った年」を書く。** MIT の年は最初に公開した年を書くのが一般的。後から作業した年に
  そろえ直す必要は無い。
- **push で公開処理が走るリポジトリに注意。** minoh-hiking は `main` への push で GitHub Pages が
  再デプロイされる（本番の Vercel は `release` への push なので、LICENSE の追加では動かない）。
  ほかにも公開処理が付いているリポジトリでは、LICENSE の追加でも処理が走る。中身は変わらないため害は無い。
- **手元だけの変更があるフォルダでは、`LICENSE` だけを add する。** 調査時点では gnss-scope の
  `README.md` に未コミットの変更があった。README に「ライセンス」の節を足すときは、その変更を
  先にコミットしてから行う（混ざるため）。
- **非公開のリポジトリは急がない。** ライセンスが要るのは、他の人がコードを見られる公開リポジトリ。
  非公開のまま使うなら後からでよい。
- **`package.json` の `license` 欄は必須ではない。** npm に公開しないなら、書かなくても GitHub の
  表示には影響しない。書くなら `"license": "MIT"`。

### 未決事項（本書の作成時点）

| # | 決めること | 選択肢 |
|---|---|---|
| 1 | 年の表記 | 作った年にそろえる（本書の前提） / すべて 2026 |
| 2 | `mbrisetting3_99522.svg`・`tutorial\audio\*.wav` の出所 | 自作なら MIT に含める / 配布素材なら対象外 / AI 生成なら [8章](#8-ai-で生成した画像アイコンの扱い) |
| 3 | ClosureEditor | GitHub の画面で追加（5章） / 手元に複製して追加 / 使わないならリポジトリを Archive |

> **アプリアイコンの扱い**（旧 #2）は、AI 生成画像について生成元に確認した回答をもとに
> 「公開の対象に含める」と決めた（2026-09-20。→ [8章](#8-ai-で生成した画像アイコンの扱い)）。
