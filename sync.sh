#!/bin/sh
# Copies mods and layouts from the Herdr config folder into this repo.
# Edit mods in the config folder, where Herdr hot-reloads them, then run this before committing.
#
#   ./sync.sh              sync every share folder
#   ./sync.sh skillshare-wsl   sync one share folder
#
# Only what a share folder already has is synced: each mods/<name>/ and each layouts/<file>.
# To add a mod to a share, create <share>/mods/<name>/ first.
# HERDR_HOME overrides where the config folder is.
set -eu

repo=$(cd "$(dirname "$0")" && pwd)

if [ -z "${HERDR_HOME:-}" ]; then
  HERDR_HOME="$HOME/.config/herdr-app"
  # On WSL with Herdr on Windows, the config folder is in the Windows profile.
  if [ ! -d "$HERDR_HOME/mods" ] && command -v cmd.exe >/dev/null 2>&1; then
    win=$(cd /mnt/c 2>/dev/null && cmd.exe /c 'echo %USERPROFILE%' 2>/dev/null | tr -d '\r')
    [ -n "$win" ] && HERDR_HOME="$(wslpath "$win")/.config/herdr-app"
  fi
fi
[ -d "$HERDR_HOME/mods" ] || { echo "No Herdr config folder at $HERDR_HOME (set HERDR_HOME)" >&2; exit 1; }

if [ $# -gt 0 ]; then shares="$*"; else
  shares=$(cd "$repo" && for d in */; do [ -d "$d/mods" ] || [ -d "$d/layouts" ] && printf '%s\n' "${d%/}"; done)
fi

for share in $shares; do
  [ -d "$repo/$share" ] || { echo "No share folder: $share" >&2; exit 1; }
  for dir in "$repo/$share"/mods/*/; do
    [ -d "$dir" ] || continue
    name=$(basename "$dir")
    if [ -d "$HERDR_HOME/mods/$name" ]; then
      rsync -a --delete --exclude gpui-kit.d.ts --exclude jsconfig.json "$HERDR_HOME/mods/$name/" "$dir"
      echo "mod     $share/mods/$name"
    else
      echo "missing $HERDR_HOME/mods/$name" >&2
    fi
  done
  for file in "$repo/$share"/layouts/*; do
    [ -f "$file" ] || continue
    name=$(basename "$file")
    if [ -f "$HERDR_HOME/layouts/$name" ]; then
      cp "$HERDR_HOME/layouts/$name" "$file"
      echo "layout  $share/layouts/$name"
    else
      echo "missing $HERDR_HOME/layouts/$name" >&2
    fi
  done
done

git -C "$repo" status --short
