#!/bin/sh
# Checks every share's page and writes the list of shares into the root README.
#
#   ./check.sh
#
# A share is a top-level folder with mods/. Its README.md is the page a visitor reads.
# The rules are in docs/agents/shares.md. Exits 1 when a share breaks one.
set -eu

repo=$(cd "$(dirname "$0")" && pwd)
cd "$repo"

max_lines=75
max_summary=160
fails=0
entries=""
open_fence='```text'
close_fence='```'

fail() { echo "FAIL  $1: $2" >&2; fails=$((fails + 1)); }
note() { echo "todo  $1: $2"; }

for dir in */; do
  share=${dir%/}
  [ -d "$share/mods" ] || continue
  page="$share/README.md"
  if [ ! -f "$page" ]; then fail "$share" "no README.md"; continue; fi

  title=$(sed -n '1s/^# //p' "$page")
  [ -n "$title" ] || fail "$share" "line 1 is not '# Name'"

  # The summary is the first line of text after the title.
  summary=$(awk 'NR > 1 && NF { print; exit }' "$page")
  case "$summary" in
    '#'*|'!'*|'') fail "$share" "no one-sentence summary under the title" ;;
  esac
  [ ${#summary} -le $max_summary ] || fail "$share" "summary is ${#summary} characters, over $max_summary"

  grep -q '^!\[.*\](preview\.png)$' "$page" || fail "$share" "no ![Name](preview.png) line"

  heads=$(grep '^## ' "$page" | sed 's/^## //' | tr '\n' ',')
  [ "$heads" = "Features,Needs,Install,Use," ] || fail "$share" "sections are '$heads', want 'Features,Needs,Install,Use,'"

  bullets=$(awk '/^## /{ on = ($0 == "## Features") } on && /^- /{ n++ } END { print n + 0 }' "$page")
  named=$(awk '/^## /{ on = ($0 == "## Features") } on && /^- \*\*[^*]+\.\*\* /{ n++ } END { print n + 0 }' "$page")
  { [ "$bullets" -ge 3 ] && [ "$bullets" -le 12 ]; } || fail "$share" "Features has $bullets bullets, want 3 to 12"
  [ "$bullets" -eq "$named" ] || fail "$share" "every feature starts '- **Name.** '"

  lines=$(wc -l < "$page")
  [ "$lines" -le $max_lines ] || fail "$share" "$lines lines, over $max_lines"

  for mod in "$share"/mods/*/; do
    [ -f "${mod}mod.json" ] || fail "$share" "${mod}mod.json is missing"
    [ -f "${mod}README.md" ] || fail "$share" "${mod}README.md is missing"
  done

  if [ -f "$share/preview.png" ]; then
    shot="[<img src=\"$share/preview.png\" width=\"720\" alt=\"$title\">]($share/)"
  else
    fail "$share" "no preview.png"
    shot=""
  fi
  [ -f "$share/RECIPE.md" ] || note "$share" "no RECIPE.md, so not ready for herdr.dev/mods"

  install="Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/jbped/herdr-mods/tree/main/$share"
  entries="$entries### [$title]($share/)

$shot

$summary

$open_fence
$install
$close_fence

---
"
done

# Replace what is between the two markers in the root README.
start='<!-- shares:start -->'
end='<!-- shares:end -->'
if grep -qF "$start" README.md && grep -qF "$end" README.md; then
  tmp=$(mktemp)
  printf '%s' "$entries" > "$tmp.entries"
  awk -v start="$start" -v end="$end" -v entries="$tmp.entries" '
    $0 == start { print; print ""; print "## Mods"; print ""; while ((getline line < entries) > 0) print line; skip = 1; next }
    $0 == end { skip = 0 }
    !skip { print }
  ' README.md > "$tmp"
  if ! cmp -s "$tmp" README.md; then cat "$tmp" > README.md; echo "wrote README.md"; fi
  rm -f "$tmp" "$tmp.entries"
else
  fail "README.md" "the '$start' and '$end' lines are missing"
fi

[ "$fails" -eq 0 ] || { echo "$fails failed" >&2; exit 1; }
echo "ok"
