# Snapshots a repo's working tree as a git tree object without touching the real
# index, stash or branch: copies the index to a temp file, stages everything into
# the copy (so unchanged files are not re-hashed), and prints the tree id.
# Usage: snapshot.ps1 <git-dir> <work-tree>
param([string]$GitDir, [string]$WorkTree)
$ErrorActionPreference = "Stop"
$store = Join-Path $GitDir "claude-review"
New-Item -ItemType Directory -Force -Path (Join-Path $store "baselines") | Out-Null
$tmp = Join-Path $store "snap.index"
$real = Join-Path $GitDir "index"
if (Test-Path $real) { Copy-Item -Force $real $tmp } elseif (Test-Path $tmp) { Remove-Item -Force $tmp }
$env:GIT_INDEX_FILE = $tmp
Set-Location $WorkTree
git --no-optional-locks add -A
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
git write-tree
exit $LASTEXITCODE
