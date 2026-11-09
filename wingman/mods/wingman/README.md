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

Wingman finds a space's repos from the folders its agents started in and from the files the Claude hook sees them edit. When it finds none, for example for a WSL agent started from a Windows folder, click **Open folder…** and pick a folder in the repo. The Edit view's file tree has the same button for adding more repos. Added repos are remembered for the space, and capture covers them too.

| Action | Key |
|---|---|
| Accept / reject the selected lines, else the current change | `ctrl-y` / `ctrl-n` (a change's own buttons always act on the whole change) |
| Accept / reject file | `ctrl-shift-enter` / `ctrl-shift-backspace` |
| Next / previous change | `ctrl-down` / `ctrl-up` |
| Next / previous file | `ctrl-shift-down` / `ctrl-shift-up` |
| Undo last accept/reject | `ctrl-z` |
| Review / Edit view | `ctrl-shift-r` |
| File tree (Edit view) | `ctrl-b` |
| Select lines | click a line, or click and drag; Shift+click or `shift-up` / `shift-down` to extend; click inside the selection or `escape` to clear. |
| Menu for a line or change | right-click: Comment, Reject, Reject with comment, Accept (on the selected lines when there are any). Right-click never changes the selection. |
| Comment on the selected lines, else the current change | `ctrl-p` (or the change's Comment button) |
| Comment on the last rejection | `ctrl-r` (or the header's Comment last rejection) |

## Views

The header switches between two views (`ctrl-shift-r`):

- **Review**: the tabs are the files with changes to review.
- **Edit**: a file tree of the space's repos on the left (`ctrl-b` shows or hides it, and opens the Edit view from Review). It lists tracked and untracked files, without ignored ones, with each file's and folder's change count and a dot for unsaved edits. Click a file to open it in the same editor, with its diff when it has changes. The tabs are the changed files plus the files you opened. Opened files close with their ×, which saves them when autosave is on. Changed files stay until they're reviewed.

## Editing

The diff is also an editor. Click in the text to place the cursor and type. Your own edits to unchanged lines are kept as accepted, so they never show up for review. Edits inside the agent's added lines stay part of its pending change. Removed lines are read-only. `ctrl-s` saves, and a dot on the tab marks unsaved edits. With autosave on (the default), edits are saved when Wingman loses focus, when you switch files, spaces or views, and when you close a tab. If the agent writes to a file while you have unsaved edits, its changes are merged into yours. Where you both changed the same lines, the agent's lines win with autosave on. With autosave off, a banner offers Keep mine or Take agent's, and the rest of both edits is kept either way. A merge clears undo for that file. If the agent deletes the file, the banner offers Keep mine or Drop my edits.

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

## Neovim as the editor

Set **Editor** to **Neovim** in Settings to edit in Neovim instead of Wingman's own editor. Wingman stays the review: clicking a line of the diff, `ctrl-o`, the **Neovim** button, or a file in the tree opens that file at that line in a Neovim pane beside Wingman. Each space gets one Neovim, started with `--listen`, and later files open in the same one. Buffers reload when the agent writes to a file, unless they hold unsaved edits. Wingman picks up Neovim's saves within 2 seconds.

On Windows, Wingman uses `nvim.exe` when it's on PATH, otherwise WSL's `nvim`. Your own Neovim config applies, including its plugins for autopairs, tags and line moves. Herdr's global keys (for example `alt-up` / `alt-down`) still apply inside the Neovim pane unless `keys.json` sends them to the terminal.

## Settings

The header's **⚙ Settings** opens:

- **Auto note on rejections**: tell the agent which of its changes you rejected. On by default.
- **Note on my edits**: when you save, tell the agent that changed the file which lines you edited, so it reads the file again before its next change. On by default. The note is delivered with the agent's next tool call or prompt, and a newer save replaces a note it hasn't read yet.
- **Editor**: Wingman (the built-in editor, the default) or Neovim (see Neovim as the editor).
- **Autosave**: save when Wingman loses focus (another pane, or another window), and when you switch files or spaces. On by default. Herdr has no blur event for mods, so focus is checked 4 times a second.
- **Also save after typing stops for**: Focus change (no timer, save on focus change only), 1, 2, 3, 5 or 10 seconds. Focus change by default.

Settings are kept in `~/.config/herdr-app/data/wingman/settings.json`.

## Files it writes

| Where | What |
|---|---|
| `<git-dir>/wingman/` | `index.json`, `baselines/`, `capture.json`, `snap.index` (per repo) |
| `~/.config/herdr-app/data/wingman/` | `events/` (from the hook, removed once read), `feedback/` (notes for Claude), `outbox/` (comments waiting for an idle agent), `spaces.json`, `settings.json` |
| `~/.config/herdr-app/data/wingman-leader.json`, `wingman-capture.log` | which pane copy runs capture, and its log |
