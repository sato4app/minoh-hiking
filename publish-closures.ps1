# ============================================================
# 通行止め・通行困難地点の公開スクリプト(1コマンド公開)
#
# アプリの「マップに反映」でダウンロードした minoh-hiking-closure.geojson を
# Downloads から取り込み、main と release へコミット+プッシュする。
# プッシュ後は GitHub Pages(main) / Vercel(release) が自動デプロイする。
#
# 実行方法: publish-closures.bat をダブルクリック(本スクリプトを起動する)
#
# 文字コード: UTF-8(BOM付き)で保存すること(Windows PowerShell 5.1 の要件)
#
# テスト用の環境変数:
#   CLOSURES_DL_DIR  … Downloads の代わりに使うフォルダ
#   CLOSURES_NO_PAUSE… 定義すると最後の Enter 待ちを省略
# ============================================================

Set-Location -LiteralPath $PSScriptRoot

$dlDir = if ($env:CLOSURES_DL_DIR) { $env:CLOSURES_DL_DIR } else { Join-Path $env:USERPROFILE 'Downloads' }
$target = 'public\data\minoh-hiking-closure.geojson'
$targetGit = 'public/data/minoh-hiking-closure.geojson'

function Finish($code) {
  if (-not $env:CLOSURES_NO_PAUSE) { [void](Read-Host '続行するには Enter を押してください') }
  exit $code
}

function Fail($msg) {
  Write-Host ''
  Write-Host $msg
  Write-Host '処理を中断しました。'
  Finish 1
}

# --- git リポジトリ・ブランチの確認 ---
git rev-parse --is-inside-work-tree *> $null
if ($LASTEXITCODE -ne 0) { Fail "[エラー] ここは git リポジトリではありません: $PWD" }

$branch = git branch --show-current
if ($branch -ne 'main') {
  Fail "[エラー] 現在のブランチが main ではありません: $branch`n         main に切り替えてから再実行してください。"
}

# --- origin/main に追従(fast-forward のみ) ---
Write-Host 'origin/main を取得しています...'
git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { Fail '[エラー] git pull に失敗しました。リポジトリの状態を確認してください。' }

# --- Downloads から最新の geojson を取得(ブラウザの「(1)」リネームにも対応) ---
$src = Get-ChildItem -LiteralPath $dlDir -Filter 'minoh-hiking-closure*.geojson' -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $src) {
  Fail "[エラー] $dlDir に minoh-hiking-closure*.geojson が見つかりません。`n         アプリの「マップに反映」でファイルをダウンロードしてから実行してください。"
}
Write-Host "取り込むファイル: $($src.FullName)"

try {
  Copy-Item -LiteralPath $src.FullName -Destination $target -Force -ErrorAction Stop
} catch {
  Fail "[エラー] $target へのコピーに失敗しました: $($_.Exception.Message)"
}

# --- 変更確認(このファイルのみ対象。他の作業中ファイルは巻き込まない) ---
git diff --quiet HEAD -- $targetGit
if ($LASTEXITCODE -eq 0) {
  Write-Host '変更がありません(すでに公開済みの内容です)。'
  Remove-Item -LiteralPath $src.FullName -Force -ErrorAction SilentlyContinue
  Finish 0
}

# --- コミット(パス指定コミット: 他のステージ済み変更は含めない) ---
git commit -m 'data: 通行止め・通行困難地点を更新' -- $targetGit
if ($LASTEXITCODE -ne 0) { Fail '[エラー] コミットに失敗しました。' }

# --- プッシュ(main → release の順) ---
Write-Host 'main へプッシュしています...'
git push origin main
if ($LASTEXITCODE -ne 0) { Fail '[エラー] main へのプッシュに失敗しました。ネットワーク・認証を確認してください。' }

Write-Host 'release へプッシュしています...'
git push origin main:release
if ($LASTEXITCODE -ne 0) {
  Fail "[エラー] release へのプッシュに失敗しました(main へは反映済みです)。`n         解消後に「git push origin main:release」を実行するか、本スクリプトを再実行してください。"
}

Remove-Item -LiteralPath $src.FullName -Force -ErrorAction SilentlyContinue
Write-Host ''
Write-Host '[完了] 公開しました。GitHub Pages / Vercel のデプロイが自動で始まります。'
Finish 0
