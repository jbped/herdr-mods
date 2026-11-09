# herdr-mods

Mods and layouts for the [Herdr](https://herdr.dev) desktop app. Each folder is one share: grab the ones you want.

## skillshare-wsl

The [skillshare](https://github.com/runkids/skillshare) panel for Herdr, made to work when Herdr runs on Windows and your agents run in WSL. It shows the skills, agents, MCP servers, plugins and hooks your skillshare source holds, what needs an update or a sync, and acts on them.

![skillshare-wsl](skillshare-wsl/preview.png)

Changes from upstream's `skillshare` mod:

- On Windows, the panel runs skillshare inside WSL (`wsl.exe -d Ubuntu`), and converts Windows folder paths to `/mnt/<drive>/...`. Spaces on other machines work as upstream.
- Expanded skill and agent rows show the skill's description from its `SKILL.md` frontmatter.

Needs the skillshare CLI installed in WSL (`~/.local/bin/skillshare`) and set up with `skillshare init`. For a distro other than `Ubuntu`, change `WSL_DISTRO` at the top of `mods/skillshare-wsl/main.js`.

Based on runkids/skillshare's `herdr/skillshare` (MIT, see `skillshare-wsl/LICENSE`).

## wingman

A Cursor-style review pane for coding agents' changes: whole-file diffs with Accept and Reject per change, per file or for everything, undo, rejection notes and comments sent to the agent, syntax highlighting, and editing in the diff. Captures any agent's changes, and every edit Claude Code makes through its hooks. See [`wingman/mods/wingman/README.md`](wingman/mods/wingman/README.md) for install (it adds Claude Code hooks and, on Windows, two user environment variables) and keys.

## palette

A command palette that mods can add entries to: each mod lists its own entries in its `mod.json`, shown first, followed by every Herdr app command with its key. Bind it to `ctrl-shift-p` to replace Herdr's palette. See [`palette/mods/palette/README.md`](palette/mods/palette/README.md).

## agents-plus

Herdr's Agents list with Claude Code's in-process subagents nested under the session that started them. Click a subagent to open its view in Claude Code, and click the parent to go back to `main`. See [`agents-plus/mods/agents-plus/README.md`](agents-plus/mods/agents-plus/README.md) for install (it adds Claude Code hooks) and how it works.

Modified from Herdr's `agents` mod (Apache-2.0, see `agents-plus/LICENSE`).

## tabs-plus

Herdr's tab bar with a side panel that mods can join: Review and Edit buttons for Wingman and a Wayfinder button next to Files and Changes, a remembered width per panel tab, and commands that palette entries use to open a panel tab. Wingman's and Wayfinder's palette entries need it. See [`tabs-plus/mods/tabs-plus/README.md`](tabs-plus/mods/tabs-plus/README.md).

Modified from Herdr's `tabs` mod (Apache-2.0, see `tabs-plus/LICENSE`).

## Install

### Tell your agent

skillshare-wsl:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this layout: https://github.com/jbped/herdr-mods/tree/main/skillshare-wsl
```

### By hand

Copy a share's `mods/<name>/` folders to `~/.config/herdr-app/mods/` and its `layouts/` files to `~/.config/herdr-app/layouts/`, then run `herdr-app check ~/.config/herdr-app/mods/<name>` for each mod.

## Working on these

Herdr only hot-reloads mods that are real folders in `~/.config/herdr-app/mods/`, so edit them there, not in this repo. Linked folders (junctions) load but don't reload on save. Before committing, copy the changes back:

```sh
./sync.sh                  # every share
./sync.sh skillshare-wsl   # one share
```

`sync.sh` copies each mod and layout a share folder already has from the config folder, skipping the files Herdr generates (`gpui-kit.d.ts`, `jsconfig.json`). On WSL it finds the Windows config folder on its own. Set `HERDR_HOME` to use another one.
