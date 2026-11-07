# agents-plus

Herdr's Agents list, plus Claude Code's in-process subagents (the Agent tool) nested under the Claude session that started them. Herdr only knows about subagents started with `hc run`. Claude Code's own subagents run inside the parent process, so a Claude Code hook reports them to this mod.

- Each subagent shows as `<type> · <description>` under its parent, with a spinner while it works. A subagent waiting on its own background work shows an idle ring and `(waiting)`. The row goes away when the subagent finishes.
- Click a subagent row to open that subagent's view in its Claude Code session. Click the parent row to go back to `main`.

## Install

1. Copy `mods/agents-plus/` to `~/.config/herdr-app/mods/` and run `herdr-app check ~/.config/herdr-app/mods/agents-plus`.
2. In your layout, set the agents block's `content.mod` to `agents-plus`. Herdr's own layouts are read-only, so clone one first: `herdr-app do layout.clone '{"name":"main","as":"my-layout"}'`.
3. Add the hook to `~/.claude/settings.json` for the `PreToolUse` (matcher `Agent|Task`), `PostToolUse` (matcher `SubagentHandback`), `SubagentStart`, `SubagentStop`, `SessionStart` and `SessionEnd` events:

   ```json
   { "type": "command", "command": "python3 '<herdr-app>/mods/agents-plus/hooks/herdr-subagents.py' # herdr-agents-plus-hook", "timeout": 5 }
   ```

   `<herdr-app>` is the config folder as Claude sees it: `~/.config/herdr-app`, or `/mnt/c/Users/<you>/.config/herdr-app` when Herdr runs on Windows and Claude in WSL. Give `PreToolUse` and `PostToolUse` their own entries with those matchers.

Needs `python3` where Claude Code runs. The hook does nothing outside a Herdr terminal (no `HC_TERMINAL_ID`).

## How it works

- The hook writes one JSON file per running subagent to `<home>/.herdr-subagents/<terminal>__<agent_id>.json`, where `<home>` is the profile that holds Herdr's config. The hook works it out from its own path. Set `HERDR_SUBAGENTS_DIR` to override. The mod watches that folder, with a 5-second poll as a fallback.
- `PreToolUse` on the Agent tool saves the task description, which `SubagentStart` doesn't carry. `SubagentStart` claims it, oldest first, preferring the same subagent type.
- A subagent's final report (`SubagentHandback`, seen through `PostToolUse`) removes its row, even if a background task it started is still running. If it's resumed later, `SubagentStart` adds a new row.
- `SubagentStop` lists every running background task in the session. The stop counts as a pause only when one of those task IDs appears in the subagent's own transcript, meaning that subagent started it.
- A click focuses the parent pane and moves through Claude Code's footer agent list with `hc keys`, reading the screen with `hc read` after each batch of keys. It presses Enter only once the screen shows the target row selected (`❯`), and checks afterwards that the row is the one shown (`●`). It sends ↑ only while a list row is selected, so it never reaches prompt history.
- To debug the hook, create `<home>/.herdr-subagents/.debug`. Each hook payload is then added to `.log.jsonl` in that folder.

## Limits

- Clicking depends on how Claude Code draws its footer agent list. If a Claude Code update changes that, the click shows a warning toast and presses nothing that submits.
- Two subagents with the same type and description: the click opens the first one listed.
- If two subagents of the same type start at the same moment, each may show the other's description.

Modified from Herdr's `agents` mod (Apache-2.0, see `LICENSE` in this share). Changes: the Claude subagent rows, the click navigation, and the parent click that goes back to `main`.
