# skillshare for Herdr (WSL)

A Herdr panel for the skillshare CLI. It shows what the focused space's project and the
global source hold—skills, agents, MCP servers, plugins and hooks—and what needs an update or a sync. It updates, syncs, installs from a
URL, uninstalls, hands an audit to the focused agent, syncs the source repository both
ways, and shows each Herdr machine's skillshare on a Machines tab.

This is a fork of runkids/skillshare's [`herdr/skillshare`](https://github.com/runkids/skillshare/tree/main/herdr/skillshare) (MIT, see `LICENSE`), renamed to `skillshare-wsl`. It changes two things:

- **Herdr on Windows, agents in WSL.** Upstream runs everything through `sh` on the space's
  machine, and Windows has no `sh`. On Windows, this fork runs the panel's work for
  "This computer" inside WSL (`wsl.exe -d Ubuntu --exec sh -c …`), so it manages the skills
  your WSL agents read from WSL's `~/.claude`. Spaces on other Herdr machines work as upstream.
- **Skill descriptions.** Expanded skill and agent rows show the `description` from the
  skill's `SKILL.md` or the agent's `.md` frontmatter.

## Install

Needs the skillshare CLI in WSL (`curl -fsSL https://raw.githubusercontent.com/runkids/skillshare/main/install.sh | sh`
puts it in `~/.local/bin`), set up with `skillshare init`. For a distro other than `Ubuntu`,
change `WSL_DISTRO` near the top of `mods/skillshare-wsl/main.js`.

Paste this prompt into an agent in Herdr:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this layout: https://github.com/jbped/herdr-mods/tree/main/skillshare-wsl
```

By hand:

1. Copy `mods/skillshare-wsl/` to `~/.config/herdr-app/mods/skillshare-wsl/`.
2. Copy `layouts/herdr-skillshare.json` and `layouts/herdr-skillshare.png` to
   `~/.config/herdr-app/layouts/` and switch to it (`layout.switch {name: "herdr-skillshare"}`).
   `RECIPE.md` describes it in full and `preview.png` shows it. Or, in your own layout, add:
   - a toggle block to the tab bar row:
     `{ "id": "skillshare-toggle", "type": "block", "content": { "mod": "skillshare-wsl", "props": { "role": "toggle" } }, "size": { "px": 118 } }`
   - a column beside the work area:
     `{ "id": "skillshare-panel", "type": "column", "children": [{ "id": "skillshare", "type": "block", "content": { "mod": "skillshare-wsl" } }], "size": { "px": 400 }, "min": 320, "max": 720 }`
3. Run `herdr-app check ~/.config/herdr-app/mods/skillshare-wsl`.

It can sit beside upstream's `skillshare` mod: the two use different mod names, but share
the same `shared` keys, so show only one panel at a time.

The panel lives in its own layout node instead of the per-space `panel` stack. Herdr's tabs mod
restores that stack per space, so a panel there closes when you switch spaces. This node's
shown or hidden state is a layout click, which Herdr keeps across spaces and restarts.

## How it reads

- It runs on the shown space's machine (`exec` with `on`), in the focused terminal's folder.
  When Herdr runs on Windows and the space is on this computer, it runs in WSL instead
  (`wsl.exe -d Ubuntu --exec sh -c`), turns Windows path arguments such as `C:\dev\x` into
  `/mnt/c/dev/x`, and reads job output with `cat` in WSL instead of `readTextFile`.
- A folder with `.skillshare/config.yaml` or `skillshare/config.yaml` is a project; both
  scopes show and the All · Project · Global filter appears.
- Per scope, one detached script runs `list --all`, `diff`, `mcp list`, `plugin list` and `hooks list`
  with `--json`, then reads each skill's and agent's frontmatter `description` from the
  source folders `status --json` names, because `list --json` has no descriptions.
  `check` and `check agents` run every 10 minutes. Git state comes from `git status` in the
  source repository, because the CLI has no JSON for it.
- The CLI's install dry-run does not list a repository's skills, so the install dialog
  shallow-clones the repository to a temp folder to offer the pick list. It then runs
  `skillshare audit <path> --json` on that clone, because `install --json` names a blocked
  skill but not its findings. A block shows the findings before anything is written;
  "Install anyway" reruns the install with `--force`.
- The source dialog runs `skillshare pull` and `skillshare push -m`. When a pull or
  `push --pull` stops on files both sides changed, the panel reads both versions with
  `git show HEAD:<file>` and `git show @{u}:<file>`, puts the repository back, and asks
  which version to keep for each file.

Hook rows show their agents and planned sync changes. Top-level declared hooks offer confirmed
Enable, Disable and Remove actions; Sync applies them through `sync --all`.
Counts and groups include named hook entries and pending named cleanup, excluding diagnostic
notices. Notices follow the scope, kind and text filters and remain visible with zero entries.
Nested hook rows show their full root to distinguish projects with the same folder name.
“In sync” describes native file alignment; inactive hooks retain a warning dot and reason.
Warnings and preview failures appear above the resource groups. When preview fails, named
entries stay visible there as “sync status unknown”; they do not count as pending or in sync.
Disabled state remains visible alongside diagnostics, and pending summaries omit unchanged
targets while expanded details retain them. When only an unnamed native
include needs work, “Native hook files need sync” offers Sync for its scope.

Disabled rows are hidden by default; “In sync” offers Show disabled and Hide disabled when
there are any. The choice is kept across restarts, and a disabled hook with pending changes
stays listed. For skills and agents, “In sync” also switches between List and By source
(the default), which folds rows from the same repository, or local ones, into collapsible
groups. A source with one row stays a plain row, and a filter opens every group.
Hook conflicts block `sync --all` for every resource kind; resolve them with the CLI or
dashboard, then Sync again.

## Tests

Upstream's tests (`herdr/tests/*.test.mjs`, `make test-herdr`) live in the runkids/skillshare
repository. They were not copied here and have not been run against this fork. `model.js`,
`jobs.js`, `channel.js`, `operations.js` and `loader.js` still have no Herdr imports. Check
`main.js` with `herdr-app check`.
