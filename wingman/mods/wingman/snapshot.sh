#!/bin/sh
# Snapshots a repo's working tree as a git tree object without touching the real
# index, stash or branch: copies the index to a temp file, stages everything into
# the copy (so unchanged files are not re-hashed), and prints the tree id.
# Usage: snapshot.sh <git-dir> <work-tree>
set -e
store="$1/wingman"
mkdir -p "$store/baselines"
tmp="$store/snap.index"
if [ -f "$1/index" ]; then cp "$1/index" "$tmp"; else rm -f "$tmp"; fi
cd "$2"
GIT_INDEX_FILE="$tmp" git --no-optional-locks add -A
GIT_INDEX_FILE="$tmp" git write-tree
