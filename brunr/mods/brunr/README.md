# Brunr

A dialog for Herdr that lists Bruno Collections as a tree, runs their Requests with the Bruno CLI and shows each Response beside the tree. It opens over the window or as its own tab. It reads and runs. It never edits a Collection.

This file is the reference. What the mod offers and how to install it is in the page one folder up.

## Config

`brunr.json` in the Herdr app home (`~/.config/herdr-app/brunr.json`). With no file, Brunr reads Bruno desktop's default workspace and nothing else. It lives in the app home so it never travels with the mod folder.

```json
{
  "workspace": "/home/dev/.config/bruno/default-workspace/workspace.yml",
  "collections": [
    { "path": "C:/dev/shop/api-collection" },
    { "machine": "wsl", "path": "/home/dev/shop/collections" },
    { "machine": "buildbox", "path": "/srv/shop/api-collection" }
  ]
}
```

- `workspace`: the path of a `workspace.yml` on this computer. Optional. It replaces the default workspace path.
- `collections`: a list of entries, each with a `path` and an optional `machine`.
- `machine`: the name of a Herdr Machine that holds the Collection. Leave it out for this computer.
- `path`: a Collection root, or a folder whose direct child folders are Collection roots. It is a path on that Machine, and Brunr does not translate a path between Machines.

A bad entry is left out and a notice above the tree names it. A file that is not valid JSON gives the defaults and a notice with the parse error.

## Where Collections come from

1. Bruno desktop's workspace file. The default path is `<home>/AppData/Roaming/bruno/default-workspace/workspace.yml` on Windows, `<home>/Library/Application Support/bruno/default-workspace/workspace.yml` on macOS and `<home>/.config/bruno/default-workspace/workspace.yml` elsewhere. Its Collection paths may be relative to the workspace folder. These Collections are always on this computer.
2. The entries of `brunr.json`, after the workspace ones.

A Collection listed twice (same Machine and same root) shows once. A Collection is a folder holding `opencollection.yml` (the YAML format) or `bruno.json` (the bru format). A Collection shows under its own name, else its folder's name. When the Collections sit on more than one Machine, each Machine gets a heading, and "This computer" is the name for this one.

The tree stays current in two ways:

- Collections on this computer are watched, and a change in the folder reloads that Collection.
- Collections on another Machine are read again every 30 seconds.

The reload button, `ctrl-r`, the palette entry "Brunr: Reload" and the `brunr.reload` command read `brunr.json`, the workspace, every Collection and the CLI check again.

Brunr reads only the files it needs from a Collection: the config file, and the Request, folder and Environment files of the Collection's format (`.yml` or `.bru`). Dot files, dot folders and `node_modules` are never listed or read, so `.env` is never opened. It reads at most 2000 files per Collection.

## Environments and secrets

An Environment is a file in the Collection. Its name is the file name without the extension, which is what `--env` takes.

- The Environment chip on a Collection row and the `e` key pick the Environment of that Collection. "No Environment" is a choice.
- Until a choice is made, or when the chosen Environment no longer exists, the Collection's default Environment is used.
- The choice is remembered per Collection.

A Global environment is a file in the `environments` folder beside the workspace's `workspace.yml`. Brunr shows a "Global environment" row above the workspace's Collections when that folder has any. One choice per workspace applies to all of its Collections, and a Run passes `--global-env` and `--workspace-path`. Collections that came from `brunr.json` get no Global environment.

Secrets:

- The CLI cannot read secrets stored in Bruno desktop.
- Change a secret variable to a normal variable whose value is `{{process.env.NAME}}`, and put the value in the Collection's `.env`. Bruno desktop reads that too.
- Brunr warns on an Environment that still has secret variables. The warning shows on the chip, in the picker and in the details under the tree, and names the variables.
- Brunr reads only variable names from Environments. It never reads a `.env` file. The CLI reads it during a Run.

## Runs

A Run is one `bru run` on the Collection's Machine, started with the Collection root as the working directory:

```text
bru run [path] [-r] [--env NAME] [--global-env NAME --workspace-path DIR] --reporter-json FILE
```

- A Request Run passes the Request file's path.
- A folder Run passes the folder's path and `-r`.
- A Collection Run passes no path.
- On Windows, `bru.cmd` is started on this computer.

The CLI's output goes to a progress file next to the report:

- Not on Windows, `sh -c 'out=$1; shift; exec "$@" >"$out" 2>&1' sh FILE bru run ...` starts it. Every value is a separate argument and no shell reads it.
- On Windows, `node -e` with a fixed script finds `bru.cmd` on the PATH, then in `%APPDATA%\npm` (npm's default global folder), reads the CLI's script path out of it and starts that script with `node` itself, the way the npm shim does. No `cmd.exe` is involved, so `%`, `&`, quotes and parentheses in a path or Environment name are passed as they are. When the script cannot be found next to `bru.cmd`, Brunr starts `bru.cmd` directly as before, and that Run shows no progress.
- The CLI's exit code and its whole output still reach the result.

Rules:

- A Request Run times out after 60 seconds, and a folder or Collection Run after 10 minutes. A timed-out Run shows "The Run timed out."
- One Run goes at a time across the whole mod. The Run button hides while a Run is in progress, and a Run key says "A Run is in progress".
- A Run cannot be cancelled. Closing the dialog during a Run ends its result with "Brunr was closed before the Run finished."
- A Request Run starts at once. A folder or Collection Run first asks `Run 4 Requests in "Products" against local?` in a picker over the dialog, with "Run 4 Requests" and "Cancel". Enter picks and Esc cancels. A folder with no Requests says so and runs nothing.
- `p` runs the selected Request with other values for the `{{variables}}` in its URL. A form has one box per variable, each marked "from the Environment", "secret in the Environment" or "not in the Environment". An empty box keeps the Environment's value. Each filled box is passed as `--env-var NAME=VALUE` for that Run only. The boxes remember what was typed until the dialog closes. Nothing is saved, and Environment values are never read.
- Runs are off for a Machine where `bru` does not start. At start and on reload Brunr runs `bru --version` and `node --version` on each Machine, with a 20 second timeout. A notice then gives the step: install Node.js first when it is missing, else `npm i -g @usebruno/cli`. It has a Copy button.
- Each Run writes the CLI's JSON report and a progress file, and deletes both after reading them. On this computer they are `data/brunr/run-*.json` and `run-*.log` in the app home. On another Machine they are `/tmp/brunr-*.json` and `/tmp/brunr-*.log`.
- A report or progress file left behind by a timed-out Run is deleted at the next Run. Brunr also deletes `run-*.json` and `run-*.log` files left by an earlier session when it starts.

Progress during a folder or Collection Run:

- While the CLI runs, Brunr reads the progress file every 500 ms and redraws only when it changed. The CLI writes one line as each Request finishes, such as `products/List Products (200 OK) - 23 ms`.
- Brunr works out the order the CLI sends the Requests in, so it can name the Request that runs next. In each folder the CLI sends the subfolders first, sorted by name and then moved to their `seq` place, then the Requests by `seq`, a missing `seq` counting as 1. When the finished Requests do not match that order, the running Request is not named and only the counts and the finished list show.
- A finished Request's live mark comes from its HTTP status only: ✓ for 2xx and 3xx, ✗ otherwise. Assertions and tests are not shown live. The final result replaces the live list, so a Request can change from ✗ to ✓ or back.

A Run's output shows on the Response side of the dialog, right of the tree. The last Run is kept in memory, so closing and opening Brunr shows it again.

## The Response side

A Run of one Request shows:

- A top line with the Request's name, method and URL, then the status with its text, the time and the size.
- Four views: Response, Headers (with the count), Timeline and Tests (passed over total). The Tests label turns red when anything failed.
- Response is a read-only editor with syntax colours for JSON, HTML and XML. A body over 400000 characters is cut.
- Timeline shows the Request as it was sent: resolved URL, headers and body, then the status and time.
- Tests lists each assertion and each script test with its error text.

While a folder or Collection Run is in progress, the Response side shows:

- A summary line with a spinner and `4 of 16`.
- The list of finished Requests as they finish, each with its mark, method, name and status, grouped under their folders as described below. The running Request is the last row, with a spinner in place of the mark, and each folder that holds it shows a spinner beside its count. Request rows cannot be selected until the Run ends.
- When the Run ends, it shows the result as below, with the same rows and folds, so the list does not jump.

A single Request Run shows a spinner until it ends.

A folder or Collection Run adds:

- A summary line with the number of Requests, passed, failed and skipped, and the total time.
- A list of Responses, each with a pass or fail mark, method, name and status. A Request with no response shows `ERR`. The first failed Response is selected, else the first.
- The list sits left of the views when the Response side is 640px wide or more, and above them when it is narrower.

The list is a tree, as on the left:

- Each Request sits under the folders it belongs to, indented by depth. Each folder with a listed Request beneath it has a row before its first Request, with an arrow, its name and `<passed>/<total>` at the right. The count is red when any Request beneath it failed, else green.
- The Run target gets no row. A `products` Run shows `top sellers` as a folder row and the Requests directly in `products` at the top level. A Collection Run shows its top-level folders as rows. A Run whose Requests all sit directly in the target has no folder rows.
- During the Run, total is the number of Requests planned beneath the folder and passed counts finished Requests with a 2xx or 3xx status. In the result, both count the listed Responses.
- Clicking a folder row folds or unfolds it. Folders start unfolded. Folds last for that Run only and reset when a new Run starts. When the Run ends, the folders holding the selected and the first failed Request unfold.
- Requests keep the order the CLI ran them in. If one folder's Requests are not consecutive, the folder gets a new row each time it starts again, so no Request shows under the wrong folder.
- A Request missing from the Collection tree is placed by the directories in its path. A folder is named by its folder file, else by its directory name.

A finished Run with more than one Request has a toolbar above the list. Left to right:

- A `Search` field. It keeps the Requests whose name, path or URL holds every word typed, ignoring case.
- Each control below shows a fixed label before its value: `Result`, `Status`, `Method` and `Sort`. The defaults read `Result All`, `Status Any`, `Method Any` and `Sort Run order`. The label stays in the muted colour.
- A result control that cycles on click through `All`, `Failed` and `Passed`. Failed means the same as the mark: a failed assertion or test, a network error or a CLI error. The HTTP status alone never fails a Request.
- A status control that cycles through `Any`, `2xx`, `3xx`, `4xx`, `5xx` and `Error`, which keeps the Requests that got no response.
- A method control that cycles through `Any` and the methods that occur in this Run. The common methods come first in the order GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, then any others alphabetically. A Request that is not HTTP counts under its type, for example `GRPC`.
- A sort control that cycles through `Run order`, `Slowest`, `Fastest`, `Status` and `Name`.

How the toolbar works:

- The four filters combine. A control away from its first value has its value drawn in the accent colour. When the Response side is narrow, the text field shrinks first.
- Sorting keeps the folder tree. Requests are sorted inside their own folder and folders keep their Run order. `Slowest` and `Fastest` use the response time and `Status` the status number, with Requests that got no response last. `Name` ignores case. Ties keep the Run order.
- A folder with no Request left is hidden, nested folders too. Folder counts always describe the whole Run, so a filter never changes them.
- The summary line adds `showing <n> of <total>` while a filter is on.
- When nothing matches, the list says `No Requests match.` with a `Clear filters` button that resets the four filters and keeps the sort.
- When the selected Request is filtered out, the first one shown is selected.
- The filters and sort stay as they are for later Runs until the dialog closes, so `Failed` stays on while a folder runs again. The one exception is the method: when a new Run ends and the chosen method does not occur in it, the method goes back to `Any`.
- While a Run is in progress the toolbar is disabled and the live list shows every Request in Run order, since pass and fail are not known yet.

When the CLI sends no Request, or fails before it starts, the Response side shows its message in a box. Open file shows a Request's file there, read only.

Everything on the Response side is held in memory. It is never written to disk.

## Keys

`ctrl-shift-u` (in `keys.json`, `mod.open:brunr`) opens Brunr as a dialog or a tab, as the settings say. Pressed again, it closes the dialog, or goes back to the tab you came from. The palette entry "Brunr: Open" does the same.

In the dialog, the keyboard is on the tree or on the Response. `ctrl-h` puts it on the tree and `ctrl-l` on the Response. The selected tree row is dimmer while the Response has it.

| Key | Action |
|---|---|
| `up` / `k`, `down` / `j` | previous / next row in the tree, or previous / next Request of a Run on the Response side |
| `home` / `end` | first / last row |
| `left` / `h` | fold the Collection or folder, else go to the parent row |
| `right` / `l` | unfold, else go to the first child |
| `enter` | run a Request, fold or unfold a Collection or folder, pick on the Global environment row |
| `r` | run the Request, folder or Collection |
| `p` | run the Request with other values for its URL's `{{variables}}` |
| `e` | pick the Environment (or the Global environment on its row) |
| `o` | open the Request's file on the Response side |
| `y` | copy the Request's URL |
| `b` | open Bruno desktop (Collections on this computer only) |
| `1` to `4` | Response, Headers, Timeline or Tests view |
| `/` | search a Run's Requests |
| `f` | fill the window, or leave full screen (dialog only) |
| `ctrl-r` | read everything again |
| `?` | show or hide the key list |
| `,` | open the settings |
| `ctrl-x` | close the tab (tab only) |
| `esc` | close a picker, the form, the settings or the Search box, else close the dialog |

`r`, `p`, `e`, `o`, `y`, `b`, `f` and `ctrl-r` can be switched off or moved to another key in the settings. The other keys always work. Each key is also a command: `herdr-app do brunr.<command>`.

In a picker: `up` / `k` / `ctrl-k`, `down` / `j` / `ctrl-j`, `enter` or `space`, and `esc`. In the "run with values" form: `tab` / `down` and `shift-tab` / `up` move between boxes, `enter` runs and `esc` closes.

Mouse:

- Click selects a row. Double-click runs a Request or folds a Collection or folder.
- The arrow folds. The Run button at the top runs the selected row.
- The Environment chip opens the picker.
- Right-click opens the row's menu over the dialog, each item with its key: Run, Run folder or Run Collection (when a Run can start), Open file, Environment, Global environment, Open Bruno (this computer only), Copy URL, Copy path and Reload. Copy path copies the Collection root, or the file or folder inside it, as a path on its Machine. The menu takes the picker keys.
- The title row also has reload, full screen (dialog only) and the settings gear.

Command palette entries: "Brunr: Open" and "Brunr: Reload".

## Settings

The gear or `,` opens them:

- Open as a tab instead of a dialog. Switching it moves Brunr at once.
- Open the dialog in full screen.
- Show key hints. Off hides the key list under the dialog. `?` shows it again.
- A switch per shortcut key, and the key it is on.

## State

- Shared state holds the settings and what used to be in localStorage: which Collections and folders are unfolded, the Environment chosen per Collection (keyed by Machine and root) and the Global environment chosen per workspace file. Every copy of the mod reads the same values, since each dialog and each tab is a new copy. The keys are `brunr.saved.<name>`, `brunr.open-as`, `brunr.back` (the tab to go back to) and `brunr.dialog` (the open dialog).
- Collections start unfolded and folders folded until you change them.
- Folds in the Response side's list are held in memory for one Run.
- The filters and sort are held in memory until the dialog closes. They are never written to disk or shared state.
- The last Run is held in memory, in module code, so it outlives the dialog.
- Runs and Responses are never written to disk. The report and progress files are the only exception, and they live for the length of one Run.

## Limits

- Requests with prompt variables are skipped by the CLI.
- OAuth2 works only for the `client_credentials` and `password` grants.
- A YAML file the CLI cannot parse aborts the whole Run, for example an unquoted value containing a colon followed by a space. Brunr's own reader is more forgiving, so the tree can show a Request the CLI will not run.
- A file Brunr cannot read adds to a count on the Collection row, and the details under the tree name the first five.
- There is no cancel for a Run.
- Run progress shows HTTP statuses only. Assertion and test results appear when the Run ends.
- The running Request is named only while the CLI sends Requests in the order Brunr expects. Requests with the same `seq` keep the folder's listing order, which Brunr takes as the file name ignoring case, as Windows lists files. Another Machine may list them in another order.
- On Windows, a timed-out Run may leave the CLI running until it ends by itself, since Brunr ends the `node` that started it.
- Secrets stored in Bruno desktop are empty in a CLI Run (see Environments and secrets).
- On Windows Brunr finds `bru.cmd` on the PATH Herdr was started with, or in `%APPDATA%\npm`. Herdr cannot start a `.cmd` file by name, so the CLI check and each Run start the CLI's script with `node`, and `node` must be on that PATH. A `bru.cmd` installed elsewhere and missing from that PATH shows the missing CLI notice.
- Bruno desktop cannot be told to open a specific Request, so "Open Bruno" only starts the app. Brunr looks for it at `<home>/AppData/Local/Programs/Bruno/Bruno.exe` on Windows, `/Applications/Bruno.app` on macOS and `bruno` on the PATH elsewhere.
- Collections on another Machine are listed and read with `sh` and `cat`, so that Machine needs both.
- A Global environment applies only to Collections listed in the workspace file.
- Paths are used as the Machine gives them. A Collection on WSL is not the same Collection as the same folder seen from Windows.

## How it works

The key opens a tiny overlay copy of the mod that opens Brunr as a dialog or a tab, as the settings say, and closes at once. Each dialog and each tab is a new copy of the mod.

- `main.js`: the entry. Draws the dialog and the tree, loads and watches Collections, handles keys, clicks and Runs, and holds the pickers and the "run with values" form.
- `response.js`: draws the Response side.
- `tree.js`: the rows, the key map, the URL variables and the confirmation and secret texts. No Herdr calls.
- `runtree.js`: the Run list as rows of folders and Requests, with counts and folds, for the live list and the result alike. No Herdr calls.
- `runfilter.js`: the filters and sort. Takes a finished Run's Responses and gives the Requests to list, in order, with the whole Run's folder counts. No Herdr calls.
- `store.js`: saved state and the in-memory Run store.
- `sources.js`: reads `brunr.json` and the workspace and finds Collection roots. Loads one Collection.
- `machine.js`: every `exec`, `readTextFile`, `watchFolder` and `fs` call. Lists and reads files, checks the CLI, runs `bru` with its output going to the progress file, reads that file on a `cx.timer` while the Run is in progress, reads and deletes reports and progress files and starts Bruno desktop.
- `plan.js`: turns a target, the chosen Environments and any "run with values" values into the `bru run` arguments, and lists the Requests a Run sends in the CLI's order. No Herdr calls.
- `progress.js`: turns the progress file's text into the finished Requests and the running one. No imports.
- `report.js`: turns the CLI's JSON report, exit code and output into Responses. No Herdr calls.
- `parser.js` and `yaml.js`: read Collection files in both formats and a small YAML subset.
- `kit/`: shared UI pieces: the frame, list rows, controls, the key legend, the settings panel and opening as a dialog or a tab.
- `icons/`: the SVG icons.

Tests are in `brunr/tests/` in the repo and run with `sh brunr/tests/run.sh`.

