# Wranglr

A spaces sidebar for Herdr that sorts spaces into Groups. It replaces the shipped `spaces` mod in a layout's spaces block.

There are three kinds of Group:

- A Workspace group for each Workspace in the config file: a named list of Repos you work on together. It always shows, even with no spaces open.
- A Repo group for each git Repo a space works in. Clones and worktrees of the same Repo on any Machine share one group, because a Repo is known by its remote URL. An empty Repo group stays until you dismiss it.
- Custom groups you make and fill by hand.

Any Group can have Subgroups, such as Working and Review. Spaces in no Group are listed last.

Each row keeps the shipped look: the colored avatar, the name, and the repo, branch and ahead/behind counts when they differ from the name. In a Repo group the row leaves the repo out and says the branch, or the worktree's folder when no branch is checked out there. A space on another Machine shows that Machine's name in a small chip. A space on a Machine that is not reachable stays in its place, dimmed. Below the list, each Machine that is not connected gets one line, with Connect for a rebuilt Machine and Copy for its login command.

New spaces are named `<ticket id> <one to four words>` from their branch. When the branch has too many words, a small model call (`claude -p --model haiku`) picks the words from the agent's first title.

## Install

1. Copy `mods/wranglr/` to `~/.config/herdr-app/mods/wranglr/`.
2. In your own layout (clone a shipped one first with `layout.clone`), point the spaces block at Wranglr: `"content": { "mod": "wranglr" }`.
3. Merge `keys.json` into `~/.config/herdr-app/keys.json`. It rebinds `alt-1` to `alt-9`, `ctrl-shift-pagedown` and `ctrl-shift-pageup`, and adds `ctrl-shift-m`.
4. Run `herdr-app check ~/.config/herdr-app/mods/wranglr`.

## Using it

- The header has two tabs. Spaces is the list of Groups. Agents lists every agent under Pinned, Needs you, Working, Done and Idle, each row naming its space. Click an agent to go to its pane. Hover a row for its pin button. The Agents tab shows a count when agents need you.
- Click a row to go to the space. Right-click it for Pin to the top, Show tabs, Move to group, Rename and Close. More opens the shipped space menu.
- A pinned space leaves its Group and shows under Pinned at the top of the list, in the order pinned. Unpin it, or move it to a Group, and it returns to the Group it belongs in. Pinned spaces come first for the select keys.
- A space with more than one tab shows a count at the end of its row. Click it to list the space's tabs under the row. Click a tab to show the space at that tab. Settled tabs are left out.
- Right after a space's name are marks for what its agents are doing: `!` for agents that need you, a spinner for working ones and a dot for done ones, each with a count above one. Idle agents show nothing. Hover for the list. Click the marks to go to the most urgent agent's pane.
- Drag a row onto another row (it lands above, or below when you release on the row's lower half), onto a Group or Subgroup header (it goes to the end), or onto the empty area under the list (it leaves every Group).
- Drag a Group header onto another to reorder Groups. Your drag order shows under the Manual sort.
- Click a Group or Subgroup header to fold it. Right-click a Group for Add subgroup, Rename and Remove (Custom groups), Open in Gitr (Repo groups, when the `gitr` mod is installed), Dismiss (an empty Repo group), Close group and Settings.
- Close group asks first, then closes every space in the Group and its Subgroups and ends their terminals. Pinned spaces and spaces on a Machine that is away stay open. A Repo group goes with its last space and comes back when a space opens in that Repo. Workspace and Custom groups stay. Right-click a Subgroup for Rename and Remove.
- "+" on a Group starts a space there: in the Repo's main checkout, in the Workspace home, or in your home folder for a Custom group. Right-click "+" for Open here, New worktree (Repo groups) and Open on a given Machine. Git needs a few seconds to make a worktree: the Group shows a "Making worktree" row until its space is there.
- A Group's Settings set its Machines in order of preference. A Repo also has its worktree location and the ref new branches start from, and a Workspace its home on each Machine. A Workspace's and a Repo's settings are written to the config file. A Custom group's are kept in Wranglr's state.
- In the header: the sort button cycles Recent, Kind, A-Z and Manual. The folder button adds a Custom group. The gear opens the settings menu, which edits the `settings` block of the config file. "+" is Herdr's own new space.

## Keys and commands

| Key | Command | What it does |
|---|---|---|
| `alt-1` to `alt-9` | `wranglr.select1` to `wranglr.select9` | Go to the space at that position in the list |
| `ctrl-shift-pagedown` | `wranglr.next` | Next space in the list's order |
| `ctrl-shift-pageup` | `wranglr.prev` | Previous space in the list's order |
| `ctrl-shift-m` | `wranglr.move` | Move the focused space to a Group or Subgroup |
| `alt-s` | `wranglr.keys` | Give the list the keyboard (see below) |
| | `wranglr.new` | New space in the focused space's Group |
| | `wranglr.name` | Name the focused space again |
| | `wranglr.fold` | Fold the focused space's Group |
| | `wranglr.pin` | Pin the focused space, or take its pin off |
| | `wranglr.tabs` | Show or hide the focused space's tabs |
| | `wranglr.agents` | Switch between the Spaces and Agents tabs |
| | `wranglr.sort` | Next sort |
| | `wranglr.settings` | Open the settings menu |
| | `wranglr.group` | Open the settings of the focused space's Group |

Every command is also in the palette (the `palette` mod).

### Keys while the list has the keyboard

`wranglr.keys` gives the list the keyboard and puts a cursor on the shown space. `pane.go` alone never stops on the list.

| Key | What it does |
|---|---|
| `j` / `k`, or the arrows | Cursor down, up |
| `g` / `G` | Cursor to the top, the bottom |
| `ctrl-d` / `ctrl-u` | Cursor half a page (6 rows) down, up |
| `enter` | Open the space, tab or agent and give the keyboard back. On a Group or Subgroup: fold or open it |
| `t` | Show or hide the space's tabs |
| `n` | New space in the cursor's Group, as its "+" starts one |
| `/` | Herdr's picker, to find a space |
| `h` / `l`, or `left` / `right` | Fold, open the cursor's Group or Subgroup |
| `C` | Fold every Group while one is open, else open them all |
| `s` / `a` | The Spaces list, the Agents list |
| `esc` or `q` | Give the keyboard back to the pane it came from |
| `?` | Show or hide this list at the bottom of the sidebar |

Herdr moves the keyboard off a terminal one pane at a time, so `wranglr.keys` steps left through the panes to reach the list. `tab` is not used: the window takes it.

## The config file

`~/.config/herdr-app/wranglr.json`. Every field is optional, and a missing file means the defaults with no Workspaces. Wranglr reads it again every 5 seconds. Problems show as one warning line at the top of the list; hover it for the details.

```json
{
  "settings": {
    "sort": "kind",
    "plus": "open",
    "worktrees": "{clone}/.worktrees/{branch}",
    "autoname": true,
    "ticket": "^(?:[a-z]+/)?#?(\\d{2,})",
    "agent": ["claude"],
    "machine": "wsl",
    "agents": true,
    "revive": true
  },
  "workspaces": [
    {
      "name": "Arden",
      "repos": ["dev.azure.com/Org/Proj/frontend", "dev.azure.com/Org/Proj/backend"],
      "machines": ["wsl", ""],
      "on": {
        "wsl": { "home": "/mnt/c/dev/arden", "paths": { "dev.azure.com/Org/Proj/frontend": "/mnt/c/dev/arden/frontend" } }
      }
    }
  ],
  "repos": {
    "dev.azure.com/Org/Proj/frontend": { "machines": ["wsl"], "on": { "wsl": { "path": "/mnt/c/dev/arden/frontend" } } }
  }
}
```

- `sort`: `recent`, `kind`, `az` or `manual`. The header button changes it and writes it here.
- `plus`: what "+" does on a Repo group. `open` starts in the main checkout. `worktree` asks for a branch and makes a git worktree.
- `worktrees`: where a new worktree goes. `{clone}` is the Repo's main checkout on the Machine the worktree is made on, `{branch}` is the branch and `{repo}` is the Repo's name. A pattern must start with `{clone}` or be an absolute path. `..` after `{clone}` is resolved, so `{clone}/../.worktrees/{branch}/{repo}` puts worktrees beside the clone. An absolute path only suits one Machine.
- A Repo can set its own worktree rules under `repos`. A Workspace does not set them for its Repos.
  - `"worktrees"`: that Repo's own location pattern, used in place of the setting.
  - `"from"`: the ref a new branch starts from, such as `"origin/staging"` or a local branch. It is one word and cannot start with `-`. A ref on a remote is fetched first. With no `from`, a new branch starts from the remote's default branch, else `main` or `master`, else what the main checkout has checked out.
  - Example: `"repos": { "github.com/org/repo": { "worktrees": "{clone}/../wt/{branch}", "from": "origin/staging" } }`
- A branch that already exists is checked out as it is. A branch that is only on the remote is tracked. `from` only applies to a new branch.
- `autoname`: name new spaces from their branch.
- `ticket`: a regular expression matched against the branch. Its first group is the ticket id at the start of the name.
- `agent`: what new spaces from "+" run. `null` is a plain terminal. With `claude`, a Workspace space also gets `--add-dir` for each of its Repos outside the Workspace home.
- `machine`: the default Machine. "+" on a Group starts there when the Group has no `machines` of its own, or when none of them is ready. `""` is this computer. Left out, a Group starts on this computer and the header "+" starts where Herdr does. A default Machine that is away or where the Group cannot start is skipped for this computer.
- `agents`: show agent status marks on each space's row. `false` leaves them out.
- `folder`: where the header "+" (and `n` outside a Group) starts a space. An absolute path on the default Machine. Left out or `null`: that Machine's home folder. Not used when the default Machine is away.
- `revive`: resume agents after Herdr's core restarts (see Revive). `false` turns it off.
- A Workspace's `repos` are Repo ids: the remote URL without scheme, user and `.git` (`github.com/Org/Repo`). `machines` lists Machine names in order of preference, `""` being this computer. `on.<machine>.home` sets the Workspace home there. Without it, the home is the folder that holds all of the Workspace's Repos, when there is one. `on.<machine>.paths` says where a Repo is checked out when Wranglr has not seen it there yet.
- `repos` gives the same Machines and paths for a Repo on its own.

Wranglr writes a `<name>.code-workspace` file in each Workspace home, listing the Workspace's Repos found on that Machine.

Its own state (placements, Groups, folds, order, names, pins, open tabs) is in `~/.config/herdr-app/data/wranglr/state.json`.

## For other mods

Wranglr publishes `shared("wranglr.view")` and takes actions through `shared("wranglr.action")`. Send one with `setShared("wranglr.action", { n: (shared("wranglr.action")?.n ?? 0) + 1, action })`. The Wranglr copy in the layout runs each `n` once.

- `wranglr.view.repos`: `[{ identity, name, on: { [machine]: path } }]`, sorted by name. Every Repo with a Repo group (not dismissed) or in a Workspace, and a main checkout on at least one Machine. `on` maps a Machine (`""` is this computer) to the main checkout's path there.
- `{ type: "start", repo, machine, folder }` starts a space in `folder` on `machine` (`null` or left out: this computer), running `agent`. The space is filed by the usual rules, and shows in the Repo group before git answers. A `repo` not in `repos`, or a Machine that is not ready, gives a warning toast and starts nothing.
- `{ type: "plus", group: "repo:<identity>", sub: null, mode: "worktree", machine, branch }` makes a worktree for `branch` and starts a space in it, as "New worktree" does. It works for every Repo in `repos`, also one whose Repo group is dismissed or that is only in a Workspace.

"Open in Gitr" opens the `gitr` mod as a popup at the top, with props `{ repo, machine }`: the focused space's Machine when the Repo is cloned there, else the Group's first Machine.

## Revive

When Herdr's core stops (a reboot, a crash, a core restart), Herdr brings each terminal back as a plain shell in the same space and tab. Its agent is gone. Wranglr resumes Claude Code agents in those shells.

- While a Claude Code agent runs, Wranglr remembers its session id, the folder it was started in, and its terminal's process, in its state file. It reads them from Claude Code's own files under `~/.claude/` on the agent's Machine, when the agent is first seen, when its turn ends and once a minute.
- When Wranglr starts, when a Machine becomes ready and once a minute, it looks at the remembered terminals that have no agent. One that is a new process with nothing running in it was lost and restored, so Wranglr types `cd '<folder>' && claude --resume <session>` into it. Each terminal is resumed once, and a toast says how many were.
- The resumed command keeps `--dangerously-skip-permissions`, `--permission-mode` and `--model` from the original command line. Everything else, a first message included, is left out. The agent resumes idle: nothing is sent to it.
- An agent you exit yourself, or whose terminal you close, is forgotten and not resumed.
- A restored terminal with something already running in it is left alone.
- Only Claude Code agents are resumed, and not ones on this computer under Windows, since reading the session needs `sh`. The session remembered can be up to a minute old.
- `"revive": false`, or the switch in the settings menu, turns it off.

## Limits

- The branch on a row is read where Herdr says the space's first terminal is. A Claude Code agent changes folder inside itself, so for a space whose first agent is Claude Code, Wranglr reads the agent's real folder from Claude Code's own files (`~/.claude/sessions/` and the session's transcript under `~/.claude/projects/`) on the space's Machine. It asks when the agent is first seen, when its turn ends and once a minute. These files are private to Claude Code. When they are missing or change shape, the row shows the terminal's folder as before. Other agents always show the terminal's folder. On this computer under Windows it is not read, since it needs `sh`. Grouping does not use it.
- The keys only reach Wranglr while the sidebar is shown. With the sidebar hidden they do nothing.
- Herdr's own `space.next` and `space.prev` follow Herdr's order, not the list's. Use the Wranglr commands instead.
- Wranglr never reorders Herdr's spaces. Other mods that list spaces show Herdr's order.
