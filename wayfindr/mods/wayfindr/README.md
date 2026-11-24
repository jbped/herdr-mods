# wayfindr

Your Boards (kanban) and Pull Requests from GitHub and Azure DevOps, in their own block that covers the terminals while it is open. Start a space from a Ticket, or a review from a Pull Request. Work in progress: GitHub Projects boards and Azure DevOps team boards, with Ticket detail, work today. Pull Requests, Launch and Review are still to come.

## Install

1. Copy `mods/wayfindr/` to `~/.config/herdr-app/mods/` and run `herdr-app check ~/.config/herdr-app/mods/wayfindr`.
2. In your layout (a clone of `main`, not a shipped one), add a hidden Wayfindr block to the `work-body` row, after `panel`:

   ```json
   { "id": "wayfindr", "type": "block", "content": { "mod": "wayfindr" }, "hidden": true }
   ```

   Give it no `size`: it takes the row's remaining width. Keep the ids `wayfindr`, `main` and `panel`: the palette, the key and the tab bar use them.
3. Install the `tabs-plus` share from this repo (its README) and point the layout's `tabs` block at it. It shows a Wayfindr button for the block, and hides the terminals and the side panel while Wayfindr is shown. Without it there is no button and Wayfindr shows beside the terminals. The palette entries still work.
4. Merge this share's `keys.json` into `~/.config/herdr-app/keys.json`: it binds `ctrl-shift-j` to `mod.open:wayfindr` (show Wayfindr and give it the keyboard) and, in a `mod:wayfindr` section, to `wayfindr.close` (hide it while it holds the keyboard). Pick another key if that one is taken, in both places.
5. Create `~/.config/herdr-app/data/wayfindr.json` (below).
6. Sign in where the runner runs commands: `gh auth login`, the per-Profile `az login` that Wayfindr shows (below), or export the token variable for a PAT or ClickUp Account.

## Use

Tab bar: the Wayfindr button. Palette: `Wayfindr: Open`, `Wayfindr: Toggle`, `Wayfindr: Close`, `Wayfindr: Switch Profile`, `Wayfindr: Refresh`. With two or more Profiles, the header shows a switcher for them. Wayfindr shows one Profile at a time, and switching saves it as `activeProfile` in `wayfindr.json` (rewritten as formatted JSON), so it holds across restarts. Open covers the whole work area: the terminals and the side panel are hidden. Close, Esc or the key gives them back, with the side panel as the space had it. Going to another space, by a click, a key or a Launch or Review that opens one, closes Wayfindr. Wayfindr remembers its view (Board, Pull Requests or Settings), Board and Mine choice in every space and across restarts. Click a card to open its detail panel on the right (fields, description, linked Pull Requests, comments). Azure images in the text and attached images show in the panel. Wayfindr saves them through az into `data/wayfindr-images/` in the herdr-app folder, and deletes ones saved over 30 days ago (a Ticket shown again saves them again). Click another card to switch it, or the Board outside the cards to close it. Keys are below, under Keys.

### Background checks

Every `minutes` (default 5), Wayfindr refreshes the Profile's Pull Requests and followed Boards, whether it is shown or hidden. It posts a toast for each Pull Request that newly asks for your review and each Ticket newly assigned to you, up to five of each, plus one toast counting the rest. Clicking a toast opens Wayfindr, and if you open it within two minutes it lands on the Pull Requests view or the Board the toast came from. There is no toast for your own Pull Requests or for items on screen at that moment. An Account that needs a sign-in gets one toast per session. The first check after a start compares with the last saved data, so items that arrived while Herdr was closed are announced once. Settings has a "Background checks" tick per Profile. `minutes` is set in the file.

## Keys

The keys follow CodeyPacker's mods (`run`, `jump`, `branch`) and Dockr, so they are the same letters you use there. The letter keys are off until you tick **Vim keys** in Settings (`"vimKeys": true` at the top of `wayfindr.json`, default false). Off, only arrows, `home`/`end`, `enter`, `esc`, `shift-left`/`shift-right`, `ctrl-n`/`ctrl-p`, `ctrl-d`/`ctrl-u`, `ctrl-r` and the overlay's `v`/`p`/`f` work, Pull Request rows have no letters, and the legend lists the arrow keys. The table below applies with it on. `ctrl-shift-j`, the accent border and the legend work either way. `ctrl-shift-j` (or the palette's `Wayfindr: Toggle`) shows Wayfindr and gives it the keyboard, and pressed again while Wayfindr holds the keyboard it hides Wayfindr and gives a terminal the keyboard. While Wayfindr holds the keyboard its border is the accent color, every Pull Request row has a letter, and a legend at the bottom shows the few keys that apply now. `?` lists every key that works now. A click outside Wayfindr hands the keyboard back. In a text box letters type: `esc` leaves the box and keeps a comment draft (a title edit is cancelled), `ctrl-enter` saves it.

| Key | Action |
|---|---|
| `j` / `k`, `down` / `up`, `ctrl-n` / `ctrl-p` | move |
| `g` / `G` (`home` / `end`) | first / last |
| `ctrl-d` / `ctrl-u` | half a page down / up |
| `enter` | open |
| `ctrl-r` | refresh (the view, or refetch the open Pull Request) |
| `q` | close this layer; at the top, hide Wayfindr |
| `esc` | as `q`, and leaves a text box |
| `?` | every key that works now |
| `v` / `V`, `tab` | the other view: Board or Pull Requests |
| `P` | the next Profile (the legend names it; absent with one Profile) |
| `,` | Settings (`q` or `esc` returns to the view) |
| `o` / `y` | open the selected card or Pull Request in the browser / copy its URL |

- **Board:** `h` / `l` (and `left` / `right`) previous and next Column with cards, `j` / `k` the card in the Column, `H` / `L` (and `shift-left` / `shift-right`) move the card one Column, `s` Launch, `enter` opens the detail panel, which then follows the cursor.
- **Detail panel:** the Board's keys, plus `c` the comment box, `e` edit the title, `m` the Move to list (`j` / `k`, `enter` moves there, `q` closes it). With the Launch card open: `enter` launches, `q` closes the card.
- **Pull Requests:** a cursor over every row (Mine, then Needs my review), a row's letter opens it, `s` Review. The list does not scroll to follow the cursor.
- **Pull Request overlay and pane:** `j` / `k` next and previous file (`k` from the first file is the Overview), `g` Overview, `G` last file, `v` viewed, `c` Checks (the Overview), `p` Post review, `f` fullscreen (in the pane: Herdr's pane zoom, again to unzoom), `s` Review (overlay only), `ctrl-r` refetch, `q` closes the overlay (nothing in a pane: its header closes it).
- **Post review:** `p` or `enter` asks to post when the review is ready, `q` back to the Overview. Then `y` posts, `n` or `q` cancels.
- **Settings:** `q` or `esc` goes back to the last view. Its boxes take letters.
- The legend and the `?` list come from `keys.js`, the same function that decides what a key does, so they never name a key that does nothing.
- `kit/` is CodeyPacker's shared kit (MIT): the letter badges and the legend.

## Pull Request detail

Click a Pull Request row to open it as an overlay over the list, against the right edge, 60% of Wayfindr's width to start. Drag its left edge to resize it, between 30% and 95%; the width is remembered. Under its header, a rail of the PR's files sits on the left and the content on the right. Drag the rail's right edge to resize it, between 140 and 560 px; the width is remembered. The fullscreen button before Close, or `f`, makes the overlay take Wayfindr's whole width with the list not drawn behind it, and the same button or key puts it back. Esc still closes the overlay, and the choice is remembered for the next one.

The rail starts with "N of M viewed" ("All M viewed" when done) and an "Overview" row, then the files in two groups: "Code", then "Tests, docs and generated" (test folders and `.test`/`.spec` files, docs and markdown, lock files, minified, snapshot and build output). Each file row shows its status letter, folder and name, `+added −deleted`, and an accent badge with its review thread count. Click a row to show that file. Click its first cell, or press `v` on the shown file, or use the "Viewed" / "Unviewed" button over its diff, to mark it viewed: the cell turns into a green check. Viewed marks are saved per PR under Herdr's home in `data/wayfindr/viewed/<repo>-pr-<n>.json`, with the PR's head commit: a new push clears them. Without a head commit they last until Wayfindr reloads.

The overlay's keys are under Keys.

The Overview shows what the Ticket panel shows: author, branch into target, reviewers and their state, dates, "Open in browser", the description, the files summary line, and the comments. A file shows its diff with its review threads under the lines they are on: the first comment, then the replies indented. A resolved thread folds to one dim line, "Resolved · author: first line"; click it to open it, and "Fold" folds it again. Comments not on a file, and threads that can't go under a shown row (on no line, outdated, or on a line or file the diff doesn't show), stay in the Overview's Comments with their path and line. Each diff shows as numbered rows in the terminal font: hunk headers, then each line with its line number (the new file's, the old file's for a removed line), a +/− mark and a green or red tint for added and removed lines. Long lines scroll sideways. A file shows 500 rows before "Show N more lines". While it is open the list is dimmed and inert: click the dimmed list, or press Esc, to close it. The Review button is in the row and in the overlay's header.

Checks: the overlay's header shows a badge after the PR's state, "✗ N failing" in red, else "● N running" in amber, else "✓ N passed" in green (skipped checks aren't counted, and a PR with none shows no badge). Click it to show the Overview. The Overview has a "Checks" section between the files summary line and the comments: one row per check, failures first, then running, passed and skipped, each with its mark, `group / name` and its description. Click a row to open its link in the browser. "No checks reported" when there are none. GitHub checks are the head commit's status check rollup: Actions and app check runs (grouped by workflow, else app) and commit statuses. Azure checks are the PR's branch policies (group "Policy", build policies named with their pipeline) and its PR statuses (grouped by genre). In the Pull Requests list, a GitHub row shows a small ✗, ● or ✓ before its title for the rollup's state. Azure rows show no mark, since the list would need one more call per PR.

Files and diffs come from the PR's local clone when Wayfindr knows one: the Profile Repo for the PR's repo, else the one clone of it the clone search found. Wayfindr fetches the PR branch and the target there, and diffs the branch against their merge base; nothing is checked out. The summary line under Files then ends with "diffs from <clone>". A rename shows as a delete and an add. Without a clone, or when git fails (the dim line under the summary says why), the Provider's API gives them:

- GitHub: one GraphQL request for the fields and comments, and the REST files endpoint for each file's patch (up to 300 files, 100 issue comments, 50 review threads).
- Azure: the PR, its threads, the last iteration's changes, and both sides of each file (the merge base and the source commit), diffed by Wayfindr. Up to 50 files are diffed and 100 threads shown; a file over 3000 lines shows no diff.

Each PR's detail (fields, files with their diffs, threads, checks, head commit, and where the diffs came from) is cached under Herdr's home in `data/wayfindr/prs/<repo>-pr-<n>.json`, and opening the PR shows that copy at once. Wayfindr asks the Provider again only when the PR has no cached copy, the copy is older than 30 minutes, or the Pull Requests list says the PR moved: its head commit or (on GitHub) its updated time differs from the copy's. While it does, the header reads "Refreshing…" over the cached copy. `Wayfindr: Refresh`, the header's refresh button, and Refresh in the Review pane always fetch the open PR again, and so does posting a review or a reply. After every fetch of the Pull Requests list, the cached details and viewed marks of PRs no longer in it (merged, closed, or no longer yours or asking for your review) are deleted. When an Account's list fails, nothing is deleted that time. Saved comments under `data/wayfindr/comments/` are never deleted this way: they are your own text.

### Comments and reviews

Click a numbered line in a diff to open a comment box under it. Shift-click another line in the same hunk to stretch it to a range: the range stops at a hunk header, since GitHub takes ranges inside one hunk only, and the rows it covers get an accent edge. Ctrl+Enter or Save keeps the comment (Enter is a new line), Esc or Cancel drops the box, and an empty box saves nothing. A saved comment shows under its last line in an accent box, with "Lines a-b" on a range. Click its text to edit it, or × to delete it. A line that already has a thread or a comment still takes another. The line over the diff counts the file's saved comments.

Saved comments stay on this computer, in `data/wayfindr/comments/<repo>-pr-<n>.json` under Herdr's home, until a review posts them. Nothing leaves the machine until you press Yes.

"Post review (N)" in the overlay's header, or `p`, opens the review screen in place of a file: who it posts as, the saved comments (`path:line` and the text), the verdict, and an optional summary. Verdicts: Comment, Approve, Request changes. On your own Pull Request only Comment is offered, because GitHub refuses the others from the author. A post needs a comment, Approve, or a summary. "Post as <verdict>" asks once more, `Post <verdict> to <PR> as <you> with N comments? Everyone on the PR will see it.`, and Yes posts. After it posts, "Posted. Open on <site>" links to it, the saved comments are deleted, and the PR reloads. If it fails, the error shows and the comments stay. A review goes out as the signed-in account, and Wayfindr can't undo it.

- GitHub: one review through the reviews API, on the PR's head commit. An empty summary is sent as "See the inline comments." (except on Approve). It needs the `repo` scope, which `gh auth login` grants by default.
- Azure: one thread per comment, then the summary as a thread on no file, then your vote: Approve votes "Approved", Request changes votes "Rejected", and Comment casts no vote. A failure part way says how many threads were posted, and the comments that went out leave the saved list, so posting again sends only the rest.

"Reply" under an open review thread opens the same box under it. Save posts the reply at once as the signed-in account, then the PR reloads. A refused reply shows its error under the thread and keeps the text.

### Limits

- A clone diff leaves the ref `refs/wayfindr/pr-<number>` in the clone, updated on each open. Remove it with `git update-ref -d refs/wayfindr/pr-<number>` in the clone.

## Move

The detail panel's "Move to" dropdown moves a Ticket to another Column, and Shift with Left or Right moves the card under the arrow-key cursor one Column over. The card moves at once, then the Board reloads, and a failure puts it back with the error.

- Azure: a Tracked Statuses Column sets the work item's State. A Column of the team's board sets the State that Column maps for the item's type, plus the board's own Column field.
- GitHub: sets the item's Status option. It needs the `project` scope: `gh auth refresh -h github.com -s project`.

## Edit and comment

In the detail panel, Edit beside the title changes it (Enter or Save), and the box under Comments posts a markdown comment. Both reload the Ticket after. GitHub draft issues can't take comments. Writing on GitHub needs the `repo` scope, which `gh auth login` gives by default.

## Launch and Review

- **Launch** (in a Ticket's detail panel) lists the Board's repos (its `repos`, else every repo in the Profile) and marks those with a worktree already. "Add repo…" picks a local clone and adds it to the Profile and the Board. Launch fetches each repo and adds a worktree at its Worktree Placement (below) for the folder `<id>-<slug>`, on branch `<id>-<slug>` from the default branch, then opens a space named `<id> <title>` with the agent, at the worktrees' shared parent folder, else at the first repo's worktree, and the Ticket (description, acceptance criteria, repos) as its first message. Launching again reuses the worktrees (an earlier Launch's folder is found by the `<id>-` prefix, so a title edit keeps it), and selects the space while it is open. Either way Wayfindr closes once the space is open.
- **Review** (on each Pull Request row) needs a clone of the PR's repo. Wayfindr first looks for one among the clones it finds on this machine (the home folder and the folders beside your spaces and other Repos, three folders deep, matched by each clone's `origin` URL; a linked worktree shows as "worktree"), and remembers it as that Repo's `prRepo`. When it finds several, it asks which. When it finds none, it asks for the folder and checks that the folder's `origin` is that repo. It fetches the PR branch, opens a space named `Review <id>` there (closing Wayfindr), and gives the agent a first message holding the acceptance criteria of every linked Ticket (GitHub: the body of each issue the PR closes), else the PR description. Nothing is posted to the PR. PRs from forks aren't supported.
- **Review pane**: when Review opens the space, Wayfindr also opens a pane right of the agent's terminal in it that shows that Pull Request with everything the overlay has (the rail, diffs, threads, checks, line comments, Reply and Post review), so you work the PR beside the agent. The pane is a copy of Wayfindr that shows only that PR: it has no Review, Close or fullscreen button, and Herdr's pane header closes it. Esc in it closes the comment box, the confirm or the review screen, then does nothing. Its viewed marks and saved comments are the same files the overlay uses. Review on a PR whose space is open adds the pane only when that space has no Wayfindr pane yet (one per space). When the space's terminal doesn't show up within 15 seconds no pane is opened; split one yourself. The pane keeps its Pull Request when Herdr is closed and opened again and after a computer restart. Wayfindr also records each pane it opens in `data/wayfindr/panes.json` (its tab, space, Account and PR). A pane whose PR arrives a moment after it opens (a space on another machine) picks it up by itself within 20 seconds. When a Wayfindr pane in a recorded tab comes back without its PR, Wayfindr closes it and opens it again from that record; records of closed tabs are dropped then. Nothing is re-made while every Wayfindr copy has what it needs. `"pane": false` in the Review template turns it off.
- Each Repo has a Checkout mode for Reviews. Worktree (the default): a detached worktree at the Repo's Worktree Placement for the folder `review-<repo>-<number>`, so no local branch is touched. Branch: the PR branch checked out in the clone itself, created tracking `origin` when new, and fast-forwarded when it exists (a local branch that has diverged is left as it was, with a note). A dirty tree that the checkout would overwrite stops it with git's message.
- Each Repo has a Worktree Placement for its Launch and Review worktrees: Wranglr's rule (the default), Herdr's folder (`~/.herdr/worktrees/<folder>/<repo>`), beside the clone (`<clone>-<folder>` next to it) or a folder of your own (`<folder of your own>/<folder>/<repo>`). Wranglr's rule is the pattern Wranglr uses for that Repo (`repos[<identity>].worktrees` in `~/.config/herdr-app/wranglr.json`, else its `settings.worktrees`, else `.worktrees/{branch}`), with `{branch}` the Launch or Review folder name and `{repo}` the Repo's name, and a relative pattern goes under the clone. Without Wranglr set up it is Herdr's folder. A pattern without `{branch}` gets it appended as a last folder, so two worktrees never share a path (Wranglr itself doesn't do this).
- The agent comes from templates: `{ "agent": "claude", "model": "opus", "args": [], "prompt": "…" }`, each field optional. A Review template also takes `"pane": false` (no Review pane, above; on by default). Launch uses `templates.launch` in the file, then the Board's `launch`. Review uses `templates.review`, then the repo's `review`. The defaults run `claude`. The space opens on the Herdr machine that matches the runner (the Profile's `machine`, else the one named after a wsl runner's distro or `wsl`), at the worktree, and the agent starts there in your shell with the Ticket or Pull Request as its first message. Without such a machine the space opens on this computer and the agent starts through the runner in a login shell.

## Settings

The Settings icon (the gear) in the header edits `wayfindr.json` for you, and each change is saved at once:

- Vim keys: turns on the letter keys (Keys, above), saved as `"vimKeys"` at the top of `wayfindr.json`.
- Profiles: add, show, rename, reorder (the switcher follows this order) or remove (with a second click). The last Profile stays. A rename moves the Profile's `az` login folder and copies its cache to the new name (Herdr can't delete files, so the old cache file stays until you remove it).
- Accounts in the shown Profile: add a GitHub user name or an Azure DevOps organization URL, or remove one (its Boards go with it). An Account that needs signing in shows the command.
- Active Boards: the Boards Wayfindr shows. Untick one to stop following it. For an Azure Board, "Edit displayed statuses" lists its states: tick the ones to show as Columns and order them with the arrows (Tracked Statuses). None ticked means the board's own Columns.
- Other Boards: every other Board each Account can see (GitHub Projects, and the Azure boards of every team you're on), with a search box. Tick one to make it active. Each Account's list folds away, and Wayfindr remembers that.
- Local clones: the Repos with their clone folder, Checkout choice (Worktree or Branch) and Placement choice (Wranglr, Herdr, Beside, Folder…). The scan's hits say "worktree" when they are linked worktrees. Find scans for clones again, Pick… chooses a Repo's folder, and Remove drops the Repo (and takes it off every Board).
- Pull Request repos: per Account, All (every repo), Selected (only the ticked repos) or Ignored (every repo except the ticked ones), with a search box. Selected and Ignored keep separate lists, so switching keeps both.

Refresh reloads the lists. A change that would make the file invalid is refused with the reason, and if the file changed elsewhere, Wayfindr reads it again instead of overwriting it.

## Configuration

`~/.config/herdr-app/data/wayfindr.json`:

```json
{
  "activeProfile": "work",
  "profiles": {
    "work": {
      "runner": "wsl:Ubuntu",
      "accounts": [
        { "id": "gh-work", "provider": "github", "login": "<gh user>" },
        { "id": "ado", "provider": "azure", "org": "https://dev.azure.com/<org>", "projects": ["<project>"] }
      ],
      "repos": [{ "id": "frontend", "path": "/home/me/src/frontend", "prRepo": "<owner>/frontend" }],
      "boards": [
        { "id": "team", "account": "gh-work", "ref": { "owner": "<user or org>", "number": 1 } },
        { "id": "sprint", "account": "ado", "ref": { "project": "<project>", "team": "<team>" } }
      ]
    }
  }
}
```

- A Repo is `{ "id", "path" }` plus optional `prRepo` (the Pull Request repo it clones, `"owner/name"` or `"project/repo"`), `review` (a template), `checkout`: `"worktree"` (a detached worktree for each Review, the default) or `"branch"` (the PR branch checked out in the clone itself), and `worktrees`, its Worktree Placement: `"wranglr"` (Wranglr's rule for the Repo, the default), `"herdr"` (Herdr's worktrees folder), `"beside"` (next to the clone) or a folder.
- `runner`: where commands run. `native`, or `wsl:<distro>` (the default on Windows, `wsl:Ubuntu`).
- `machine`: the Herdr machine (from `hc machine ls`) Launch and Review spaces open on, `""` for this computer. Absent, Wayfindr picks the machine named after a wsl runner's distro, else `wsl`, else this computer.
- An Azure Account that `az login` can't reach (an organization on a personal Microsoft account) can use a PAT instead: set `"patEnv": "AZURE_DEVOPS_PAT"` on the Account and export that variable in the runner's `~/.profile` (a login shell reads `~/.bash_profile` instead when it exists). The name must be upper case, at most 40 characters. Wayfindr reads it through a login shell on each refresh and sends it only as a request header. It never stores it. Images in such an Account's Tickets show as links.
- A ClickUp Account is `{ "id": "cu", "provider": "clickup" }`. ClickUp has no CLI, so it reads a personal token (ClickUp Settings, Apps) from the environment variable `CLICKUP_API_TOKEN` (or the Account's `tokenEnv`, an upper-case name) in the runner's `~/.profile` (or `~/.bash_profile` when it exists), on each refresh. It never stores it. A ClickUp Board's `ref` is `{ "list": "<list id>" }`, and Settings lists every List the token can see. Its Columns are the List's statuses. Closed and done tasks show if they closed in the last 30 days. The newest 25 comments show, with a link to the rest.
- A GitHub account's `login` is a user signed in with `gh` (`gh auth status` lists them).
- A GitHub Board's `ref` is the project's owner and number (from its URL, `github.com/users/<owner>/projects/<number>` or `orgs/<owner>/...`). Its Columns are the `Status` field's options, and every item shows (view filters don't apply). Optional: `statusField` and `priorityField` to use other single-select fields, and a Board `name`. Private and org projects may need `gh auth refresh -h github.com -s read:project`.
- Any Board can set `trackedStatuses`, an ordered list of states (Azure `State`, GitHub `Status` values). Each becomes one Column in that order, so two states that share a web-board column show apart, and Tickets in other states are hidden. Case doesn't matter. Leave it out to use the Provider's own columns.
- An Azure Board's `ref` is the `project` and `team`, plus an optional `board` (its name, e.g. `Stories` or `Features`; the team's first board by default). Its Columns are the team board's, in order. Azure has no list of a board's items, so Wayfindr rebuilds it: the board's work item types on the team's area paths, in backlog order, each in the Column the team's board field says. Items in the last Column show if they changed in the last 30 days. Swimlanes are ignored, and "View in Azure" opens the real board.
- Azure Ticket detail converts the HTML fields to markdown. A Bug shows its repro steps where the description goes, and acceptance criteria get their own section. Linked Azure pull requests show with their state. GitHub pull request links show by URL only. The last 100 comments show, oldest first.
- Each Profile has its own `az` login in `~/.config/wayfindr/azure/<profile>` (inside the runner), so two Profiles never share Azure credentials. "Sign in needed" shows the exact `az login` command for it. Every refresh gets a fresh token.
- With several Boards, a switcher shows them. "Mine" shows only Tickets assigned to the Account, and is remembered per Board.
- Each Account's sign-in is checked with `gh auth status` on every refresh. A missing or expired login, or a Board Account without `read:project`, shows "Sign in needed" with the exact command and a button that runs it in a new tab through the runner. gh refreshes only its active account, so for another account the command switches to it and back. The Profile's other Accounts keep working. Press Refresh afterwards.
- Pull Requests lists each GitHub Account's open PRs in two sections: "Mine" (open and draft PRs it authored, drafts marked) and "Needs my review" (open PRs that request its review, directly or through a team). Both come from one GitHub search request per Account, across every repo the login can see, grouped by Account, then repo. Up to 100 per section are shown, with a count of the rest. "Open in browser" opens the PR.
- Azure Accounts list active PRs in the projects of their selected repos, else in every project of the organization (two requests per project): "Mine" uses the creator filter and "Needs my review" the reviewer filter. Azure's reviewer filter matches only you, so PRs that ask one of your teams for a review don't show. Azure has no updated time, so its rows say when the PR was opened. Up to 100 per project and section.
- `prRepos` on an Account filters its Pull Requests: `{ "mode": "selected", "selected": ["owner/name"] }` shows only those, `{ "mode": "ignored", "ignored": [...] }` shows all but those, and leaving it out (or `"all"`) shows every repo. Names are `"owner/name"` for GitHub and `"project/repo"` for Azure. For GitHub the filter applies to the 100 newest matches.
- Board and Pull Request data are cached per Profile in `~/.config/herdr-app/data/wayfindr-cache-<profile>.json`. Refresh loads the shown view: the Board or the Pull Requests. Opening Wayfindr shows the cache at once with its age ("Updated 12m ago"), then refreshes in the background. While Wayfindr shows, it refreshes every 30 minutes. Background checks also run while it is hidden, so D14's "never while hidden" no longer holds. Refresh re-reads the configuration and refreshes now. A failed refresh keeps the cached Board and shows the error.
- `notifications` on a Profile sets the background checks: `{ "enabled": true | false, "minutes": 1..60 }`, on every 5 minutes when left out.
- Wayfindr never stores secrets. A field whose name ends in `token`, `pat`, `password`, `secret`, `accessToken` or `apiKey` (such as `clickupToken`) is rejected. `patEnv` and `tokenEnv` hold a variable's name, not a secret. Sign-in is `gh` for GitHub, `az` for Azure, or an environment variable: `patEnv` for an Azure PAT and `tokenEnv` for ClickUp.

## Tests

From the repo's `wayfindr/` folder: `node --test test/*.test.js`.
