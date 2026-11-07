#!/bin/sh
# Installs or removes the review mod's Claude Code hooks in ~/.claude/settings.json.
# Run it where Claude Code runs: macOS, Linux, or WSL (install.ps1 calls it for WSL).
#   sh install.sh install     add the hooks (existing hooks are kept; a backup is written)
#   sh install.sh uninstall   remove only the hooks this script added
# Needs python3 to edit the JSON safely. The hook itself is plain sh.
set -eu
action="${1:-install}"
here="$(cd "$(dirname "$0")" && pwd)"
hook="$(cd "$here/.." && pwd)/hooks/review-hook.sh"
settings="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
data="${HERDR_REVIEW_DIR:-$HOME/.config/herdr-app/data/review}"

command -v python3 >/dev/null 2>&1 || { echo "python3 is required to edit $settings" >&2; exit 1; }
[ "$action" = install ] && mkdir -p "$data"
mkdir -p "$(dirname "$settings")"
[ -f "$settings" ] && cp "$settings" "$settings.bak-herdr-review"

ACTION="$action" HOOK="$hook" SETTINGS="$settings" python3 - <<'PY'
import json, os
action, hook, path = os.environ["ACTION"], os.environ["HOOK"], os.environ["SETTINGS"]
MARK = "herdr-review-hook"  # every command this script adds contains it
try:
    with open(path, encoding="utf-8") as f:
        settings = json.load(f)
except FileNotFoundError:
    settings = {}
hooks = settings.setdefault("hooks", {})
# Remove ours first, so install is idempotent and uninstall leaves everything else.
for event in list(hooks):
    groups = []
    for g in hooks[event]:
        g = dict(g, hooks=[h for h in g.get("hooks", []) if MARK not in h.get("command", "")])
        if g["hooks"]:
            groups.append(g)
    if groups:
        hooks[event] = groups
    else:
        del hooks[event]
if action == "install":
    cmd = lambda arg: {"type": "command", "command": f"sh '{hook}' {arg} # {MARK}", "timeout": 10}
    hooks.setdefault("PostToolUse", []).append({"matcher": "Edit|Write|MultiEdit|NotebookEdit", "hooks": [cmd("post")]})
    hooks.setdefault("UserPromptSubmit", []).append({"hooks": [cmd("prompt")]})
if not hooks:
    settings.pop("hooks", None)
with open(path + ".tmp", "w", encoding="utf-8") as f:
    json.dump(settings, f, indent=2)
    f.write("\n")
os.replace(path + ".tmp", path)
print(f"{action}ed review hooks in {path}")
PY
