# herdr-mods

Mods for the [Herdr](https://herdr.dev) desktop app. Each folder is one mod, and its page says what it does, what it needs and how to install it.

<!-- shares:start -->
| | |
|---|---|
| [<img src="agents-plus/preview.png" width="360" alt="agents-plus">](agents-plus/) | **[agents-plus](agents-plus/)**<br>Herdr's Agents list with Claude Code's in-process subagents nested under the session that started them. |
| [<img src="brunr/preview.png" width="360" alt="Brunr">](brunr/) | **[Brunr](brunr/)**<br>A side panel that lists your Bruno Collections as a tree, edits and runs their Requests with the Bruno CLI and shows each Response in a pane. |
| [<img src="dockr/preview.png" width="360" alt="Dockr">](dockr/) | **[Dockr](dockr/)**<br>A dialog that lists Docker containers and sets which checkout each compose service runs from: the main checkout or a git worktree. |
| [<img src="gitr/preview.png" width="360" alt="Gitr">](gitr/) | **[Gitr](gitr/)**<br>One Repo at a glance: its Main checkout, Worktrees and Branches, the spaces on each, and one key to go to, start or clean up work. |
| [<img src="notifyr/preview.png" width="360" alt="Notifyr">](notifyr/) | **[Notifyr](notifyr/)**<br>A log of every notification Herdr shows, with a bell that counts the new ones and a list to read them later. |
| [<img src="palette/preview.png" width="360" alt="Palette">](palette/) | **[Palette](palette/)**<br>A command palette that mods can add entries to: your entries, each mod's entries, then every Herdr command with its key. |
| [<img src="tabs-plus/preview.png" width="360" alt="tabs-plus">](tabs-plus/) | **[tabs-plus](tabs-plus/)**<br>Herdr's tab bar with side-panel buttons for Wingman, Vaultr and Wayfindr, and a side panel that is remembered for each space. |
| [<img src="vaultr/preview.png" width="360" alt="Vaultr">](vaultr/) | **[Vaultr](vaultr/)**<br>Read your Obsidian vault inside Herdr: the folder tree, name search, links that open in place, images and backlinks. |
| [<img src="wayfindr/preview.png" width="360" alt="Wayfindr">](wayfindr/) | **[Wayfindr](wayfindr/)**<br>Your Boards and Pull Requests from GitHub, Azure DevOps and ClickUp inside Herdr, with a space started from a Ticket or a Pull Request. |
| [<img src="wingman/preview.png" width="360" alt="Wingman">](wingman/) | **[Wingman](wingman/)**<br>A review pane for what coding agents change: whole-file diffs with Accept and Reject per change, per file or for everything. |
| [<img src="wranglr/preview.png" width="360" alt="Wranglr">](wranglr/) | **[Wranglr](wranglr/)**<br>A spaces sidebar that sorts spaces into Groups: one per Repo, one per Workspace, and Custom groups you fill by hand. |
<!-- shares:end -->

## Install

Tell your agent, with the mod's folder name in place of `<mod>`:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/jbped/herdr-mods/tree/main/<mod>
```

Or follow the by-hand steps on the mod's page.

## License

MIT, see [`LICENSE`](LICENSE). A folder with its own license file keeps that license for the code it came with: `agents-plus` and `wranglr` started from Herdr's mods (Apache-2.0).
