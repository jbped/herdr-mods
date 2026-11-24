# Gitr reference

Gitr shows one Repo on one Machine: its Main checkout, every Worktree and every Branch, the state of each, and the spaces on them. It opens as a popup at the top of the window.

## Opening

- `alt-shift-g`, or "Gitr: Open" in the palette, runs `mod.open {"name": "gitr"}`. The same key closes it.
- With no props it shows the Repo of the focused space, resolved from the space's first terminal directory, on that space's Machine. When that directory is in no Repo, it opens the Repo picker.
- A mod can open it on a given Repo with `openOverlay({ mod: "gitr", kind: "popup", at: "top", offset: 40, width: 860, height: 0.75, props: { repo: "<identity>", machine: "<machine>" } })`. Wranglr's "Open in Gitr" does this. `machine` is null or absent for this computer.
- It reads the Repo each time it opens, shows "Reading..." until the first read, and reads again after every action and on `ctrl-r`. There is no timer.

## Keys

| Key | Action |
|---|---|
| typing | filters the list |
| `up` / `down`, `pageup` / `pagedown` (10 rows), `home` / `end` | move the selection |
| `enter` | the selected row's default action |
| `escape` | closes a question, else clears the search, else closes Gitr |
| `ctrl-o` | check out in the Main checkout |
| `ctrl-w` | give the Branch a Worktree and a space |
| `ctrl-n` | new Branch from this row's Branch |
| `ctrl-d` | delete the Branch |
| `f2` | rename the Branch |
| `ctrl-u` | remove the Worktree |
| `ctrl-f` | fetch all remotes with pruning |
| `ctrl-r` | read the Repo again |
| `ctrl-k` | clean up |
| `ctrl-s` | sort: recent, A to Z |
| `ctrl-t` | show: all, with a Worktree, checked out nowhere |
| `ctrl-g` | fold or unfold remote branches |
| `ctrl-p` | switch Repo |
| `ctrl-e` | switch Machine |

The footer lists the selected row's keys, Enter first, then fetch, clean up and refresh. Each footer item is clickable. A click on a row selects it. A click on the selected row, or a double click, runs Enter. The Repo name, the Machine name, the sort, the filter and the remote branches title are clickable too.

In a question: `up` and `down` move, `space` ticks, `a` ticks all or none in the cleanup list, `enter` (or `y` in a confirmation) answers yes, `escape` cancels.

## Rows

- **Main checkout.** Its Branch, its directory, ahead and behind, uncommitted changes and the last commit's age. Enter goes to the first space in it, else starts one there. It has no remove action.
- **Branches.** Every other local Branch. A Branch with a Worktree shows the Worktree mark (`⑂`) and the Worktree's directory, relative to the Main checkout when it is inside it. A Branch checked out nowhere is dim.
- **Detached rows.** A Worktree with no Branch is a `(detached)` row at the end of the Branches.
- **Spaces.** Each space that occupies the Main checkout or a Worktree is an indented row under it, with a dot and a word in its agent status color. A space occupies the deepest checkout that holds its first terminal's directory, on the same Machine. Enter goes to it.
- **Remote branches.** Remote branches that no local Branch has the name of, in a folded section. A search unfolds it.
- **Create.** When the search text is a valid Branch name that no local or remote Branch has, a `Create "<name>"` row comes last.
- **Marks.** `↑n ↓n` ahead and behind (left out when both are 0), `±n` uncommitted changes, `gone` when the upstream was deleted, `prunable` when the Worktree's directory is missing, and the age (`45m`, `3h`, `2d`, `4mo`, `1y`).
- A row whose action is running shows a spinner and takes no other action.

## Actions

- **Enter on a Branch checked out nowhere, a remote branch or a Create row** makes a Worktree with a space, or checks it out in the Main checkout. Standalone, `enter` in `gitr.json` decides. With Wranglr, Wranglr's "+" setting decides. The other one is on its own key.
- **Remote branch.** A local Branch tracking it is made first.
- **New Branch** (`ctrl-n` or a Create row). It starts from the row's Branch, else the remote's default branch fetched first, else `main`, else `master`. It never tracks its start point. A failed fetch shows a warning and the Branch is still made.
- **Check out** runs in the Main checkout only. It asks first when the Main checkout has uncommitted tracked changes or a space in it, and names each space and its status.
- **Stash offer.** With tracked changes, yes stashes them, checks out, then reapplies that stash entry, found by its hash and not by its place in the stack, and drops it. When reapplying fails, the entry stays and a warning names it.
- **Delete** runs `git branch -d`. When git refuses because the Branch is not merged, Gitr shows git's message and asks again, then runs `git branch -D`.
- **Rename** asks for the new name, filled with the old one.
- **Remove Worktree** always asks. The question names the spaces it will close, other terminal panes inside the Worktree (left open) and the uncommitted change count, and offers to delete the Branch too. Then it closes the spaces, runs `git worktree remove` (`--force` only when there are changes) and deletes the Branch when ticked. When a closed space's shell still holds the folder, git drops the Worktree but cannot delete the folder: Gitr warns, leaves the folder for you to delete, and carries on.
- **Fetch** runs `git fetch --all --prune` with a 60 second limit.
- **Clean up** lists every Branch whose upstream is gone (not the Main checkout's) and every prunable Worktree. Ticking a Branch that has a Worktree removes the Worktree too. An item starts unticked when its Worktree has a space in it or uncommitted changes. Yes runs `git branch -D` for each ticked Branch, because a squash-merged Branch is not merged as git sees it, and `git worktree prune` once.
- Gitr closes after an action that takes you to a space, and stays open after any other. A failed action shows git's message as an error toast and reads the Repo again.

## Wranglr and standalone

Gitr uses Wranglr when a `wranglr` block is in the shown layout and Wranglr publishes its Repos.

Workspaces: Gitr reads Wranglr's Workspaces from `wranglr.json`. Opened from a space in a Workspace home, which is in no Repo, it shows the Workspace's name and a Repo picker with that Workspace's Repos first. In every Repo picker a Repo names its Workspaces, so typing a Workspace's name filters to its Repos. Gitr still shows one Repo at a time.

Reading: the last known list shows at once. Branches and Worktrees are read again in a few seconds, then each checkout's change count arrives on its own, because `git status` can take seconds per checkout on a slow disk.

| | With Wranglr | Standalone |
|---|---|---|
| Repos | Wranglr's Repo groups and Workspaces | the Repos of the open spaces |
| New Worktree | Wranglr makes it at Wranglr's worktree location | Herdr's `worktree` dialog makes it at `worktrees.directory` in `settings.json` |
| New space | Wranglr starts it, filed and named by Wranglr | `space.new` in the directory, running `run` from `gitr.json` |
| Enter on a Branch checked out nowhere | Wranglr's "+" setting | `enter` from `gitr.json` |

## Settings

`~/.config/herdr-app/gitr.json`, read when Gitr opens and used standalone only:

```json
{ "enter": "worktree", "run": null }
```

- `enter`: `"worktree"` or `"checkout"`. What Enter does on a Branch checked out nowhere.
- `run`: what a new space runs, as an argv list such as `["claude"]`. `null` runs the Machine's shell.

A missing file gives these defaults. A bad value is replaced by its default and shown as a warning toast.

## Stored state

`~/.config/herdr-app/data/gitr/state.json` keeps the sort, whether remote branches are unfolded, and the last list read for each Repo and Machine (at most 20). The filter resets to all each time Gitr opens. When a read fails, Gitr shows the last list, dimmed and with no actions but refresh, and git's message under the search bar.

## Limits

- No merge, rebase, commit, stage, diff, push or pull.
- It never deletes or renames a remote branch.
- One Repo on one Machine at a time.
- Standalone, the Worktree location is Herdr's one setting. There is no per-Repo location.
- Gitr binds `home`, `end` and `escape` once per load in its own key context so that the search field and Herdr's popup do not take them.

## How it works

- `main.js`: the view. It holds no rules. Rows come from `arrange`, keys and clicks go through `act`, effects run through `runEffects`.
- `model.js`: pure rules. `arrange(world)` gives the sections and rows, `act(world, action)` gives a question or a list of effects. `KEYS` and `LABELS` feed the footer.
- `gitread.js`: reads `git worktree list --porcelain`, `git for-each-ref` and one `git status --porcelain` per checkout, at most four at a time.
- `effects.js`: runs the effects in order and stops at the first failure. It holds the stash procedure.
- `source.js`: the two Repo sources, Wranglr and standalone.
- `repos.js`: Wranglr's Repo resolver, also for WSL paths from Windows.
- `store.js`: `gitr.json` and `state.json`.
- Tests: `sh gitr/tests/run.sh` in the repo. The model tests feed `arrange` and `act` plain data. The other tests run against real temporary git repos with a stand-in for the `herdr` module.
