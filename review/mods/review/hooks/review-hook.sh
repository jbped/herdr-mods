#!/bin/sh
# Claude Code hook for the Herdr review mod. Installed by install.sh; does nothing
# outside a Herdr terminal or when the mod's data folder is missing.
#
#   post   (PostToolUse on Edit|Write|MultiEdit|NotebookEdit): saves the hook input as
#          one event file for the mod: {"terminal": "<HC_TERMINAL_ID>", "event": <input>}.
#   prompt (UserPromptSubmit): reads nothing new.
#
# Both pass pending review feedback for this terminal (rejected hunks) to Claude as
# additionalContext. The mod writes it as a ready JSON string in feedback/<terminal>.ctx.
# POSIX sh only: no jq, Python or Node.
event="${1:-}"
dir="${HERDR_REVIEW_DIR:-$HOME/.config/herdr-app/data/review}"
if [ -z "${HC_TERMINAL_ID:-}" ] || [ ! -d "$dir" ]; then cat >/dev/null; exit 0; fi

if [ "$event" = post ]; then
  mkdir -p "$dir/events"
  # The mod applies events in name order, and the first edit of a file sets its baseline,
  # so names start with a nanosecond timestamp (GNU date; macOS date falls back to seconds).
  ts="$(date +%s%N)"; case "$ts" in *N) ts="$(date +%s)000000000" ;; esac
  f="$dir/events/$ts-$HC_TERMINAL_ID-$$"
  # JSON has no raw newlines inside strings, so dropping them keeps it valid on one line.
  { printf '{"terminal":"%s","event":' "$HC_TERMINAL_ID"; tr -d '\r\n'; printf '}\n'; } >"$f.tmp" \
    && mv "$f.tmp" "$f.json"
else
  cat >/dev/null
fi

fb="$dir/feedback/$HC_TERMINAL_ID.ctx"
if [ -f "$fb" ] && mv "$fb" "$fb.$$" 2>/dev/null; then
  name=PostToolUse; [ "$event" = prompt ] && name=UserPromptSubmit
  printf '{"hookSpecificOutput":{"hookEventName":"%s","additionalContext":%s}}\n' "$name" "$(cat "$fb.$$")"
  rm -f "$fb.$$"
fi
exit 0
