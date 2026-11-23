# herdr-mods

Mods and layouts for the Herdr desktop app. Each top-level folder is one share.

## Language

### Wranglr

**Wranglr**:
The mod that draws the spaces list in the sidebar, sorted into Groups, and keeps the Workspaces.

**Space**:
Herdr's place to work on one Machine, holding tabs and panes.
_Avoid_: session, window

**Machine**:
A host that Herdr runs spaces on: this computer, WSL, or an ssh remote. A space belongs to exactly one Machine.
_Avoid_: host, server, remote

**Repo**:
A git repository, identified by its normalised remote URL, or by the basename of its root when it has no remote. Clones and worktrees of it on any Machine are the same Repo.
_Avoid_: project, checkout

**Workspace**:
A curated, named list of Repos that tasks commonly need together. It exists with no spaces open and covers every Machine.
_Avoid_: project, profile, multi-root

**Workspace home**:
The directory on one Machine that a Workspace's spaces start in, and where files that belong to the Workspace as a whole are kept.
_Avoid_: root, base directory

**Group**:
A container of spaces in the sidebar. It is one of three kinds: Workspace group, Repo group, or Custom group.
_Avoid_: folder, directory, section

**Workspace group**:
The Group that holds the spaces of one Workspace.

**Repo group**:
The Group that holds the spaces working in one Repo alone. It exists whether or not that Repo is also in a Workspace.

**Custom group**:
A Group the user makes and names, filled only by hand.
_Avoid_: space folder, manual folder

**Subgroup**:
A named division inside a Group, filled only by hand. A Subgroup holds spaces and nothing else.
_Avoid_: subfolder, subdirectory

**Loose space**:
A space in no Group. Loose spaces sit below every Group.
_Avoid_: ungrouped, orphan

### Dockr

**Dockr**:
The mod that shows Docker containers in a side panel and sets which Source each Service of a Stack runs from.

**Stack**:
One Docker Compose project that Dockr is configured to manage. Containers outside every Stack are shown but not managed.
_Avoid_: project, environment

**Service**:
One named entry of a Stack's compose file, run as one container.

**Source**:
The checkout a Service is built from and bind-mounted from: its Repo's main checkout or one of its worktrees.
_Avoid_: volume source, volume, path

**Switch**:
Changing a Service's Source. Other Services whose Repo has a worktree on the same branch can move in the same Switch, and every Service not named keeps its Source.
_Avoid_: repoint, remount, stack switch

**Drift**:
The state where a Service's container runs from a different Source than the one the Stack is set to.

**Main checkout**:
The original clone of a Repo, which its worktrees hang off. It can have any branch checked out.
_Avoid_: main, main branch

### Brunr

**Brunr**:
The mod that lists Bruno Collections in a side panel, runs their Requests, shows each Response in a pane, and edits their Requests, folders and Environments.

**Collection**:
One Bruno collection: a folder of Requests with its own Environments, on one Machine. Its Runs execute on that Machine. It is not tied to a Repo or a space, and a copy on another Machine is a different Collection.
_Avoid_: project, workspace, suite

**Request**:
One saved API call in a Collection.
_Avoid_: endpoint, call, query

**Environment**:
A named set of variables in a Collection that a Run resolves its Requests against.
_Avoid_: env, profile, config

**Global environment**:
A named set of variables shared by every Collection of one Bruno workspace, chosen once for that workspace and applied on top of each Collection's Environment.
_Avoid_: workspace environment, shared env

**Draft**:
The unsaved edits to one Request. A Draft is not part of a Run until it is saved.
_Avoid_: dirty state, pending changes, buffer

**Run**:
One execution of a Request, a folder of Requests, or a whole Collection against one Environment, on the Collection's Machine.
_Avoid_: execution, send, test run

**Response**:
What one Request returned in a Run: status, headers, body, timing, and its test results.
_Avoid_: result, output

### Gitr

**Gitr**:
The mod that shows one Repo's Branches and Worktrees on one Machine, with the spaces working on them, and acts on them.

**Worktree**:
A linked worktree of a Repo on one Machine, in its own directory apart from the Main checkout. The Main checkout is not a Worktree.
_Avoid_: checkout, working copy

**Branch**:
A local branch of a Repo on one Machine, or a remote branch that no local branch tracks. It is checked out in the Main checkout, in one Worktree, or nowhere.
_Avoid_: ref, head

**Occupied**:
A Main checkout or Worktree is Occupied by each space whose first terminal is in its directory. A space occupies one of them at most.
_Avoid_: active, in use, open

### Wayfindr

**Wayfindr**:
The mod that shows a Board and the user's open Pull Requests, and starts Herdr spaces from Tickets and Pull Requests. It lives outside any space.

**Profile**:
A named, separate set of Accounts, such as Work or Personal. Wayfindr shows exactly one Profile at a time.
_Avoid_: workspace, environment, context

**Account**:
One signed-in identity on one Provider, belonging to one Profile.
_Avoid_: login, connection, credential

**Provider**:
An external work-tracking or code-hosting service Wayfindr reads from: GitHub, Azure DevOps, or ClickUp. Each Provider plugs into one shared Wayfindr flow and never owns its own end-to-end path.
_Avoid_: integration, service, source

**Board**:
A Provider's view of active work, shown as the Provider shows it today: a GitHub Projects board, an Azure DevOps team board or sprint board, or a ClickUp List. Backlogs are not Boards.
_Avoid_: project, kanban, backlog

**Followed Board**:
A Board the Profile lists, so Wayfindr shows it. Settings ticks a Board to follow it and unticks it to stop.
_Avoid_: active board, selected board, subscribed board

**Column**:
One stage of a Board. Its name and order come from the Provider's board, or from the Board's Tracked Statuses when it has them.
_Avoid_: lane, status bucket

**Tracked Statuses**:
An ordered list of Provider states the user picks for a Board. Each state becomes one Column, left to right in the saved order, on any Provider.
_Avoid_: status filter, custom columns

**Ticket**:
One work item on a Board, whatever the Provider calls it (issue, work item, task).
_Avoid_: item, card, task, issue, work item

**Move**:
Changing the Column a Ticket is in. It was the first write Wayfindr supported; title edits and comments followed.
_Avoid_: transition, status change

**Pull Request**:
An open or draft pull request the user authored or is asked to review, in GitHub or Azure DevOps.
_Avoid_: PR list item, merge request

**Repo Filter**:
Which repos' Pull Requests an Account shows: All, Selected (only the listed repos) or Ignored (every repo but the listed ones).
_Avoid_: whitelist, blacklist, allow list, block list

**Repo**:
A local clone the Profile lists, with its folder and, once known, the Pull Request repo it clones. A Board names the Repos a Launch makes worktrees from, and a Review uses the Repo whose Pull Request repo matches.
_Avoid_: repository, checkout, project

**Checkout Mode**:
How a Review puts the Pull Request's branch into a Repo: Worktree (a detached worktree at the Repo's Worktree Placement, the default) or Branch (the branch checked out in the Repo's own folder, created from origin when new).
_Avoid_: review mode, clone mode, checkout type

**Worktree Placement**:
Where a Repo's worktrees go: Wranglr's rule for that Repo (the default; Herdr's worktrees folder when Wranglr is not set up), Herdr's worktrees folder, beside the clone, or a folder the user chose. A Launch and a Worktree-mode Review place each Repo's worktree by it.
_Avoid_: worktree root, worktree dir, checkout location

**Template**:
The agent, model, extra arguments and opening prompt a Launch or Review starts with. A Launch Template is the file's default, then the Board's; a Review Template is the default, then the Repo's.
_Avoid_: preset, agent profile

**Review**:
Starting a new Herdr space on a Pull Request's branch, in its own worktree, where an agent checks it against acceptance criteria, security, and code quality.
_Avoid_: PR check, code review session

**Launch**:
Starting a new Herdr space from a Ticket, with a worktree for each repo the Ticket touches and the Ticket as the agent's opening prompt.
_Avoid_: kick off, spawn

### Tiling

**Dwindle**:
A way of adding panes to a tab: each new pane splits the focused pane, alternating side by side and stacked as the split chain gets deeper. Only panes the user adds through Dwindle follow this rule.
_Avoid_: spiral, binary tiling
