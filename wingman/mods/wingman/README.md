# Wingman

A Herdr pane that shows the code changes coding agents make, Cursor-style: whole-file diffs with Accept and Reject on every change, per file, or for everything. Changes stay live on disk while you review. Accept keeps them. Reject restores the original lines. Ctrl+Z undoes either.

## How changes are found

- **Any agent.** When an agent in a space starts working, the mod snapshots the repo the agent started in (`snapshot.ps1` / `snapshot.sh`). Files that change while it works become reviewable. Your real git index, stash and branch are never touched.
- **Claude Code**, through its hooks (`hooks/wingman-hook.sh`). Every Edit/Write is reported with the file's exact content before the edit, so the review covers every repo Claude edits, not just the one it started in.

When you reject a change, the agent that made it gets a short factual note on its next tool call or prompt: what was rejected and that the original lines are back. This keeps its picture of the file right. Turn it off in **Settings**. **Comment last rejection** (`ctrl-r`) sends your own comment with it. **Comment** (`ctrl-p`) sends an instruction about a change or the selected lines, such as "refactor this into a helper". It's typed into the agent's terminal as your message, waiting until the agent isn't mid-turn.

Syntax highlighting (Prism 1.30, MIT, vendored in `prism.js` and `grammars.js`) covers JavaScript, TypeScript (`.ts .mts .cts .d.ts`), React (`.jsx .tsx`, and JSX in `.js`), Vue (`.vue`), Angular (`.ts` and `.html` templates with `{{ }}`), HTML, C#, JSON, Markdown, Dockerfiles, YAML (including `docker-compose.yml`) and `.env` files. CSS (`.css`) and SCSS (`.scss`) are covered too. In HTML and Vue files, `<script>` blocks use the grammar their `lang` names and `<style>` blocks use CSS or SCSS. Vue and Angular template syntax is recognized: `v-if`, `v-for`, `:prop`, `@event`, `#slot`, `[prop]`, `(event)`, `[(ngModel)]`, `*ngFor`, `#ref`, `@if`/`@for`/`@switch`/`@defer` blocks and `{{ }}`, with the expressions inside highlighted as JavaScript. Other files show as plain text.

Each repo's review lives in `<git-dir>/wingman/`. Git never tracks or pushes that folder. Files outside any git repo are not reviewed.

## Install

Copy this folder to `~/.config/herdr-app/mods/wingman/`, then run the installer once.

**Windows** (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\.config\herdr-app\mods\wingman\install\install.ps1" install
```

This makes three changes:

1. Sets the user variable `HERDR_WINGMAN_DIR` to `%USERPROFILE%\.config\herdr-app\data\wingman`, where the hook saves edit events.
2. Adds `HC_TERMINAL_ID:HERDR_WINGMAN_DIR/p` to the user variable `WSLENV`, keeping existing entries. This lets a Claude running in WSL tell which Herdr terminal it is in, and see the folder as `/mnt/c/...`.
3. Runs `install.sh` inside WSL, which adds the hooks to WSL's `~/.claude/settings.json`.

Restart Herdr afterwards. Terminals started before the restart don't get the new variables.

**macOS / Linux**:

```sh
sh ~/.config/herdr-app/mods/wingman/install/install.sh install
```

This adds the hooks to `~/.claude/settings.json` and creates `~/.config/herdr-app/data/wingman`. No environment setup is needed.

The installer keeps your other hooks and writes `settings.json.bak-herdr-wingman` first. Running it again changes nothing. It needs `python3` to edit the JSON. The hook itself is plain `sh`.

## Uninstall

Run the same installer with `uninstall`. It removes only what install added: its hook entries, `HERDR_WINGMAN_DIR`, and its two `WSLENV` entries. Then delete this folder. To clear review data, delete `~/.config/herdr-app/data/wingman*` and any repo's `.git/wingman/`.

## Use

Open a Wingman pane beside an agent: run `pane.split` with `{"direction": "right", "mod": "wingman"}`, for example from the palette or a key in `keys.json`. Each pane shows the review for the space it's in.

| Action | Key |
|---|---|
| Accept / reject the selected lines, else the current change | `ctrl-y` / `ctrl-n` (a change's own buttons always act on the whole change) |
| Accept / reject file | `ctrl-shift-enter` / `ctrl-shift-backspace` |
| Next / previous change | `ctrl-down` / `ctrl-up` |
| Next / previous file | `ctrl-shift-down` / `ctrl-shift-up` |
| Undo last accept/reject | `ctrl-z` |
| Select lines | click a line, or click and drag; Shift+click or `shift-up` / `shift-down` to extend; click inside the selection or `escape` to clear. |
| Menu for a line or change | right-click: Comment, Reject, Reject with comment, Accept (on the selected lines when there are any). Right-click never changes the selection. |
| Comment on the selected lines, else the current change | `ctrl-p` (or the change's Comment button) |
| Comment on the last rejection | `ctrl-r` (or the header's Comment last rejection) |

## Editing

The diff is also an editor. Click in the text to place the cursor and type. Your own edits to unchanged lines are kept as accepted, so they never show up for review. Edits inside the agent's added lines stay part of its pending change. Removed lines are read-only. `ctrl-s` saves, and a dot on the tab marks unsaved edits. With autosave on (the default), edits are saved when Wingman loses focus and when you switch files or spaces. If the file changes on disk while you have unsaved edits, a banner offers Reload (drop your edits) or Overwrite.

| Action | Key |
|---|---|
| Move | arrows, `ctrl-left` / `ctrl-right` by word, `home` / `end`, `pageup` / `pagedown`, `ctrl-home` / `ctrl-end` |
| Select text | Shift with any move, drag, double-click a word, triple-click a line, `ctrl-a` |
| Edit | type, `backspace` / `delete` (with `ctrl` by word), `enter` keeps the indent, `tab` / `shift-tab` indent and outdent |
| Copy, cut, paste | `ctrl-c` / `ctrl-x` / `ctrl-v` (without a selection: the whole line) |
| Save | `ctrl-s` |
| Undo / redo | `ctrl-z` / `ctrl-shift-y` (one history with accept and reject; redo is for edits) |
| Scroll sideways | Shift+wheel |

Comment, Accept and Reject act on the lines a text selection covers. Clicking the line numbers still selects whole lines. Not supported: input methods that compose characters (Chinese, Japanese, Korean), and wide characters or emoji, which put the cursor in the wrong column.

## Settings

The header's **⚙ Settings** opens:

- **Auto note on rejections**: tell the agent which of its changes you rejected. On by default.
- **Autosave**: save when Wingman loses focus (another pane, or another window), and when you switch files or spaces. On by default. Herdr has no blur event for mods, so focus is checked 4 times a second.
- **Also save after typing stops for**: Off, 1, 2, 3, 5 or 10 seconds. Off by default.

Settings are kept in `~/.config/herdr-app/data/wingman/settings.json`.

## Files it writes

| Where | What |
|---|---|
| `<git-dir>/wingman/` | `index.json`, `baselines/`, `capture.json`, `snap.index` (per repo) |
| `~/.config/herdr-app/data/wingman/` | `events/` (from the hook, removed once read), `feedback/` (notes for Claude), `outbox/` (comments waiting for an idle agent), `spaces.json`, `settings.json` |
| `~/.config/herdr-app/data/wingman-leader.json`, `wingman-capture.log` | which pane copy runs capture, and its log |
