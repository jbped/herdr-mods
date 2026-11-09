# Wingman

A Herdr pane that shows the code changes coding agents make, Cursor-style: whole-file diffs with Accept and Reject on every change, per file, or for everything. Changes stay live on disk while you review. Accept keeps them. Reject restores the original lines. Ctrl+Z undoes either.

## How changes are found

- **Any agent.** When an agent in a space starts working, the mod snapshots the repo the agent started in (`snapshot.ps1` / `snapshot.sh`). Files that change while it works become reviewable. Your real git index, stash and branch are never touched.
- **Claude Code**, through its hooks (`hooks/wingman-hook.sh`). Every Edit/Write is reported with the file's exact content before the edit, so the review covers every repo Claude edits, not just the one it started in.

When you reject a change, the agent that made it gets a short factual note on its next tool call or prompt: what was rejected and that the original lines are back. This keeps its picture of the file right. Turn it off in **Settings**. **Comment last rejection** (`ctrl-r`) sends your own comment with it. **Comment** (`ctrl-m`) sends an instruction about a change or the selected lines, such as "refactor this into a helper". It's typed into the agent's terminal as your message, waiting until the agent isn't mid-turn.

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

Or put Wingman in the side panel beside Files and Changes, as two panel tabs, Review and Edit. In a layout of your own (a clone, since Herdr's shipped layouts are read-only), add two blocks to the `panel-body` stack: `{"id": "wingman-review", "type": "block", "content": {"mod": "wingman", "props": {"view": "review"}}}` and the same with `wingman-edit` and `"view": "edit"`. Raise the `panel` column's `max` (for example to 2400), and point the `tabs` block at a clone of the `tabs` mod that draws a button per Wingman block. The `tabs-plus` clone does that. It also takes the commands `tabs-plus.wingmanReview` and `tabs-plus.wingmanEdit`, which the palette entries **Wingman: Review** and **Wingman: Edit** run to select the tab and show the panel. It keeps a width per panel tab: Review and Edit open at 960px the first time and then at whatever width you drag them to.

Each block is its own copy of Wingman, fixed to its view:
- Review is read-only. Accept and Reject still write to disk. `ctrl-shift-r`, a double-click on a line, and Quick Open of an unchanged file all switch to the Edit tab at that file and line. Switching from Edit goes back to Review at the change nearest the cursor.
- Edit holds any unsaved edits. Before Review accepts or rejects in a file that has unsaved edits in Edit, those edits are saved (autosave on: try again a moment later), or, with autosave off, you're asked to save or discard them in Edit first.

Wingman finds a space's repos from the folders its agents started in and from the files the Claude hook sees them edit. When it finds none, for example for a WSL agent started from a Windows folder, click **Open folder…** and pick a folder in the repo. The Edit view's file tree has the same button for adding more repos. Added repos are remembered for the space, and capture covers them too.

| Action | Key |
|---|---|
| Accept / reject the selected lines, else the current change | `ctrl-y` / `ctrl-n` (a change's own buttons always act on the whole change) |
| Accept / reject file | `ctrl-shift-enter` / `ctrl-shift-backspace` |
| Next / previous change | `ctrl-down` / `ctrl-up` |
| Next / previous file | `ctrl-shift-down` / `ctrl-shift-up` |
| Undo last accept/reject | `ctrl-z` |
| Review / Edit view | `ctrl-shift-r` |
| Open the file in your external editor | `ctrl-e` (or the editor's button at the far right), at the cursor or the current change; unsaved edits are saved first. Pick the editor in Settings. |
| File tree (Edit view) | `ctrl-b` |
| Select lines | click a line, or click and drag; Shift+click or `shift-up` / `shift-down` to extend; click inside the selection or `escape` to clear. |
| Menu for a line or change | right-click: Comment, Reject, Reject with comment, Accept (on the selected lines when there are any). Right-click never changes the selection. |
| Comment on the selected lines, else the current change | `ctrl-m` (or the change's Comment button) |
| Quick Open | `ctrl-p`: find a file by name across the space's repos (fuzzy, as in VS Code). `name:12` or `name:12:5` opens it at that line; `:12` goes to a line in the current file. With no query it lists recent and changed files. Up and down choose, Tab fills in the chosen path (then add `:line`), Enter opens, Esc closes. |
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
| Brackets and quotes | typing `(` `[` `{` `"` `'` `` ` `` adds the closer (before whitespace, a line end or a closer; quotes not right after a letter). Typing the closer steps over it, Backspace in an empty pair removes both, Enter between brackets opens an indented line, and with text selected it wraps the selection. |
| Tags | in HTML, XML, SVG, Vue, Svelte, JSX and TSX files, typing `>` at the end of an opening tag adds its closing tag after the cursor (not for HTML void elements such as `<br>`, self-closing tags, or a generic like `Foo<T>`), and typing `/` right after `<` completes the innermost open tag. Enter between `<p>` and `</p>` opens an indented line. |
| Line wrap | `alt-z` or Settings → Wrap long lines (off by default). Long lines continue on the next screen row, broken after a space when there is one, with continuation rows indented like the line. Up and Down move by screen row; sideways scrolling is off while wrapped. |
| Move lines up / down | `alt-up` / `alt-down` (Herdr's agent keys by default, see below) |
| Copy lines up / down | `alt-shift-up` / `alt-shift-down` |
| Delete lines | `ctrl-shift-k` (Herdr's picker key by default, see below) |
| Join lines | `ctrl-j` (with the next line, or all selected lines) |
| Toggle comment | `ctrl-/` (line comments by file type; block comments for HTML, XML, Vue, Markdown and CSS) |
| Find | `ctrl-f` (a one-line selection becomes the query). Enter / Shift+Enter or `f3` / `shift-f3` for the next and previous match. `alt-c` case, `alt-w` whole word, `alt-r` regular expression. Esc closes. |
| Replace | `ctrl-h`. Enter replaces the current match and moves on; `ctrl-enter` in the replace box, `ctrl-alt-enter` or All replaces every match as one undo step. With regular expressions, `$1` and the like insert groups. |
| Go to line | `ctrl-g`, then a line or `line:column` |
| Save | `ctrl-s` |
| Undo / redo | `ctrl-z` / `ctrl-shift-y` (one history with accept and reject; redo is for edits) |
| Scroll sideways | Shift+wheel |

Line operations act on the cursor's line or every line a text selection covers, and each is one undo step. Herdr's global keys reach Herdr before Wingman, so `alt-up`, `alt-down` and `ctrl-shift-k` need a `mod:wingman` section in `keys.json` to send them to Wingman while it has focus:

```json
"mod:wingman": {
  "alt-up": "wingman.moveLineUp",
  "alt-down": "wingman.moveLineDown",
  "ctrl-shift-k": "wingman.deleteLine"
}
```

Every line operation is also a command for other keys: `wingman.moveLineUp`, `wingman.moveLineDown`, `wingman.copyLineUp`, `wingman.copyLineDown`, `wingman.deleteLine`, `wingman.joinLines` and `wingman.toggleComment`.

Comment, Accept and Reject act on the lines a text selection covers. Clicking the line numbers still selects whole lines. Not supported: input methods that compose characters (Chinese, Japanese, Korean), and wide characters or emoji, which put the cursor in the wrong column.

## Neovim as the editor

Set **Editor** to **Neovim** in Settings to edit in Neovim instead of Wingman's own editor. Wingman stays the review: clicking a line of the diff, `ctrl-o`, the **Neovim** button, or a file in the tree opens that file at that line in a Neovim pane beside Wingman. In the Edit view, Wingman then shows only the file tree, full width, and a click opens the file in Neovim at its first change. Each space gets one Neovim, started with `--listen`, and later files open in the same one. Buffers reload when the agent writes to a file, unless they hold unsaved edits. Wingman picks up Neovim's saves within 2 seconds.

On Windows, Wingman uses `nvim.exe` when it's on PATH, otherwise WSL's `nvim`. Your own Neovim config applies, including its plugins for autopairs, tags and line moves. Herdr's global keys (for example `alt-up` / `alt-down`) still apply inside the Neovim pane unless `keys.json` sends them to the terminal.

## Keyboard shortcuts

Every key in the tables above can be changed in **Settings → Keyboard shortcuts…**. Click **+ key** on an action and press the new shortcut. An action can have several keys, × removes one, and **Reset** puts an action back to its defaults (**Reset all** does every action). If the key belongs to another Wingman action, you're asked whether to move it. Plain typing keys and the keys for moving and deleting text (arrows, Home/End, Page Up/Down, Backspace, Delete, Enter, Tab) can't be rebound.

Herdr's global shortcuts reach Herdr before Wingman. When a Wingman key is one of them (by default `alt-up`, `alt-down` and `ctrl-shift-k`), Wingman adds it to the `mod:wingman` section of Herdr's `keys.json`. Herdr then sends it to Wingman while Wingman has focus, and the shortcuts page shows which Herdr action it hides there. Wingman only changes its own entries in that section (`wingman.<action>`).

Your changes are saved in `~/.config/herdr-app/data/wingman/keys.json` as `{ "<action>": ["key", ...] }`, holding only the actions you changed. Each action is also a command, `wingman.<action>` (for example `wingman.joinLines`), that you can bind anywhere in Herdr's `keys.json`.

## Settings

The header's **⚙ Settings** opens:

- **Auto note on rejections**: tell the agent which of its changes you rejected. On by default.
- **Note on my edits**: when you save, tell the agent that changed the file which lines you edited, so it reads the file again before its next change. On by default. The note is delivered with the agent's next tool call or prompt, and a newer save replaces a note it hasn't read yet.
- **Auto-close brackets and quotes**: the bracket and quote rules under Editing. On by default.
- **Auto-close tags**: the tag rules under Editing. On by default.
- **External editor**: VS Code (default), Cursor, Windsurf, Zed, Sublime Text, or a custom command with `{path}`, `{line}` and `{col}`. VS Code, Cursor and Windsurf open WSL files through Remote - WSL. On Windows a `.cmd` launcher runs through cmd.exe, which refuses paths containing `& | < > ^ % ! "`.
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
