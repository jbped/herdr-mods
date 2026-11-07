# Installs or removes the review mod's Windows setup.
#   powershell -ExecutionPolicy Bypass -File install.ps1 [install|uninstall]
#
# install:
#   - HERDR_REVIEW_DIR (user) = %USERPROFILE%\.config\herdr-app\data\review, created if missing.
#     The Claude hook writes edit events there.
#   - WSLENV (user) gains HC_TERMINAL_ID and HERDR_REVIEW_DIR/p, keeping any entries already
#     there, so a hook running in WSL knows its Herdr terminal and sees the folder as /mnt/c/...
#   - Runs install.sh inside WSL (when WSL is present) to add the Claude Code hooks there.
# uninstall reverses each step and removes only what install added.
# New values reach terminals started after Herdr restarts.
param([ValidateSet("install", "uninstall")][string]$Action = "install")
$ErrorActionPreference = "Stop"
$ours = @("HC_TERMINAL_ID", "HERDR_REVIEW_DIR/p")

$current = [Environment]::GetEnvironmentVariable("WSLENV", "User")
if (-not $current) { $current = "" }
$entries = @($current -split ":" | Where-Object { $_ })
$kept = @($entries | Where-Object { $ours -notcontains $_ })
if ($Action -eq "install") {
  $dir = Join-Path $env:USERPROFILE ".config\herdr-app\data\review"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  [Environment]::SetEnvironmentVariable("HERDR_REVIEW_DIR", $dir, "User")
  [Environment]::SetEnvironmentVariable("WSLENV", (($kept + $ours) -join ":"), "User")
} else {
  [Environment]::SetEnvironmentVariable("HERDR_REVIEW_DIR", $null, "User")
  [Environment]::SetEnvironmentVariable("WSLENV", $(if ($kept.Count) { $kept -join ":" } else { $null }), "User")
}
Write-Host "$($Action)ed Windows environment: WSLENV=$([Environment]::GetEnvironmentVariable('WSLENV', 'User'))"

if (Get-Command wsl.exe -ErrorAction SilentlyContinue) {
  $sh = (wsl.exe -e wslpath -a ((Join-Path $PSScriptRoot "install.sh") -replace "\\", "/")).Trim()
  $env:WSLENV = "HERDR_REVIEW_DIR/p"
  $env:HERDR_REVIEW_DIR = Join-Path $env:USERPROFILE ".config\herdr-app\data\review"
  wsl.exe -e sh $sh $Action
}
