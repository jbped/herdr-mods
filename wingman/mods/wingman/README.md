# Wingman

A Herdr pane that shows the code changes coding agents make, Cursor-style: whole-file diffs with Accept and Reject on every change, per file, or for everything. Changes stay live on disk while you review. Accept keeps them. Reject restores the original lines. Ctrl+Z undoes either.

## How changes are found

- **Any agent.** When an agent in a space starts working, the mod snapshots every repo of the space's workspace at once (`snapshot.ps1` / `snapshot.sh`). Files that change while it works become reviewable, each with what was on disk before as its baseline (git's own line-ending rules give it back exactly). Your real git index, stash and branch are never touched. A text file over 1 MB isn't reviewed (Herdr doesn't read files that large): it's skipped and logged, and the other files are captured as usual.
- **Claude Code**, through its hooks (`hooks/wingman-hook.sh`). Every Edit/Write is reported with the file's exact content before the edit, so the review covers every repo Claude edits, not just the one it started in.

When you reject a change, the agent that made it gets a short factual note on its next tool call or prompt: what was rejected and that the original lines are back. This keeps its picture of the file right. Turn it off in **Settings**. **Comment last rejection** (`ctrl-r`) sends your own comment with it. **Ask** (`ctrl-m`) sends an instruction about a change or the selected lines, such as "refactor this into a helper". It's typed into the agent's terminal as your message, waiting until the agent isn't mid-turn. **Inline edit** (`ctrl-k`) doesn't go through the agent: a one-shot local command rewrites the selected lines, and the result shows as a change to review (see Inline edit).

**Review comments** collect notes to send as one prompt. Add one with a change's **Comment** button in Review, **+ Comment** or `alt-m` on the cursor's line or the selection in Edit, or the right-click menu (**Add review comment**, **Reject and add review comment…**, which rejects the change and quotes it). The header's **Comments N** (`alt-shift-m`) lists the space's comments: jump to one, edit, delete, **Clear all**, **Copy prompt**, and **Send to agent**, which types them into the agent's terminal as your message with `hc send` (paste and Enter) and clears the list; **Undo clear** puts the last sent or cleared batch back until you add a comment. Send goes to the agent that made the commented changes when they all name the same live one, else the space's only agent, else it asks which; a working agent asks first. Comments are kept per space in `data/wingman/comments/` and follow their code when the file changes; one whose lines can't be found again is marked "moved or changed". At most 50 comments per space and 2,000 characters per comment; control characters are dropped.

### Checkpoints

Each time an agent starts a turn, the snapshot capture takes of each repo is also kept as a **checkpoint**: what every file was just before the turn. The header's **Checkpoints N** in Review (command `wingman.checkpoints`) lists the space's turns, newest first: time, agent, how many files the turn changed and a title. The title is the first line of the prompt (at most 80 characters, control characters dropped) when the Claude hook saw it (`UserPromptSubmit`), else "no prompt seen". A turn over several repos is one row. Pick a row to see the files the turn changed; a click on one opens it in Review, or in Edit when it has nothing to review.

**Restore to before this turn** puts every file that changed since that checkpoint back to what the checkpoint has, in each repo of the turn: modified files are rewritten, files created since are deleted, files deleted since come back. That includes changes made after the turn, by any agent or by you. It asks first, naming the number of files and what is deleted or comes back. Each write is compare-and-swap, as Reject's: a file that changed after you confirmed isn't written and is named. Binary files, links, submodules and texts over 1 MB can't be restored and are named in the question. It is refused, with the reason, when:
- a file it would change has unsaved edits in Edit (any Wingman copy): save or discard them first,
- an agent is working in the repo (its turn is still being captured): restore once the turn ends,
- the repo is on another branch than the checkpoint: switch back to that branch first,
- the checkpoint's files are gone from git (its ref was deleted by hand).

A restore isn't a Ctrl+Z step. Before it writes, it keeps a checkpoint **Before restore to <time>** of the working tree as it was, listing the files the restore changes; restoring that one goes forward again. This was chosen over undo because a restore can touch any number of files of any size (undo keeps the newest 200 steps and about 24 MB of text per space, in memory, and is dropped when a write fails), while a checkpoint costs one git call, survives a reload, and works the same on another machine. Afterwards each Claude whose turns the restore undid gets a factual note, as for a rejection (off with **Auto note on rejections**). The dialog's commands, for keys and tests: `wingman.cpNext`, `wingman.cpPrev`, `wingman.cpOpen`, `wingman.cpRestore`, `wingman.cpConfirm`, `wingman.cpCancel`.

Each repo keeps the newest 30 checkpoints in `<git-dir>/wingman/checkpoints.json`. Each checkpoint's tree is named by a ref, `refs/wingman/checkpoints/<id>`, so `git gc` keeps it; the oldest go with their refs. These refs point at trees: they are not branches, tags or stash entries, `git log --all` leaves them out, and nothing else of yours (index, `HEAD`, branches, stash) is touched. A repo on another machine works the same, through the same calls there. To drop them all: `git for-each-ref --format='delete %(refname)' refs/wingman/checkpoints/ | git update-ref --stdin`, and delete `checkpoints.json`.

Syntax highlighting (Prism 1.30, MIT, vendored in `prism.js` and `grammars.js`) covers JavaScript, TypeScript (`.ts .mts .cts .d.ts`), React (`.jsx .tsx`, and JSX in `.js`), Vue (`.vue`), Angular (`.ts` and `.html` templates with `{{ }}`), HTML, C#, JSON, Markdown, Dockerfiles, YAML (including `docker-compose.yml`) and `.env` files. CSS (`.css`) and SCSS (`.scss`) are covered too. In HTML and Vue files, `<script>` blocks use the grammar their `lang` names and `<style>` blocks use CSS or SCSS. Vue and Angular template syntax is recognized: `v-if`, `v-for`, `:prop`, `@event`, `#slot`, `[prop]`, `(event)`, `[(ngModel)]`, `*ngFor`, `#ref`, `@if`/`@for`/`@switch`/`@defer` blocks and `{{ }}`, with the expressions inside highlighted as JavaScript. Also coloured: Bash and shell (`.sh .bash .zsh`, `.bashrc`-style names, and extension-less files whose first line is a `#!` shell line), PowerShell (`.ps1 .psm1 .psd1`), Python (`.py`, also a `#!` python line), SQL (`.sql`), Go (`.go`), Rust (`.rs`), TOML (`.toml`), C (`.c .h`), C++ (`.cpp .hpp .cc .cxx .hxx`), Java (`.java`), Lua (`.lua`), INI (`.ini .cfg .editorconfig .gitconfig`), diff and patch files (`.diff .patch`) and JSON with comments (`.jsonc`, `tsconfig*.json`, `jsconfig*.json`, `.code-workspace`). `ctrl-/` knows each one's comment marker. Code inside Markdown fences is not coloured. Other files show as plain text.

Review shows only what belongs to this space and branch:
- **Branch:** each change records the branch it was made on. Switching branches sets it aside, and it comes back when you switch back. A worktree has its own review anyway.
- **Space:** only changes made by the space's own agents show. A repo shared with another space doesn't bring that space's changes along.
- **Committed:** once a change is committed (the file on disk is what `HEAD` has, and `HEAD` has what the file had while it differed from `HEAD`: the agent's change and any edit after it), it leaves Review and shows in Changes under "Committed on this branch", marked AI. A change set aside meanwhile (`git stash` and a pull, `git checkout -- file`) stays in Review and is never marked as committed. Wingman looks every few seconds, so a file edited and committed from a terminal within that time can stay in Review (Commit in Changes looks first).

Changes recorded before Wingman kept branches take the branch the repo is on, and the space of the agent that made them while it's still open.

Each repo's review lives in `<git-dir>/wingman/`. Git never tracks or pushes that folder. Files outside any git repo are not reviewed.

### Workspaces: several repos in one space

A space reviews every repo in its workspace, which is made up of:
- the repo of every terminal's folder in the space (agents or not), and every repo Claude edited,
- the folders of a VS Code workspace file (`*.code-workspace`) in the space's folder. Wayfinder's Launch writes one into the Ticket folder, listing one worktree per repo,
- repos you add yourself.

A terminal's folder outside any git repo, or a workspace folder that isn't a repo, is a plain folder: the Edit tree lists it and its files open, edit and save, but nothing is reviewed or captured there, and Changes and Quick Open leave it out. Next to a repo, a plain folder starts collapsed. Its header has a ⟳ button that lists its open folders again. Its open folders are also relisted on their own, one folder at a time, at most every 30 seconds. A home folder is never searched for a repo, and is listed one level at a time like any plain folder.

Folders can nest: a terminal in a ticket folder that isn't a repo, with the space's worktrees inside it, or a worktree folder inside another repo, or terminals in a folder and in a subfolder of it. A file belongs to the innermost repo or folder of the space that holds it, a repo before a plain folder, and has one tab and one buffer however it's reached. In the outer folder's tree, an inner one shows as a link (`↗ name → root`): a click, Enter or Right goes to that root's own entry, and its files are never listed, opened, renamed or deleted through the outer folder. A file opened, created or moved into an inner root through the outer one opens as the inner root's file, and a repo's saves always go through its review. Renaming or deleting an inner root, or a folder holding one, from the outer tree is refused. Changes and Quick Open list a nested repo's files under that repo only.

With more than one repo or folder, the Edit tree shows each as a top-level entry, with its name (the file's `name`, else the folder), its open change count and a × to remove it. **+ Add repo…** under the tree (with Search in the left column, it switches to Explorer, where its panel shows) takes:
- a repo,
- a folder of repos, listing the repos inside it to tick,
- a main clone while the space's worktrees share a branch. Wingman offers to make a worktree for it beside them, on that branch (fetching first, then branching from the remote's default branch when the branch is new).

Removing asks first. A removed repo or folder stays out even while a terminal is still in it. Open changes come back when you add the repo again. For a worktree, you choose whether to delete it too (`git worktree remove`, which refuses while it has uncommitted or untracked files).

The workspace file uses VS Code's format: `{"folders": [{"path": "api"}, {"path": "../web", "name": "Web"}], "settings": {}}`. Paths are relative to the file or absolute, and comments are allowed. When a folder has several, Wingman reads the one named after the folder, else the first by name, and rereads it whenever it changes. When Wingman edits it, only `folders` changes, so every other key, comment and the order stay as they were. A space with one repo has no file. Adding a second repo makes one, in the space's folder, named after that folder. If the folder is inside a repo, or is the home folder, the file goes to `data/wingman/workspaces/<space>.code-workspace` with absolute paths instead. VS Code and Cursor can open either.

Nothing here changes Herdr's spaces or other mods: Herdr's Files and Changes panels still show only the space's folder.

### Which git runs

Linux and macOS use the machine's own `git`. On Windows, Wingman decides for each repo:
- **WSL's git** (through `wsl.exe`, with `/mnt/<drive>` paths) for repos WSL owns: repos inside WSL's own files (`\\wsl.localhost\<distro>\...`), worktrees WSL git added (their `.git` file points to a `/mnt` path, which Windows git can't open), and repos WSL git made (`core.filemode = true`, which Windows git never sets). Capture runs `snapshot.sh` there, the same as on Linux.
- **Git for Windows** for everything else, with file modes ignored, since Windows can't record executable files. If Git for Windows isn't installed, WSL's git is used.

WSL git on a Windows drive is slow (about 1.5 s per `git status` on a large repo), so Wingman's polls never overlap. Keeping WSL repos in WSL's own files avoids that.

### Other machines

A space on another machine (Herdr's `machine`, reached over ssh) works in every tab, with every git and file call running on that machine:

- **Edit**: the tree of the space's repos and plain folders (from its terminals' folders, as that machine names them), with git status letters and dimmed ignored files. Files open, edit and save as they do here: typing, line operations, Find and Replace, save and autosave, the merge of an agent's write into unsaved edits, and the conflict banner.
- **Review**: any agent's changes there are captured (a snapshot of each repo when it starts working, then new changes adopted at most every 5 s while it works and once after), with Accept, Reject and undo. The review store is `<git-dir>/wingman/` on that machine, as here. Claude's edits there are captured like any agent's, and, with the Claude hook installed there (see Install), reported by the hook as they are here: each edit's baseline is Claude's own `originalFile`, the review covers every repo Claude edits there, and rejection notes, edit notes and **Comment last rejection** reach that Claude.
- **Changes**: the uncommitted list with letters, line counts and AI marks, each file's diff, "Committed on this branch", **Commit**, **Discard file** and **Discard change**, the branch list and switching, **Generate** (the command runs there), and Fetch, Pull, Push and Publish (git runs there through `env`, with the same no-prompt settings). The diffs are computed here from texts read there.
- **Quick Open**, **Search** and **Replace All** over its repos' files.
- **Workspaces**: a `*.code-workspace` in the space's folder there is read and edited there, and made there when adding a repo makes two (unless that folder is inside a repo or is a home folder). Otherwise repos you add by hand (**+ Add repo…** takes a path on that machine) go to `data/wingman/workspaces/<space>.code-workspace` here, holding that machine's paths. Worktrees are made and deleted there as here.

Every save there is compare-and-swap: the content goes to a temp file beside the file (`.wingman-<id>.tmp`), the file's SHA-256 is checked against what Wingman last read, and the temp file is renamed over it, keeping its mode and following a link. A file that changed meanwhile isn't overwritten. A file that isn't plain UTF-8 text isn't saved there.

Without the Claude hook installed there, notes to Claude about rejections and your edits aren't sent, and **Comment last rejection** says so; **Comment** still types into the agent's terminal. Neovim and the external editor don't open files there. A Windows machine (one without `sh`) can be browsed but not saved to: it says "Saving on a Windows machine isn't supported yet".

Each call there takes about 150 to 200 ms, so an idle space is polled less often than a local one: its folders every 5 s (its workspace file at most every 30 s), Changes every 5 s (one `git status` and one `git hash-object` per repo), the tree every 10 s (two git calls per repo), and Review's index and the open files every 5 s (one call for all of them, which is how an outside change to an open file is noticed). Review's branch parking and committed changes are checked every 15 s, only while the space is shown or an agent there works. The Claude hook's events folder there is listed every 5 s (every 30 s while the hook isn't installed), only while a space there with a Wingman panel and an agent is shown or that agent works, and once after: one call, plus a few calls per event (reading it, the review store's writes, and one call removing the events read). A save is one call up to about 27 KB, and larger files go in pieces of that size, about 0.2 s each (a 200 KB file took 1.5 s), unless the machine takes 1 MB per call, which Wingman checks once. A call there that never answers fails with "… timed out" (a read after 20 s, anything else after its own limit plus 10 s), so saves queued behind it go on.

The machine needs `git`, `sh`, and `sha256sum` (or `shasum` or `openssl`). Only a Linux machine (WSL through Herdr) has been tried.

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

**Another machine** (a space on a Herdr machine reached over ssh, or a WSL machine of this PC): open a space there, then **⚙ Settings** › **Machine** › **Claude hook on <machine>** › **Install**. Nothing is needed on the machine but `sh`. It makes, on that machine:

1. The folder `~/.config/herdr-app/data/wingman/` (or `$HERDR_WINGMAN_DIR` when that's set there), with `events/` and `feedback/`. The hook does nothing on a machine without this folder.
2. `wingman-hook.sh` in that folder, a copy of this mod's hook. Claude runs it as `sh '<path>'`, so it needs no execute bit.
3. Two entries in `${CLAUDE_CONFIG_DIR:-~/.claude}/settings.json` there, the same ones `install.sh` adds here: a `PostToolUse` hook on `Edit|Write|MultiEdit|NotebookEdit` running `sh '<folder>/wingman-hook.sh' post # herdr-wingman-hook`, and a `UserPromptSubmit` hook running it with `prompt`, each with a 10 s timeout. Other keys and hooks are kept, `settings.json.bak-herdr-wingman` is written first, and a file that isn't valid JSON is left alone with an error. Wingman edits the JSON itself, so the machine needs no `python3`.
4. `wingman-install.json` in that folder, recording which folders it made.

Restart Claude there afterwards. Install again changes nothing (or updates the hook copy when this Wingman's is newer). The section's status line says what's there: installed, not installed, or installed by this PC's WSL setup.

A WSL machine of this PC may already have the hook from `install.ps1` (its entries run the Windows copy through `/mnt/c/...`). Install then adds no second entry and only makes the folder. In that machine's terminals the hook uses the machine's own folder, not the Windows one `WSLENV` hands in, because their terminal ids belong to that machine's Herdr core.

Inside a terminal there, `HC_TERMINAL_ID` is that machine's own id (`t3`). The hook writes that id; Wingman reads it as Herdr's address for the terminal (`wsl/t3`), and names its notes for that Claude by the bare id, as the hook reads them.

### Layout footprint

What the installer changes in a layout (`wingman/install.sh`, `install.ps1`). Each edit keeps what it replaced in the node, so uninstall restores the layout exactly:

| Node | Change | Kept in |
| --- | --- | --- |
| `wingman-review`, `wingman-edit`, `wingman-changes` (new, last in `panel-body`) | added | `props.added: true` |
| the `tabs` block | mod `tabs` becomes `tabs-plus` | `props.replaces: "tabs"` |
| the `panel` column (the stack's parent) | `max` raised to 2400 when lower | `props.max_was` on the first Wingman block |
| `wingman-capture` (new, last in the root's `floating`; see The capture controller) | added | `props.added: true`; `props.list_added: true` when install created the `floating` list |

Herdr's own layouts (`layout:<name>` in `installed.json`) are copied once to `<name>-copy` and the copy is edited. `wingman/tests/layoutdiff.mjs before.json after.json` lists changed, added and removed nodes by id.

## Uninstall

Run the same installer with `uninstall`. It removes only what install added: its hook entries, `HERDR_WINGMAN_DIR`, and its two `WSLENV` entries. Then delete this folder. To clear review data, delete `~/.config/herdr-app/data/wingman*` and any repo's `.git/wingman/` and `refs/wingman/` refs (see Checkpoints).

On another machine: **⚙ Settings** › **Machine** › **Claude hook on <machine>** › **Remove**. It removes the two entries it added (a backup first; entries it didn't add, such as this PC's WSL setup's, stay), the hook copy and its record, and the folders it made, with any events and notes still waiting in them. A settings file Install created and that is left empty goes too.

## Use

Open a Wingman pane beside an agent: run `pane.split` with `{"direction": "right", "mod": "wingman"}`, for example from the palette or a key in `keys.json`. Each pane shows the review for the space it's in. A pane or tab opened with `"props": {"view": "review"}` (or `"edit"`) in a layout without that Wingman panel starts in that view and switches between Review and Edit itself, like any pane; the comments and checkpoints dialogs open their files in it.

Or put Wingman in the side panel beside Files and Changes, as two panel tabs, Review and Edit. In a layout of your own (a clone, since Herdr's shipped layouts are read-only), add two blocks to the `panel-body` stack: `{"id": "wingman-review", "type": "block", "content": {"mod": "wingman", "props": {"view": "review"}}}` and the same with `wingman-edit` and `"view": "edit"`. Raise the `panel` column's `max` (for example to 2400), and point the `tabs` block at a clone of the `tabs` mod that draws a button per Wingman block. The `tabs-plus` clone does that. It also takes the commands `tabs-plus.wingmanReview` and `tabs-plus.wingmanEdit`, which the palette entries **Wingman: Review** and **Wingman: Edit** run to select the tab and show the panel. It keeps a width per panel tab: Review and Edit open at 960px the first time and then at whatever width you drag them to.

A third block, `{"id": "wingman-changes", "type": "block", "content": {"mod": "wingman", "props": {"view": "changes"}}}`, adds the **Changes** tab (palette: **Wingman: Changes**, command `tabs-plus.wingmanChanges`).

### The capture controller

Capture (the snapshot when an agent starts a turn, and the passes that adopt changed files) runs in one Wingman copy at a time, chosen by the lease file `data/wingman-leader.json`. Add a capture controller to the layout so that copy is always on screen: an empty block in the layout root's `floating` list. It draws nothing and only runs capture. The installer adds it; by hand, add this to the root's `"floating"` list (create the list if the layout has none):

```json
{ "id": "wingman-capture", "content": { "mod": "wingman", "props": { "role": "capture" } } }
```

The lease: `{ "id", "at" }` from a panel or pane copy, `{ "id", "at", "role": "capture" }` from a controller, renewed every second and held for 5 s. A controller always leads. Panel copies never take a controller's lease while it is renewed. A controller that finds a panel copy leading adds `"ask": <its id>`, unless an ask is there already. That copy then starts no new pass, keeps the ask in its renewals, and hands the lease over (`{ "id": <ask>, "at", "role": "capture" }`) as soon as none of its passes runs: within one pass, about 0.5 s in testing. When the controller goes (a layout without it), a panel copy takes the lease once it has expired, as before. With two controllers (two windows), the one holding the lease keeps it and the other waits until it expires.

The leader watches each captured repo on this computer (`watchFolder`) and runs a pass about 0.1 s after a change, at most one pass per 0.5 s. A change that only touches the git folder (objects, the index, Wingman's own review store) starts no pass; `HEAD` and branch refs do. The timer stays as a fallback: a pass every 10 s while every captured repo has a watch that has delivered events, else every 3 s. A repo whose watch fails, a repo on another machine, and a repo in WSL's own files seen from Windows (`\\wsl.localhost\…`, `\\wsl$\…`) keep the 3 s timer: on Windows, a watch there was accepted but never fired. Hook events and collect passes take turns, since both write the review index.

### Changes

Every uncommitted change in the space's repos, against `HEAD`: your edits, other tools', and the agent's from before Wingman started capturing. The list on the left shows each file's status (A added or untracked, M modified, D deleted, ! conflict), its added and deleted line counts (`+12 −3`, none for binary files), and what Review says about it ("2 to review", "reviewed"). The list header shows the totals. The diff is read-only; a double-click opens the line in Edit. A file HEAD has is diffed by the repo's own git (`git diff HEAD`), so its line-ending rules apply (`core.autocrlf`, `.gitattributes` `eol`): a file checked out with CRLF from an LF blob shows only the lines that changed, and the diff agrees with the counts.

- **Discard file** puts the file back as `HEAD` has it (a new file is deleted), after you confirm. File names are taken as names, never as git patterns: discarding `app/[slug]/page.tsx` leaves `app/s/page.tsx` alone. In a file under review the discard is your own edit: once the file is back as `HEAD` has it (or deleted, or brought back), the review baseline takes the same text, so Review shows nothing for it and never the restored lines as the agent's changes.
- **Commit**: check the files to commit (all by default), write a message (several lines are fine), then **Commit** or Ctrl+Enter. Only the checked files are committed, in one commit, however many: they're staged, new and deleted ones too, and anything else you had staged stays staged. (Their names go to git in a temp file in `<git-dir>/wingman/`, removed after; this needs git 2.26 or newer where the repo is.) With several repos in the space, pick the repo above the message box. A warning shows when checked files still have changes to review in Review; it doesn't stop the commit.
- Files with unsaved edits in Edit can't be discarded or committed until those are saved or discarded.
- Up to 500 files are listed; binary files are listed but not shown.
- **Committed on this branch**, under the uncommitted files: every file changed between where the branch split from the remote's default branch (`origin/HEAD`, else `origin/main`, `origin/master`, `main`, `master`) and `HEAD`, as a read-only diff with its line counts. Files an agent of this space changed carry an **AI** mark, here and in the uncommitted list. The list is read again only when `HEAD` or that starting point moves (two git calls per repo), after the uncommitted files show. A file's diff is read when you first pick it ("Loading …" meanwhile); diffs read earlier are let go when they add up to about 4 million characters, or when you leave the space.
- While the Changes tab isn't the panel's shown tab, it does nothing; it looks again as soon as it's shown. Each space keeps its own lists, checked files, picked repo and commit message.
- In a narrow tab the list column (320 px) gives way so the diff keeps 220 px, down to 180 px; narrower than that (about a 400 px panel at zoom 1), Changes shows one side at a time: the list, then a picked file's diff with **‹ Files** to go back.
- **Discard change**: each change in the diff has a **Discard change** button on its header row, and the right-click menu has **Discard change…** (or **Discard selected lines…** when changed lines are selected: only those go back, the rest of the change stays). It asks first, naming the change and its lines. Those lines go back as `HEAD` has them (a file checked out with CRLF while `HEAD` has LF gets them with CRLF, as a checkout would), written compare-and-swap: a file that changed since it was shown isn't written. A file with unsaved edits in Edit is refused. For a new file or a deleted one, use Discard file. `ctrl-z` in the Changes tab puts the lines back (also compare-and-swap); Review's and Edit's `ctrl-z` don't reach it, since each tab keeps its own undo. In a file under review, the discard is your own edit, written the way a save is: on lines Review shows as unchanged, the review baseline takes the same lines, so Review never shows the discard as the agent's change; on the agent's own lines only the file changes, so what's left of the agent's change stays to review (as typing there would), and the agent gets the edit note.
- **Generate** (above the message box) writes a draft commit message: the checked files' diff against `HEAD` (new files' text too) goes to **Settings › Inline edit command**, the same no-tools one-shot command and the same choice of where it runs as Inline edit, with the file list and line counts first (all files, then the diff, cut to fit the 28,000-character prompt, so a cut loses detail, not files) and the repo's last 10 commit subjects so the style matches. While it runs, the row says the diff is going to that command. The answer (code fences and surrounding quotes removed, control characters dropped, at most 2,000 characters) goes into the box as a draft to edit: it never commits. An empty box takes it at once; with a message typed, Generate asks first, and if you typed while it ran it asks again before replacing. **Cancel** drops the answer when it comes. With the default command it took about 7 s on this PC.

#### Sync and branches

At the top of the Changes column, each repo has a row: its branch (**⎇ main ▾**), its upstream (`→ origin/main`), and how far apart they are (`↑2 ↓1`: commits to push, commits to pull). The counts come from local refs only (two local git calls, when the lists load and every 30 s while Changes is shown): nothing reaches the network until you press a button. Below them:

- **Fetch** fetches the upstream's remote (else `origin`, else the only remote), then counts again.
- **Pull** is fast-forward only: `git pull --ff-only --no-rebase --no-autostash -- <remote> <branch>`. When your branch and its upstream both have new commits it says so and does nothing else: no merge, no rebase, no stash. git's own refusal shows when local changes would be overwritten.
- **Push** sends the branch to its upstream and nowhere else: `git push --no-follow-tags --recurse-submodules=no -- <remote> refs/heads/<branch>:<upstream branch>`, with the remote and branch named, so `push.default`, `pushRemote` and push refspecs in your config don't apply. It asks first ("Push 2 commits from main to origin/main?"), and reads the branch again on yes: if the commits or upstream changed since, it asks again. Never forced (the refspec starts with `refs/`, so not even a `+`), no tags, no `--no-verify` (your hooks run). A branch behind its upstream is refused by git, and the message says to pull. After a Commit, the Push button shows the new count.
- **Publish branch**, in Push's place for a branch with no upstream (or one deleted from the remote), only when a remote named `origin` exists: `git push -u … -- origin refs/heads/<branch>:refs/heads/<branch>`, after asking, naming the number of commits `origin` doesn't have.
- Pull, Push and Publish are off for a detached HEAD, a branch that tracks a local branch, and an upstream whose remote isn't a plain remote name; pressing one says why.

One sync step runs per repo at a time ("Pushing…"); each has 120 s. A mod can't answer a password or passphrase prompt, so these run with `GIT_TERMINAL_PROMPT=0`, no askpass program (`GIT_ASKPASS`, `SSH_ASKPASS` and `core.askPass` emptied, `SSH_ASKPASS_REQUIRE=never`) and `GCM_INTERACTIVE=never`: a remote that needs a login fails at once with git's own line (control characters removed, at most 300 characters) and "run it once in a terminal". Stored credentials (a credential helper, an ssh agent) work as usual. They run through `env` where the repo's git runs (see Which git runs); Windows' own git uses Git for Windows' `usr\bin\env.exe`. On another machine they run there and need `env` (any Unix).

**⎇ branch ▾** replaces the file list with the repo's local branches: the current one first, then by latest commit, at most 200. Click one to switch: `git switch --no-guess -- <branch>`, never `--force`, `--discard-changes` or `-m`, never a stash. Wingman refuses, naming the files, while any file of that repo has unsaved edits in Edit (any Wingman copy). git refuses when the switch would overwrite local changes, and its message shows. **Create** (or Enter in the name box) makes a branch at `HEAD` and switches to it: `git switch --no-track -c <name> HEAD`; nothing in the working tree changes. Names are checked before git sees them (no leading `-`, no spaces or control characters, none of `~ ^ : ? * [ \`, no `..`, `@{` or `//`, no part starting or ending with `.`, no `.lock`, not `@` or `HEAD`, at most 200 characters), then by `git check-ref-format --branch`, and always go to git as one argument. Review sets the branch's changes aside on a switch and brings them back on switching back (see Branch above).

Commands, for keys and `herdr-app do`: `wingman.fetch`, `wingman.pull`, `wingman.push`, `wingman.publish` (each takes `:<repo folder name>`; without, the commit box's repo), `wingman.syncConfirm`, `wingman.syncCancel`, `wingman.branches`, `wingman.branchSwitch:<name>`, `wingman.branchNew:<name>`, `wingman.branchClose`, `wingman.discardChange`, `wingman.discardChangeConfirm`, `wingman.discardChangeCancel`, `wingman.genMessage`, `wingman.genReplace`, `wingman.genKeep`, `wingman.genCancel`. They run once, in the Changes copy (see Commands): sent while another tab or a Wingman pane has them, the Changes tab is shown and runs them.


- Review is read-only. Accept and Reject still write to disk. `ctrl-shift-r`, a double-click on a line, and Quick Open of an unchanged file all switch to the Edit tab at that file and line. In the side panel, `ctrl-shift-r` cycles Review → Edit → Changes → Review, handing over the current file each time.
- Edit holds any unsaved edits. Before Review accepts or rejects in a file that has unsaved edits in Edit, those edits are saved (autosave on: try again a moment later), or, with autosave off, you're asked to save or discard them in Edit first.

Wingman finds a space's repos from its terminals' folders and from the files the Claude hook sees agents edit. When it finds none, for example for a WSL agent started from a Windows folder, click **Open folder…** and pick a folder in the repo. The Edit view's file tree has the same button for adding more repos. Added repos are remembered for the space, and capture covers them too.

| Action | Key |
|---|---|
| Accept / reject the selected lines, else the current change | `ctrl-y` / `ctrl-n` (a change's own buttons always act on the whole change) |
| Accept / reject file | `ctrl-shift-enter` / `ctrl-shift-backspace` |
| Next / previous change | `ctrl-down` / `ctrl-up` |
| Next / previous file | `ctrl-shift-down` / `ctrl-shift-up` |
| Undo last accept/reject | `ctrl-z` |
| Next view: Review → Edit → Changes (side panel), Review ↔ Edit (pane) | `ctrl-shift-r` |
| Open the file in your external editor | `ctrl-e` (or the editor's button at the far right), at the cursor or the current change; unsaved edits are saved first. Pick the editor in Settings. |
| File tree (Edit view) | `ctrl-b` |
| Rename / delete the selected file or folder (file tree) | `f2` / `delete`, while the tree has the keyboard (see File operations) |
| Select lines | click a line, or click and drag; Shift+click or `shift-up` / `shift-down` to extend; click inside the selection or `escape` to clear. |
| Menu for a line or change | right-click: Inline edit… (Edit), Ask agent now, Add review comment, Reject, Reject with comment, Reject and add review comment, Accept (on the selected lines when there are any). Right-click never changes the selection. |
| Ask the agent now about the selected lines, else the current change | `ctrl-m` (or the change's Ask button) |
| Inline edit: rewrite the selected lines, else the cursor's line (else the current change), from an instruction | `ctrl-k` (or Inline edit… in Edit's right-click menu); from Review it opens in Edit |
| Add a review comment on the selection, else the cursor's line, else the current change | `alt-m` (or the change's Comment button, or + Comment in Edit) |
| Review comments: list, jump, edit, delete, send to the agent | `alt-shift-m` (or the header's Comments N) |
| Quick Open | `ctrl-p`: find a file by name across the space's repos (fuzzy, as in VS Code). `name:12` or `name:12:5` opens it at that line; `:12` goes to a line in the current file. With no query it lists recent and changed files. Up and down choose, Tab fills in the chosen path (then add `:line`), Enter opens, Esc closes. |
| Comment on the last rejection | `ctrl-r` (or the header's Comment last rejection) |
| Search in files | `ctrl-shift-f`: the Edit tab's Search, with a one-line selection as the query (see Search) |
| Check for problems (tsc, dotnet build, the Problems command) | `ctrl-shift-m` (see Problems) |
| Next / previous problem | `f8` / `shift-f8` |

## Views

The header switches between two views (`ctrl-shift-r`):

- **Review**: the tabs are the files with changes to review.
- **Edit**: a file tree of the space's repos and plain folders on the left, like VS Code's Explorer (`ctrl-b` shows or hides it, and opens the Edit view from Review). Folders load when you open them. In a repo, the tree comes from git's file list, so empty folders don't show. Ignored files and folders are dimmed, and an ignored folder's content is read from disk when you open it. Each file shows its git status letter (A added or untracked, M modified, D deleted, U conflict), its change count to review and a dot for unsaved edits. Folders show the strongest letter under them and their total count. Deleted files are struck through and still open their diff while under review. A folder lists at most 500 entries and the tree 5000, then "… more files not shown". Click any file to open it in the same editor, with its diff when it has changes. Binary files show "binary file" instead of their content. The tabs are the changed files plus the files you opened. Opened files close with their ×, which saves them when autosave is on. Changed files stay until they're reviewed. The tree's column (260 px, 300 px with Search or Problems) gives way so the editor keeps 220 px, down to 180 px; narrower than that, the editor shows alone with **‹ Files**, and `ctrl-b` or **‹ Files** shows the column in its place until a file opens.

### File operations

Right-click a file, a folder or a root's header (with one root and no header, the tree's empty space) for VS Code's Explorer menu. It works in repos and plain folders, on this computer and on another machine. Entries that don't apply are left out.

- **New File…** and **New Folder…**: a name box opens in the tree, inside the folder (or the root) you clicked, or beside the file. Enter creates, Esc cancels. A name with `/` makes the folders on the way (`a/b/c.ts`). A new file opens in the editor, with the cursor on its one empty line. A new empty folder in a repo shows in the tree though git doesn't list it.
- **Rename…** (`f2`): the name box holds the name, with the part before the extension selected. A name with `/` moves the item, relative to its folder. Changing only letter case (`readme.md` to `README.md`) works on Windows and macOS too.
- **Delete** (`delete`): a confirm under the row names the item, and a repo folder's file count when the repo's file list knows it ("Delete folder src/old and its 12 files?", else "and everything in it?"). Enter or **Delete** deletes, Esc or **Cancel** doesn't. Deleting is permanent, here as on another machine: nothing goes to the trash or Recycle Bin.
- **Copy Path** and **Copy Relative Path**: as the machine names it, with backslashes for a Windows drive.
- **Reveal in File Explorer** (Windows), or **Reveal in file manager** (Finder on macOS, the folder through `xdg-open` on Linux), and **Open in** the external editor: this computer's files only.
- **Refresh** (root header): reads the root's file list and folders again now.

A click on a row (or a root's header) selects it and gives the tree the keyboard, as in VS Code's Explorer:

| Key | While the tree has the keyboard |
|---|---|
| `up` / `down`, `k` / `j` | the row above or below, across roots (headers included), scrolled into view |
| `right`, `l` | opens a closed folder or root, else moves to its first entry |
| `left`, `h` | closes an open folder or root, else moves to the folder (or root) above |
| `home` / `end`, `g` / `shift-g` | the first or last row |
| `enter` | opens a file with the cursor in it (the editor takes the keyboard), or opens or closes a folder |
| `space` | opens a file, keeping the keyboard in the tree |
| `f2` / `delete` | rename / delete the selected row |
| `escape` | closes the delete confirm, else gives the keyboard back to the editor |

Pane shortcuts that don't change the file keep working there (`ctrl-p`, `ctrl-f`, `ctrl-shift-f`, `ctrl-s`, `ctrl-b`, next and previous file or change). Typing, editing keys, undo, accept and reject do nothing: nothing reaches the file while the tree has the keyboard. A click in the editor, a tab or any box gives the keyboard back, so `delete` in a file still deletes text. `f2` and `delete` can be changed in Settings → Keyboard shortcuts.

Names that are refused, with the reason shown under the box (the box stays open): empty, `.` or `..`, `.git`, a backslash, a NUL, a leading `/`, a file name ending in `/`, anything already there. Folders on a Windows drive also refuse `< > : " | ? *`, a name ending in a dot or a space, and names Windows reserves (`CON`, `NUL`, `COM1`…). Every operation stays inside its root: never the root itself, never `.git` or anything in it, never a path with `..`. A root that is no project, only where a terminal happens to be (`/`, a drive or share root, `/mnt/c`, `/home`, `C:\Users`, a system folder such as `/usr` or `C:\Windows`), gets no file operations at all: "File operations aren't available in /: open a project folder".

Files with unsaved edits, in this tab or another Wingman tab, block renaming or deleting them and any folder holding them, naming the files. A renamed file that was open reopens at its new path; a deleted one's tab closes. Review sees a rename as git does, the old path deleted and the new one added: a renamed file under review shows there as deleted. Afterwards the tree reads the changed folders and the repo's file list again at once, open folders stay open, and the new or renamed item is shown.

How it runs: on Linux, macOS and another machine, one `sh` script with the paths as arguments (`mv` for rename, `rm -rf` for a folder, which refuses anything outside its root, anything under a root such as `/` or `/mnt/c`, `/`, and a home folder or a folder above one). On a Windows drive, PowerShell with each path as a quoted literal and .NET calls (`File.Move` and `Directory.Move`, which never replace a target; a folder's delete walks it, clears read-only attributes and removes junctions as links). In WSL's own files, the `sh` script through `wsl.exe`. A Windows machine elsewhere says "Saving on a Windows machine isn't supported yet". Each operation is one call: about 0.8 s on a Windows drive, 0.3 s in WSL's files, 0.15 s on another machine.

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
| Find | `ctrl-f` (a one-line selection becomes the query). Enter / Shift+Enter or `f3` / `shift-f3` for the next and previous match. `alt-c` case, `alt-w` whole word, `alt-r` regular expression. Esc closes. The bar fits the editor's width down to 300 px: the box shrinks from 240 to 100 px, then the match count, `.*`, `W`, `Aa` and the Replace toggle go in that order, the arrows and × stay (their keys keep working); the replace row drops its group hint first and shortens **All**. |
| Replace | `ctrl-h`. Enter replaces the current match and moves on; `ctrl-enter` in the replace box, `ctrl-alt-enter` or All replaces every match as one undo step. With regular expressions, `$1` and the like insert groups. |
| Go to line | `ctrl-g`, then a line or `line:column` |
| Bracket matching | with the cursor next to `(` `)` `[` `]` `{` `}`, both brackets of the pair get a box. Brackets in strings and comments don't count. None while text is selected. |
| Save | `ctrl-s` |
| Format the file, then save | `alt-shift-f` (command `wingman.formatFile`), whatever **Format on save** says. See Format on save. |
| Undo / redo | `ctrl-z` / `ctrl-shift-y` (one history with accept and reject; redo is for edits). Each space keeps the newest 200 steps, fewer when they hold over about 24 MB of file text; older steps are dropped. |
| Scroll sideways | Shift+wheel |

Line operations act on the cursor's line or every line a text selection covers, and each is one undo step. Herdr's global keys reach Herdr before Wingman, so `alt-up`, `alt-down` and `ctrl-shift-k` need a `mod:wingman` section in `keys.json` to send them to Wingman while it has focus:

```json
"mod:wingman": {
  "alt-up": "wingman.moveLineUp",
  "alt-down": "wingman.moveLineDown",
  "ctrl-shift-k": "wingman.deleteLine"
}
```

A key sent this way acts only where the same key pressed in Wingman would: never on the file while a box has the keyboard (find, Quick Open, Search, the commit message, a tree name box) or while the tree has it. Every line operation is also a command for other keys: `wingman.moveLineUp`, `wingman.moveLineDown`, `wingman.copyLineUp`, `wingman.copyLineDown`, `wingman.deleteLine`, `wingman.joinLines` and `wingman.toggleComment`.

### Inline edit

`ctrl-k` in Edit opens a box above the file for the selected lines (a text selection covers the lines it touches), else the cursor's line, else the current change. Type an instruction ("use async/await") and press Enter. The lines are sent, as the buffer has them (unsaved edits included), with five lines of context on each side, the file's path in its repo and its language, to **Settings › Inline edit command**, which runs once without a terminal or the agent. The box shows "Editing… N s" with **Cancel** (or Esc): the answer of a cancelled edit is ignored. The command keeps running until it ends or its 120 s are up.

The answer replaces exactly those lines, as a pending change: the review baseline keeps the old lines, the buffer and the file get the new ones, and the change shows with Reject, Accept and undo like an agent's. A file that isn't under review yet is put under review the way the Claude hook does it (an event in `data/wingman/events/`, applied by the capture leader with the hook's), with the text before the edit as its baseline. The file is saved with the edit, unsaved edits elsewhere in it included; those count as yours, not as part of the change. The answer goes to the file and space it was asked for, even when another file or space is shown by then.

Nothing changes when the command isn't found, exits with an error, answers nothing, or runs out of time, or when the lines changed in the buffer while it ran: the box says which in one line. One code fence around the whole answer is removed. The instruction is one line of at most 2,000 characters, with control characters dropped. At most 400 lines go in one edit (about 28,000 characters of prompt). Files outside a git repo aren't edited inline, since there's no review to show the change in.

The default command is Claude Code's headless mode, with nothing it can act with:

```
claude -p --output-format text --tools "" --permission-mode dontAsk --strict-mcp-config --disable-slash-commands --no-session-persistence --settings {"disableAllHooks":true} {prompt}
```

`--tools ""` takes away every built-in tool (no file reads or edits, no shell), `--permission-mode dontAsk` denies anything that would ask, `--strict-mcp-config` loads no MCP servers, `--disable-slash-commands` no skills, `disableAllHooks` keeps your hooks out of these calls, and `--no-session-persistence` keeps no transcript. It answers in about 4 to 5 seconds. The command is a template: words split at spaces, `"quotes"` keep spaces (`""` is an empty argument), `{prompt}` is the whole prompt as one argument and `{promptFile}` the path of a temp file holding it (`data/wingman/inline-*.txt`, removed afterwards; this computer's files only); with neither, the prompt goes last. It runs as an argument list: no shell reads the template, the instruction or the code. **Default** in Settings puts the default back. Nothing is sent anywhere else, and Wingman itself makes no network calls for it.

It runs where the repo's tools live (see Where tools run): this computer, WSL for a repo WSL owns, or the space's machine, with your shell's `PATH` and `~/.local/bin` (where Claude Code installs) first. For other repos on Windows, a native `claude.exe` on `PATH` runs directly, and without one WSL's `claude` does. The command runs in the repo's top folder, so Claude Code reads that repo's `CLAUDE.md`. Windows' `claude.exe` and WSL's `claude` are signed in separately (`claude auth status` in each): when the one that runs isn't, the box (and Generate) says which, for example "claude (Windows) isn't signed in: run `claude auth login` in Windows, then try again", with Claude Code's own line after it.

### Where tools run

Inline edit's command, Format on save's formatter and the Problems checkers all run the same way (`toolrun.js`). On Linux, macOS, WSL (for a repo WSL owns, through `wsl.exe`) and another machine, each runs through `sh -lc` with a fixed script that takes the `PATH` and the program's arguments as arguments: no shell ever reads a file name, a setting or your text. A login shell's `PATH` (and WSL's) lacks what your interactive shell adds, such as Node from nvm, fnm or volta, which `~/.bashrc` or `~/.zshrc` sets up. So Wingman asks your shell once per machine (`$SHELL -lic`, printing `PATH` between two markers, so a banner can't get in; at most 10 s) and keeps the answer while Wingman runs. Measured on this PC, bash with nvm: 0.2 s in Linux and 0.5 s through `wsl.exe`; later calls cost nothing more. Only bash, zsh and other POSIX shells are asked. When the shell isn't one of those or doesn't answer, the newest `~/.nvm/versions/node/*/bin`, `~/.volta/bin` and fnm's default are added instead, and the shell is asked again a minute later. `~/.local/bin` and `~/.claude/local` always come first. On Windows, a repo that isn't WSL's runs the native `.exe` that `where` finds (`node.exe`, `dotnet.exe`, `claude.exe`), else WSL's.

`herdr-app do "wingman.inlineEdit:<instruction>"` (or that string as an action in `keys.json`) opens the box with the instruction and runs it, in one Wingman copy (see Commands): the Edit copy when it's shown, else the shown copy hands the cursor's lines to Edit, as `ctrl-k` in Review does.

Comment, Accept and Reject act on the lines a text selection covers. Clicking the line numbers still selects whole lines. Not supported: input methods that compose characters (Chinese, Japanese, Korean), and wide characters or emoji, which put the cursor in the wrong column.

## Search

`ctrl-shift-f` (or **Search** at the top of the Edit tab's left column, beside **Explorer**) searches the files of every git repo in the space, on another machine too, as `git grep` sees them: tracked and untracked files, not ignored or binary ones. Plain folders aren't searched. From Review or Changes it switches to the Edit tab. A one-line text selection becomes the query.

- Typing searches once you pause (from 2 characters), and Enter searches at once. `alt-c`, `alt-w` and `alt-r` (or **Aa**, **W**, **.\***) toggle match case, whole word and regular expression. Esc gives the keyboard back to the editor and keeps Search open.
- ▸ beside the box shows **Replace**, **files to include** and **files to exclude**: globs separated by commas, such as `src/**, *.ts`. A glob without a `/` matches at any depth, and a folder matches everything in it.
- Regular expressions are the subset that git and JavaScript read alike: classes, groups, alternation, quantifiers, anchors, `\b`, `\d \w \s` and their capitals. Lookarounds, lazy quantifiers, backreferences in the query and searches across lines are refused with a message.
- Results are grouped by file (with the repo first when the space has several), at most 2,000. Click a file to fold it. Click a match, or Down from the box, then Up/Down and Enter, to open the file at that match with it selected. Left and Right fold and unfold. While the results have the keyboard, typing doesn't reach the editor: Enter, Esc or a click in the editor gives it back.
- With text in **Replace**, each match shows its replacement (`$1`, `$&` and the like insert groups in regex mode) and **Replace All** appears. It asks first ("Replace 12 occurrences in 4 files?"), then rewrites only the lines the results list, from each file as it is on disk then. A file under review is changed the way a saved edit of yours is: on unchanged lines the review baseline takes the same edit, inside the agent's added lines the change stays pending, and the agent gets the edit note. Each write is compare-and-swap: a file changed since it was read is skipped and named. Files with unsaved edits in any Wingman tab block it until they're saved or discarded. Afterwards open files reload and the search runs again. Replace All is not undoable from Wingman.
- Each space keeps its own query, options, results and which mode the left column shows.

## Problems

Wingman marks what the project's own checkers report. It holds no language server: each checker runs once, as a command, and its output is read.

- **eslint**, on one file: when the file has an eslint config (`eslint.config.*` or `.eslintrc*`) at or above it and eslint installed (`node_modules/eslint`) at or above that config, inside the repo. It runs when the file is opened in a tab, each time Review or Changes hands a file to Edit (its tab may be open already), and after `ctrl-s` (or **Save**), with `--format json`, in the config's folder. One run per file at a time.
- **tsc**, for a project: the nearest `tsconfig.json` at or above the file (or at the repo's top), with `node_modules/typescript` at or above it. `vue-tsc` is used instead when it's installed there. `--noEmit --pretty false -p tsconfig.json`, in the tsconfig's folder.
- **dotnet build**, for a project: the nearest folder holding a `.sln`/`.slnx` (preferred) or `.csproj`, for C# files and for the repo's top. `dotnet build <file> --no-restore -nologo -v:q -tl:off -clp:NoSummary` (flags checked with `dotnet build --help`, .NET SDK 10.0.401). It doesn't restore: a project never restored reports that as its failure line.
- **Problems command** (Settings), per repo: your own command, with the output read as tsc-style lines, eslint JSON, or `path:line:col: message`. With `{file}` (the file's path in the repo) it runs per file, on open and save; without, with Check. It replaces the built-in checkers of its kind: a per-file command replaces eslint, a project command replaces tsc and dotnet build. It runs in the repo's top folder.

eslint and tsc run as `node <the package's own script>` (what `node_modules/.bin/<name>` points to), so they need `node` where they run. Project checkers run with **Check**: `ctrl-shift-m` (command `wingman.checkProblems`), the Problems tab's **Check** button, and, with **Check after each agent turn** on in Settings (off by default: a build can be slow), whenever an agent of the space finishes a turn. Check runs the project checkers found at the repo's top and from files opened, plus the current file's own. Nothing runs in a repo where no checker is found ("No checker found in …"), nothing is installed, and plain folders (no git) aren't checked. **Problems** in Settings (on by default) turns all of it off.

They run where the repo's tools live, with your shell's `PATH` (see Where tools run), so a Node from nvm is found in WSL too. Every command is an argument list: no shell ever reads a file name, a setting or checker output. A checker's time limit is 20 s for one file and 180 s for a project. The same checker never runs twice at once in a repo: a request while it runs makes it run exactly once more after. A run that can't start, times out, or exits with an error and nothing readable shows one line in the tab ("tsc: timed out after 180 s"), and the last good list stays. "node isn't on your shell's PATH where the repo's tools run" means your shell has no `node` there (see Where tools run).

Output is read as data: at most 2 MB of it, paths outside the repo (or climbing out with `..`) dropped, messages cut at 300 characters with control and bidirectional characters removed, and at most 1,000 problems per repo, errors first ("… N more not shown").

Where they show:
- **Editor**: a bar on the line number of each line with a problem (the theme's error or warning colour), the range underlined over a light tint, and the cursor line's messages in a strip under the editor. There is no hover: the mod API has no tooltips. While you edit, marks below an added or removed line move with it; marks on edited lines are dimmed until the next run.
- **Problems** in the Edit tab's left column, with its count ("Problems 3"): grouped by file, files with errors first, then **Check**, **Send to agent**, **Send file** (the selected row's file) and **Copy**. Up and Down move, Left and Right fold, Enter or a click opens the file at the line and column.
- **File tree and tabs**: a file with problems has its name in the error or warning colour.
- `f8` / `shift-f8`: the next or previous problem, in the file and then the next file.

**Send to agent** builds one prompt: each problem's place (relative to the agent's folder, `/mnt/...` paths for an agent in WSL), severity, code, checker and message, with its source line quoted, at most 30,000 characters (the rest is counted). It goes the way review comments do: the space's only agent, else you pick; a working agent asks first; `hc send` types it in. **Copy** puts the same prompt on the clipboard.

On another machine, detection is one `sh` call there and checkers run there. A machine without `sh` (Windows) shows "Problems need sh on <machine>". Only this computer has been tried (a Windows drive and WSL's own files).

Problems run and show in one Wingman copy: the Edit panel's, else a pane copy when the layout has no Edit panel. `ctrl-shift-m` pressed in another copy, and a Problems command that reaches another copy (see Commands), asks that one and shows the Edit panel. Commands for keys and tests: `wingman.checkProblems`, `wingman.nextProblem`, `wingman.prevProblem`, `wingman.problemsShow`, `wingman.problemsUp`, `wingman.problemsDown`, `wingman.problemsEnter`, `wingman.problemsSend`, `wingman.problemsSendFile`, `wingman.problemsCopy`, `wingman.problemsConfirm`, `wingman.openSettings`.

Measured on this PC (the sample project: two files, three tsc errors, three eslint problems): on a Windows drive with Windows Node, eslint on one file 5.4 to 6.5 s and tsc 2.5 to 2.9 s; in WSL's own files through `wsl.exe`, eslint 0.9 s and tsc 1.8 s; `dotnet build` of a one-file console app 7.4 s.

## Neovim as the editor

Set **Editor** to **Neovim** in Settings to edit in Neovim instead of Wingman's own editor. Wingman stays the review: clicking a line of the diff, `ctrl-o`, the **Neovim** button, or a file in the tree opens that file at that line in a Neovim pane beside Wingman. In the Edit view, Wingman then shows only the file tree, full width, and a click opens the file in Neovim at its first change. Each space gets one Neovim, started with `--listen`, and later files open in the same one. Buffers reload when the agent writes to a file, unless they hold unsaved edits. Wingman picks up Neovim's saves within 2 seconds.

On Windows, Wingman uses `nvim.exe` when it's on PATH, otherwise WSL's `nvim`. Your own Neovim config applies, including its plugins for autopairs, tags and line moves. Herdr's global keys (for example `alt-up` / `alt-down`) still apply inside the Neovim pane unless `keys.json` sends them to the terminal.

## Keyboard shortcuts

Every key in the tables above can be changed in **Settings → Keyboard shortcuts…**. Click **+ key** on an action and press the new shortcut. An action can have several keys, × removes one, and **Reset** puts an action back to its defaults (**Reset all** does every action). If the key belongs to another Wingman action, you're asked whether to move it. Plain typing keys and the keys for moving and deleting text (arrows, Home/End, Page Up/Down, Backspace, Delete, Enter, Tab) can't be rebound.

Herdr's global shortcuts reach Herdr before Wingman. When a Wingman key is one of them (by default `alt-up`, `alt-down` and `ctrl-shift-k`), Wingman adds it to the `mod:wingman` section of Herdr's `keys.json`. Herdr then sends it to Wingman while Wingman has focus, and the shortcuts page shows which Herdr action it hides there. Wingman only changes its own entries in that section (`wingman.<action>`).

Your changes are saved in `~/.config/herdr-app/data/wingman/keys.json` as `{ "<action>": ["key", ...] }`, holding only the actions you changed. Each action is also a command, `wingman.<action>` (for example `wingman.joinLines`), that you can bind anywhere in Herdr's `keys.json`.

### Commands

Herdr hands a `wingman.<command>` to every Wingman copy on screen (the shown panel tab, each Wingman pane of the shown tab, an open Wingman dialog) and to no hidden one. Exactly one copy acts (`cmdroute.js`): the copies that got it wait 60 ms for each other, then the one ranked first does it: the copy whose right-click menu sent it, else the copy with the keyboard, else the copy the command belongs to (Problems and Inline edit: the Edit copy; the git commands of Changes: the Changes copy), else a panel copy over a pane copy. A copy that wins a command it can't run hands it to the copy it belongs to and shows that tab: a Problems command to the Edit tab, a git command to the Changes tab (taken there once it shows, within 10 s, by one Changes copy even when a Wingman pane opened with `"view": "changes"` shows too). So `wingman.addComment` or `wingman.checkpoints` opens one dialog with a Wingman pane beside the panel too. A dialog's own commands (`wingman.cp*`) and the file tree menu's act where they belong. Settings saved from the Settings dialog, and the Claude hook installed or removed there, reach every copy, hidden ones too (a shared stamp each copy checks 4 times a second); `wingman.settings` does the same from a key.

## Format on save

`alt-shift-f` formats the open file, then saves it. With **Format on save** on, `ctrl-s` does the same. Wingman only runs a formatter the repo already has:

| Files | Formatter |
|---|---|
| `.js .jsx .mjs .cjs .ts .tsx .mts .cts .json .jsonc .json5 .css .scss .less .html .htm .vue .md .markdown .mdx .yml .yaml .graphql .gql` | Prettier, when `node_modules/.bin/prettier` exists in the file's folder or any folder above it up to the repo root (the nearest one is used). A file that `.prettierignore` excludes, or that Prettier has no parser for, is left alone. |
| `.cs .csx` | `dotnet csharpier`, only when a `.csharpierrc*` file or a `.config/dotnet-tools.json` listing `csharpier` is at or above the file's folder up to the repo root. `dotnet format` is never run. |

Anything else is saved as it is. Add a formatter to the `FORMATTERS` table in `format.js`.

How it runs:

- The buffer is written to a temp file beside the file, named `.wingman-fmt-<random>.<ext>` (same extension, so the tool picks the same language and finds the same config and ignore files for that folder). The tool formats that file, Wingman reads it back and deletes it, also when the tool fails or times out. A mod's calls have no stdin, which is why a file is used. Per-file config (a Prettier `overrides` entry that matches the real file name, such as `*.test.ts`) does not see the temp name.
- It runs where the repo's tools live, with your shell's `PATH` (see Where tools run): this computer, WSL for a repo WSL owns, or the space's machine. The command is an argument list, never a shell line built from file names. The whole run for one file has 10 seconds.
- The result is applied to the buffer as one undo step, with the cursor kept on the same line where possible, and then saved. Line endings stay as the file had them. In Review, formatting is treated like your own save: lines outside the agent's changes change the baseline too, so formatting never shows as an agent change, and lines inside its added lines stay part of its pending change.
- If the formatter is missing, rejects the file (a syntax error) or times out, the buffer is saved as it is and a one-line notice says why. Your text is never lost and the save is never blocked. If you type while the formatter runs, its result is dropped and your buffer is saved as it is.
- The tool is found once per folder and remembered for the space while Wingman runs.

## Settings

The header's **⚙ Settings** (or the narrow header's ⚙; command `wingman.openSettings`) opens a dialog in sections, each short enough for an 820 px window at zoom 1.2 (a section scrolls in a smaller window): **General** (the notes, the session log, Herdr's buttons, the editor, the external editor), **Editing** (brackets, tags, wrap, autosave, Format on save), **Inline edit** (its command), **Problems** and, for a space on another machine, **Machine**. Commands for keys and tests: `wingman.settingsTab:general`, `:editing`, `:inline`, `:problems`, `:machine`. The settings:

- **Auto note on rejections**: tell the agent which of its changes you rejected. On by default.
- **Note on my edits**: when you save, tell the agent that changed the file which lines you edited, so it reads the file again before its next change. On by default. The note is delivered with the agent's next tool call or prompt, and a newer save replaces a note it hasn't read yet.
- **Auto-close brackets and quotes**: the bracket and quote rules under Editing. On by default.
- **Auto-close tags**: the tag rules under Editing. On by default.
- **External editor**: VS Code (default), Cursor, Windsurf, Zed, Sublime Text, or a custom command with `{path}`, `{line}` and `{col}`. VS Code, Cursor and Windsurf open WSL files through Remote - WSL. On Windows a `.cmd` launcher runs through cmd.exe, which refuses paths containing `& | < > ^ % ! " , ; =`.
- **Inline edit command**: the command `ctrl-k` runs (see Inline edit), with **Default** to put the default back.
- **Problems**: run the project's checkers and mark what they report (see Problems). On by default.
- **Check after each agent turn**: Check when an agent of the space finishes a turn. Off by default.
- **Problems command** (per repo of the shown space, with a repo choice when there are several): your own checker and how its output reads (see Problems).
- **Editor**: Wingman (the built-in editor, the default) or Neovim (see Neovim as the editor).
- **Hide Herdr's Files and Changes buttons**: takes `files` and `changes` out of Herdr's `workspace.panels` setting, so the tab bar shows only Wingman's Review, Edit and Changes. Off by default. Wingman records which entries it removed in the shared key `wingman.panelsHidden` and, when turned off (or on uninstall), puts back only those, in their old order. An entry you or another mod (herdr-nvim) had already removed stays removed.
- **Format on save**: `ctrl-s` (and the Save button) format the file with the repo's formatter first, then save. Off by default. Autosave never formats, because it saves while you are elsewhere and formatting moves text. See Format on save.
- **Autosave**: save when Wingman loses focus (another pane, or another window), and when you switch files or spaces. On by default. Herdr has no blur event for mods, so focus is checked 4 times a second.
- **Also save after typing stops for**: Focus change (no timer, save on focus change only), 1, 2, 3, 5 or 10 seconds. Focus change by default.
- **Claude hook on <machine>** (a space on another machine only): its status, and Install and Remove (see Install).

Settings are kept in `~/.config/herdr-app/data/wingman/settings.json`.

## Files it writes

| Where | What |
|---|---|
| `<git-dir>/wingman/` | `index.json`, `baselines/`, `capture.json`, `sums.json` (what each reviewed file had while it differed from `HEAD`), `checkpoints.json` (see Checkpoints), `snap.<pid>.index` while a snapshot runs (per repo) |
| the repo's refs | `refs/wingman/checkpoints/<id>`, one tree per checkpoint (see Checkpoints) |
| `~/.config/herdr-app/data/wingman/` | `events/` (from the hook and from Inline edit, removed once read: edits, and prompts of at most 64 KB for checkpoint titles), `inline-*.txt` (an inline edit's prompt, only with `{promptFile}`, removed after the run), `feedback/` (notes for Claude), `outbox/` (comments waiting for an idle agent), `spaces.json` (repos agents used, per space), `hidden.json` (repos removed by hand, per space), `workspaces/` (workspace files Wingman made), `settings.json` |
| the formatted file's folder | `.wingman-fmt-<random>.<ext>` while a format runs (see Format on save), removed when it ends |
| the space's folder | `<folder>.code-workspace`, when you add a second repo and the folder isn't inside a repo |
| `~/.config/herdr-app/data/wingman-leader.json`, `wingman-capture.log` | which copy runs capture (see The capture controller), and its log |
| another machine's `~/.config/herdr-app/data/wingman/` | with the Claude hook installed there: `wingman-hook.sh`, `wingman-install.json`, `events/` (removed once read), `feedback/` |
