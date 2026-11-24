# Brunr

A dialog for Herdr that lists Bruno Collections as a tree, shows the selected Request beside it to edit, runs Requests with the Bruno CLI and shows each Response. It opens over the window or as its own tab. On this computer it also creates, renames, moves and deletes Requests and folders, and edits Environments and `.env` files.

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

Brunr reads only the files it needs from a Collection: the config file, and the Request, folder and Environment files of the Collection's format (`.yml` or `.bru`). Dot files, dot folders and `node_modules` are never listed or read when the tree loads, so loading never opens `.env`. Only the `.env` editor reads it (see The .env editor). It reads at most 2000 files per Collection.

## Environments and secrets

An Environment is a file in the Collection. Its name is the file name without the extension, which is what `--env` takes.

- The Environment chip on a Collection row and the `e` key pick the Environment of that Collection. "No Environment" is a choice. On this computer the picker also has "Edit…" beside each Environment and "Manage Environments…" at the bottom, which open the Environment editor.
- Until a choice is made, or when the chosen Environment no longer exists, the Collection's default Environment is used.
- The choice is remembered per Collection.

A Global environment is a file in the `environments` folder beside the workspace's `workspace.yml`. Brunr shows a "Global environment" row above the workspace's Collections when that folder has any. One choice per workspace applies to all of its Collections, and a Run passes `--global-env` and `--workspace-path`. Collections that came from `brunr.json` get no Global environment.

Secrets:

- The CLI cannot read secrets stored in Bruno desktop.
- Change a secret variable to a normal variable whose value is `{{process.env.NAME}}`, and put the value in the Collection's `.env`. Bruno desktop reads that too.
- Brunr warns on an Environment that still has secret variables. The warning shows on the chip, in the picker and in the details under the tree, and names the variables.
- The tree and the picker read only variable names. A value is read only when the Environment editor or the `.env` editor opens. The CLI reads `.env` during a Run.

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
- A Request Run starts at once. A Request with a Draft is saved first (see The Request column). A folder or Collection Run first asks `Run 4 Requests in "Products" against local?` in a picker over the dialog, with "Run 4 Requests" and "Cancel". Enter picks and Esc cancels. A folder with no Requests says so and runs nothing.
- `p` runs the selected Request with other values for the `{{variables}}` in its URL. A form has one box per variable, each marked "from the Environment", "secret in the Environment" or "not in the Environment". An empty box keeps the Environment's value. Each filled box is passed as `--env-var NAME=VALUE` for that Run only. The boxes remember what was typed until the dialog closes. Nothing is saved, and Environment values are never read.
- Runs are off for a Machine where `bru` does not start. At start and on reload Brunr runs `bru --version` and `node --version` on each Machine, with a 20 second timeout. A notice then gives the step: install Node.js first when it is missing, else `npm i -g @usebruno/cli`. It has a Copy button.
- Each Run writes the CLI's JSON report and a progress file, and deletes both after reading them. On this computer they are `data/brunr/run-*.json` and `run-*.log` in the app home. On another Machine they are `/tmp/brunr-*.json` and `/tmp/brunr-*.log`.
- A report or progress file left behind by a timed-out Run is deleted at the next Run. Brunr also deletes `run-*.json` and `run-*.log` files left by an earlier session when it starts.

Progress during a folder or Collection Run:

- While the CLI runs, Brunr reads the progress file every 500 ms and redraws only when it changed. The CLI writes one line as each Request finishes, such as `products/List Products (200 OK) - 23 ms`.
- Brunr works out the order the CLI sends the Requests in, so it can name the Request that runs next. In each folder the CLI sends the subfolders first, sorted by name and then moved to their `seq` place, then the Requests by `seq`, a missing `seq` counting as 1. When the finished Requests do not match that order, the running Request is not named and only the counts and the finished list show.
- A finished Request's live mark comes from its HTTP status only: ✓ for 2xx and 3xx, ✗ otherwise. Assertions and tests are not shown live. The final result replaces the live list, so a Request can change from ✗ to ✓ or back.

A Run's output shows on the Response side of the dialog. The last Run is kept in memory, so closing and opening Brunr shows it again.

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

When the CLI sends no Request, or fails before it starts, the Response side shows its message in a box.

Everything on the Response side is held in memory. It is never written to disk.

## The Request column

The dialog has three columns: the tree, the Request column and the Response side. When the dialog is 1150px wide or more they sit side by side, and the Request column and the Response side share the room right of the tree. In a narrower dialog or tab the Request column sits above the Response side, and it is 46px high while it shows nothing. The header's pane button and `shift-f` move an open dialog to a pane, and the same button in the pane moves it back to a dialog. Drafts and the last Response come along. The move waits for a Run to finish, and it asks first when an editor has unsaved edits. In a pane under 760px wide the tree is a 190px strip across the top, with the Request column and the Response side under it. A menu opened with the mouse appears under the button that opened it, and a row's right-click menu appears at the pointer. A menu opened with a key appears at the dialog's top left. The dialog takes 96% of the window's width and 92% of its height, and the tree takes 22% of the dialog, between 240px and 380px. When the Response side is under 620px wide, the Search box of a folder Run sits on its own line with the filter controls under it.

A click on a Request row, `j` or `k` onto one, and `t` show the Request in the Request column. Nothing is sent. `t` and the row menu's Open file show it on its File tab. Selecting a folder, a Collection or the Global environment row keeps the last Request shown, as Bruno keeps a Request's tab open. Double-click and `enter` on the tree still run the Request.

The Request column, top to bottom:

- A bar with the method menu (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS), the URL field and Run.
- A line with the Request's name, its path in the Collection, an `Unsaved` mark while it has a Draft, Save and Discard.
- Notes, when they apply: "Editing works on this computer only.", a read error, and the changed-on-disk line (below).
- Bruno's tabs and the shown tab's content (see The Request form). A Request that does not get the tabs shows its file as text instead, under the line "The form is available for HTTP Requests in YAML Collections."
- The warnings for the text, each with its line. A click on one opens the File tab and moves the cursor to that line.

The keyboard is on the tree, the Request column or the Response side. `ctrl-h` and `ctrl-l` move it left and right, and skip the Request column while it shows nothing. There, `enter` puts the keyboard in the URL field. A field keeps `ctrl-h` and `ctrl-l` for itself, so from a field press `esc` first: it goes back to the tree, and then `ctrl-h` and `ctrl-l` move. Keys typed in a field never run a tree key. `esc`, the save key, `ctrl-h` and `ctrl-l` still reach the dialog.

The bar and the text:

- The method menu changes the method line and nothing else. It is greyed out when the file has no method line.
- The URL field changes the `url` line, and the params follow it (see The Request form). It is greyed out when the file has no `url` line.
- A change to the method or `url` line, in File or by a tab, shows in the bar.
- A Request whose text does not parse cannot run, so Run is off until it parses.

A Draft is a Request's unsaved edits:

- A Request with a Draft has a dot on its tree row and `Unsaved` in the column.
- Drafts are held in memory. They survive switching to another Request and closing the dialog. They are lost when Herdr quits or the mod reloads.
- Discard goes back to the file on disk, read again.

Save (`ctrl-s` from the tree, the column or any of its fields, or the Save button):

- Text with warnings asks first in a picker: `Save "List Products" with a warning?` (or `with 2 warnings?`), each warning with its line, then Cancel and Save anyway. Cancel keeps the Draft.
- The warnings are: text that does not read as a Request, a YAML file whose `info.type` is folder, script or app, a tab in YAML indentation, a key twice in one YAML map, and a plain YAML value that starts with `{{`, `@`, a backtick, `*`, `&` or `!`, or that holds a colon followed by a space. The CLI rejects or misreads these.
- When the text does not read as a Request at all, the question adds "Brunr will list it as a broken file and leave it out of Runs."
- A save writes the file only when it is still the text the Draft started from. When it changed on disk, the question `"List Products" changed on disk` offers Reload from disk (drops your edits) or Overwrite.
- Closing the dialog during a save finishes the file being written. A save that waits on a question stops there, and its Draft stays.

When the shown file changes on disk:

- With no Draft, the Request column shows the new text.
- With a Draft, a line says "The file changed on disk." with Reload (drops the Draft) and Keep mine. Keep mine keeps the Draft, and the next save still asks Reload from disk or Overwrite.

Runs with Drafts:

- Run (the column's button, the title row's Run, double-click, `enter`, `r`, `p`) on a Request with a Draft saves it first by the same path, questions included. When the save is cancelled or refused, nothing runs.
- A folder or Collection Run saves nothing by itself. When Requests in it have Drafts it asks `2 Requests have unsaved changes.` with Cancel, Run without saving and Save and run. Save and run stops at the first Request that does not save, names it and does not run.
- The line under the columns names a Request and never shows its text.

A Request on another Machine opens read-only with the note "Editing works on this computer only." Run still works there. Its tabs show and change nothing: menus and buttons are greyed out, editors are read-only, and text typed into a field goes back to what the file holds.

## The Request form

The form is Bruno's tab strip over the Request's file, plus a File tab that holds the text. It is one view of a Draft, and File is the other.

Which Requests get it:

- A Request gets the tabs when its Collection uses the YAML format, its file's top level reads as a YAML map, and its `info.type` is `http` or missing.
- Every other Request shows only its text, under the line "The form is available for HTTP Requests in YAML Collections." That covers bru Collections, GraphQL, gRPC and WebSocket Requests, and a YAML file broken at its top level.
- An edit in File that changes the type or breaks the top level hides the tabs until the text is fixed.

The tabs, in order, and what each edits:

| Tab | Edits | Fields | Badge |
|---|---|---|---|
| Params | `http.params`, and the query of the `url` line | Query rows (Name, Value), Path rows (Name, Value) | count of enabled params, query and path |
| Body | `http.body` | mode menu, then an editor or rows (Key, Value) | dot when the mode is not No Body |
| Headers | `http.headers` | rows (Name, Value) | count of enabled headers |
| Auth | `http.auth` | mode menu and that mode's fields | dot for Basic Auth, Bearer Token and API Key |
| Vars | `runtime.variables` and the post-response variable entries of `runtime.actions` | Pre Request rows (Name, Value), Post Response rows (Name, Expr) | count of enabled variables of both kinds |
| Script | the before-request and after-response entries of `runtime.scripts` | two JavaScript editors, Pre Request and Post Response, stacked | dot when either holds code |
| Assert | `runtime.assertions` | rows (Expr, Operator, Value) | count of enabled assertions |
| Tests | the tests entry of `runtime.scripts` | one JavaScript editor | dot when it holds code |
| Docs | `docs` | one Markdown editor | dot when it holds text |
| Settings | `settings` | three toggles and two number fields | dot when the Request has `info.tags` |
| File | the whole file | the text, with syntax colours for YAML | none |

- A badge count of 0 shows nothing. A section the form cannot read shows a dot.
- The column opens on the tab used last, and on Params the first time. Only the tab's name is remembered.
- The strip wraps onto more lines when the column is narrow, so every tab stays reachable.
- Every row table has an enabled checkbox, its fields and an × that removes the row. Typing in the empty last row adds a row. A row whose fields are all emptied is removed, because empty rows are not written.

One Draft, two views:

- The Draft text is the only state. A tab draws from the text and File shows the same text. A form edit shows in File at once and marks the Request `Unsaved`. An edit in File shows in the tabs. Save, Discard, `ctrl-s`, Run, the warnings and the changed-on-disk line work the same from every tab.
- A form edit rewrites only its own section, in the shape Bruno writes it. Every other byte of the text stays, including line endings, other sections and keys the form does not know. The form never touches `examples`, `app` or the block of another Request type.
- Bruno's shape: the top-level blocks are `info`, `http`, `runtime`, `settings`, `examples` and `docs` in that order, with a blank line before each. `http` holds `method`, `url`, `headers`, `params`, `body` and `auth`. `runtime` holds `variables`, `scripts`, `assertions` and `actions`. Lists are indented two spaces under their key, and `disabled: true` is the last key of a row that is off.
- A section that does not exist is created where that order puts it. A section that becomes empty is removed, and an `http` or `runtime` block left empty goes with it.
- Inside a section, a row the edit keeps is changed in place, and only the keys whose values changed. Its comments, quoting and unknown keys stay, and so does hand indentation. The line of a value that changed is rewritten, so a comment at the end of that line goes.
- Rows are matched to the old ones by name: the longest common run first, then the same name anywhere, then a one-for-one rename. A new row is written in Bruno's shape. A removed row takes its keys and the comment lines under it with it. A comment above the first row stays.
- Data that equals what the section already holds writes nothing, so opening a tab never changes the file.

"This section can only be edited in File.":

- A tab whose section the reader does not recognise shows this sentence, a warning icon and an Open File button, and no fields. The form never rewrites that section. Fixing it in File makes the tab work again.
- Causes:
  - An auth mode other than No Auth, Inherit, Basic Auth, Bearer Token and API Key, or an API key placement other than header or query.
  - A body that is a file, GraphQL, SPARQL or of an unknown type, and a multipart row that is a file upload.
  - A pre-request variable with a typed value (`value: { type, data }`).
  - A param with no `query` or `path` type, an assertion whose operator is not in the list, a script with no type, and two scripts of one type.
  - A settings value Bruno's reader would drop: a boolean other than true or false, a timeout that is not a number or `inherit`, and a negative or non-numeric max redirects.
  - A hand-written shape: a flow list or flow items (`headers: [{ name: a }]`), a quoted or repeated key, a scalar where a list or map belongs, and a line outside every entry.

Params and the URL field keep each other in step, in both directions, as Bruno does:

- The URL splits at its first `?` outside `{{ }}`. The query params are the `&` pairs after it up to a `#`, split at the first `=` and not decoded. A pair with no `=` has no value and a pair with no name is dropped.
- The path params are the `:name` segments before the `?`, and `:name` inside a segment such as `Items(id=:id)`.
- An edit of the URL field makes the new list: the URL's query params (enabled), then new path params with empty values, then the disabled query params as they were, then the enabled path params the URL still has, as they were.
- This drops the description of every enabled query param, and every disabled path param. A list equal to the old one leaves the params block alone. A file with no params block and a URL with no query or `:name` segment gets only its `url` line changed.
- An edit of the Query table rebuilds the URL: the part before the first `?`, then `?` and the enabled rows that have a name as `name=value`, not encoded, joined by `&`. A `#fragment` is dropped. The table edit keeps the rows' descriptions.
- Path rows come from the `:name` segments. Their names cannot be edited, they have no checkbox, and they cannot be added or removed.
- The Query table shows the file's rows as they are, as Bruno does. A query param that the URL has and no enabled row names is added at the end, so a file whose URL has a query and no params rows shows that query. The CLI sends only what the URL holds, so a row that the URL lacks is not sent until an edit of the table puts it in the URL. A Params edit writes both the rows and the URL, and keeps every param the URL had that you did not remove. A path row stays at a Params edit, even when its `:name` has left the URL.
- Editing the `url` line in File changes that line and nothing else. The params are not rewritten.

Body:

- The mode menu is at the top of the tab, with Multipart Form, Form URL Encoded, JSON, XML, TEXT and No Body, and a ✓ on the current one.
- JSON, XML and TEXT show a code editor. The two form modes show rows (Key, Value), and multipart rows are text only. No Body shows "No Body".
- A mode switch keeps the text between JSON, XML and TEXT and the rows between the two form modes. Any other switch starts empty. No Body removes the `body` block. A switch does not touch headers, and the CLI sets the content type when it sends.
- Prettify, for JSON only, reformats with two-space indents and keeps `{{variables}}` outside strings. When the text is not JSON the tab says "Unable to prettify. Invalid JSON format." and nothing changes.

Auth:

- The mode menu has Basic Auth, Bearer Token, API Key, Inherit and No Auth.
- Basic Auth has Username and Password. Bearer Token has Token. API Key has Key, Value and Add To, which is Header or Query Params.
- Password, Token and the API key Value are masked, one dot per character, with an eye button per field. A reveal ends when the tab or the Request changes.
- Inherit shows "The auth comes from the folder or Collection." and has no fields. Brunr does not look up which folder or Collection it comes from, so Inherit and No Auth have no badge.
- A mode change drops the old mode's fields and writes only the new mode's `type`, as Bruno does. A new Basic Auth writes both fields once either has text, and a new API Key writes `placement: header` at once. After that each field is written as typed.

Vars, Script, Assert, Tests, Docs, Settings:

- **Vars.** Pre Request variables are rows of Name and Value. Post Response variables are rows of Name and Expr, written as Bruno writes them: a `set-variable` entry in `runtime.actions` with a `jsonq` selector and the scope `runtime`. A post-response row that already exists keeps its scope and description. Other entries of `runtime.actions` keep their lines and places.
- **Script.** Pre Request and Post Response are stacked JavaScript editors with Bruno's headings.
- **Tests.** One JavaScript editor.
- Scripts and tests are trimmed when written and left out when empty, as Bruno does. The editor keeps what is typed, such as a trailing newline, while the file holds the trimmed code. A script that differs from the file only by surrounding whitespace leaves the file unchanged.
- **Assert.** Expr, an Operator menu with Bruno's 28 operators in its order (eq to isArray, the list scrolls) and Value. The operators isEmpty to isArray take no value. Their Value cell is greyed out, and choosing one clears the value.
- **Docs.** One Markdown editor. A docs text of only whitespace removes the section.
- **Settings.** URL Encoding, Automatically Follow Redirects and Forward Authorization on Redirect are toggles. Timeout (ms) takes a whole number or `inherit`, and Max Redirects takes a whole number. A text that is not valid shows in red with "Use a number of milliseconds, or inherit." or "Use a whole number, 0 or more." and is not written.
- A Request with no settings block shows Bruno's defaults: URL Encoding off, Timeout `inherit`, Follow Redirects on, Max Redirects 5, Forward Authorization on. The first change writes all five keys. A settings block that lacks a key shows the value Bruno's reader gives it, which is on for URL Encoding and 0 for Timeout.

Where Brunr's form differs from Bruno's:

- The tab strip wraps. Bruno moves tabs that do not fit into a menu.
- The body mode menu is at the top of the Body tab. Bruno puts it at the right of the tab bar.
- Script shows both editors at once. Bruno has Pre Request and Post Response sub-tabs.
- A body mode switch keeps only the text or rows described above. Bruno keeps every mode's content in memory.
- Prettify handles JSON only, and its message shows in the Body tab. Bruno also prettifies XML and shows a toast.
- The API key placement item reads "Query Params". Bruno's reads "Query Param".
- Timeout is one field that takes a number or `inherit`. Bruno has a control to inherit or override, which shows the timeout of its Preferences.
- Not built: description columns, drag to reorder, Bulk Edit, the list of inherited headers, the multipart Content-Type column and file rows, Settings' Tags and Enable App, naming the folder or Collection that Inherit comes from, Auth modes beyond the five, and the file, SPARQL and GraphQL body modes.

## Tree actions

The edit actions work on Collections on this computer. A row of another Machine has no edit entries and no edit keys. The keys act on the selected row while the tree has the keyboard, and the row menu (right-click) lists each action with its key. Each key can be switched off or moved in the settings.

| Action | Key | Rows |
|---|---|---|
| New Request | `n` | Collection, folder, Request |
| New folder | `shift-n` | Collection, folder, Request |
| Clone | menu only | Request |
| Rename | `f2` | folder, Request |
| Delete | `delete` | folder, Request |
| Move to… | `m` | folder, Request |
| Move up, Move down | `ctrl-up`, `ctrl-down` | folder, Request |

A Collection row's menu also has "Environments…" and "Edit .env…" (see The Environment editor and The .env editor). The menu leaves out Move up or Move down when the item cannot move that way.

New Request, New folder, Rename and Clone open a form over the dialog, in the look of the "run with values" form: the fields, a message under each, Cancel and the action's button, and the keys `tab` (next field), `enter` (the action) and `esc` (back). Keys typed while the form is open never run a tree key.

- **New Request** has Name, File name, Method (the seven of the method menu, one click each) and URL, and the button Create. The Request goes in the selected folder, the selected Request's folder or the Collection root. The file name follows the name until you edit it. The Request is numbered last, selected and shown in the Request column. The query params and `:name` path params of the URL are written into the file.
- **New folder** has Name and Directory name. It creates the directory and a folder file holding the name, the number and the auth mode `inherit`.
- **Clone** opens `Clone "<name>"` with the name `<name> copy`, then `<name> copy 2` and so on, after an existing copy suffix is removed. Its number is the count of Requests in the folder plus one.
- **Rename** opens `Rename "<name>"`. The name inside the file always changes. The file or directory name changes only when you edit its field. A folder with no folder file gets one.
- **Delete** asks in a picker `Delete "<name>"?` or `Delete folder "<name>"?`. The detail says "It goes to the trash." or "The folder and the 3 Requests in it go to the trash.", and adds "It has unsaved changes." when it or a Request in it has a Draft. The choices are Cancel and Move to trash. The remaining items in the folder are renumbered.
- **Move to…** opens a picker `Move "<name>" to` with the Collection and its folders, indented, then the Collection root and folders of the other Collections of the same format on this computer. Collection names are bold. The item's own folder is greyed out and skipped by `j` and `k`, and a folder's own subfolders are not listed.
- **Move up** and **Move down** move a Request among Requests and a folder among folders, as the tree shows them.

The trash and permanent delete:

- The trash is the Recycle Bin on Windows, Trash on macOS and `gio trash` on Linux.
- When the trash fails or does not exist, a second question `"<name>" cannot go to the trash` gives the reason, says it cannot be undone and offers Delete permanently. Nothing is deleted permanently without that second answer, and never outside the Collection.

Bruno's naming and numbering rules, which Brunr follows:

- A file name comes from the name: `<>:"/\|?*` and control characters become `-`, leading spaces and hyphens and trailing dots and spaces are removed, and spaces inside stay.
- A name is refused when it is empty, over 255 characters or a Windows reserved device name (CON, PRN, AUX, NUL, COM0 to COM9, LPT0 to LPT9). The reason shows under the field as you type, for example "Name cannot be empty." or "Special characters aren't allowed in the name. Invalid character 'x'."
- A taken file or directory name gets ` 1`, ` 2` and so on, compared ignoring case.
- The items of a folder are numbered 1 to n in one list of folders and Requests. A Request with no number counts as 1. A change writes only the files whose number changed.
- A new Request or folder is numbered one more than the count of folders and Requests in its parent, and a clone one more than the count of Requests in its folder.
- The tree orders each folder as Bruno's sidebar does: folders first, then Requests. Folders sort by name and then move to their number. Requests sort by number, and ties sort by name ignoring case.

Moves:

- A move goes to a folder or the root of the same Collection, or to a Collection of the same format on this computer. The item keeps its file name unless the target has it, and then the clash rule applies.
- The source folder's remaining items are renumbered. The target's items are renumbered only for a drop between rows. A move onto a folder or Collection keeps the item's number.
- A move between Collections of different formats is refused. A drop onto such a Collection says "Not moved: another format." under the columns, with both formats named, and Move to… lists only Collections of the same format.

Drag and drop:

- Drag a Request or folder by its row. The dragged row dims. A drag never selects or runs a row.
- A drop on the middle third of a folder row, or on a Collection row, moves the item in. The row is highlighted with a border in the accent colour.
- A drop on the top or bottom third of a folder row, or the top or bottom half of a Request row, places the item there in that row's folder. A line in the accent colour shows where.
- A row with no highlight or line takes no drop: a folder onto itself or its own subfolders, an item onto the folder it is already in, a drop that changes nothing, and a row of another Machine.
- Esc, or releasing the button away from the rows, cancels the drag.

Running an action:

- While one runs, the title row shows a spinner and another edit action says "Another change is still running." Afterwards the tree reloads, the new or moved item is selected and its folders unfold. A Request that ends up selected shows in the Request column.
- A failed action names the step that failed under the columns, for example "Step 2 of 3 (writing folder.yml) failed: ...", and says how many earlier steps already ran. The tree reloads either way. A form's own error shows in the form, which stays open.
- A rename or move carries the Draft to the new path, with the new name or number made in the Draft too. The Request column follows the Request to its new path, also when it moved with its folder. A delete drops the Drafts under it, and the Request column empties when it showed the deleted Request.

Broken files:

- A Request file that does not parse stays in the tree under its file name, with a warning mark and no method. Its tooltip and the details under the tree show the parse message.
- Selecting it shows it on the File tab, so it can be fixed and saved. It can be renamed (the file name only), moved with Move to… and deleted. It cannot run, be cloned or be moved up or down, and a drop places it at the end of a folder.
- It is not counted in a folder's Requests, not renumbered and not sent in a Run.

## The Environment editor

A Herdr window sits under a dialog, so the editor is drawn inside the dialog, in place of its three columns, until it closes. It opens, for Collections on this computer, from:

- "Edit…" beside an Environment in the Environment picker, on that Environment.
- "Manage Environments…" at the bottom of the picker, and "Environments…" in a Collection row's menu, on the first Environment.

Its title line reads "Environments · <Collection folder>" with a close button. The legend under it shows `ctrl-s` save and `esc` back.

The left side lists the Collection's Environments with New. The selected one has Clone, Rename and Delete, and "Edit .env…" at the bottom switches to the `.env` editor of the same Collection, asking first when there are unsaved edits. The right side is the selected Environment's table:

- Each row has an enabled checkbox, a Name, a masked Value, an eye that reveals that row and an × that removes it.
- The empty last row, "Add a variable", adds a variable when you type in it.
- Show and Hide in the header reveal or mask every value.
- Save and Discard are at the bottom, and `Unsaved` shows in the header while the table has changes.

Rules of the table:

- Every value is masked when a file opens. A mask shows one dot per character. Reveals last until the editor closes.
- A name may hold letters, digits, `_`, `-` and `.`, as in Bruno. An empty or invalid name shows in red and blocks Save. A name used twice shows the warning "Another variable has this name. The last one is used." and does not block Save.
- A save changes the variables and keeps what the table does not show: `extends`, `color` and external secrets in YAML, and the matching blocks in bru. The file is written in Bruno's own shape for its format.
- A save after the file changed on disk shows "<file> changed on disk since it was opened." with Reload (drops your edits) and Overwrite.

A secret variable shows "Secret. Its value is kept by Bruno, not in this file." and cannot be edited. Its row has Move to .env:

- It asks for the name in `.env`, filled in as upper case with underscores (`apiKey` becomes `API_KEY`), and for the value, masked with its own eye.
- It adds `NAME=value` to the `.env` in the Collection folder, creating the file when needed, and rewrites the variable as `{{process.env.NAME}}`.
- When the name is already in `.env`, the question says "NAME is already in .env. Move replaces its value." and the button becomes Replace.
- With unsaved changes in the table, the question adds "Your unsaved changes to local.yml are saved with it.", and Move writes them to the Environment file too.

New, Clone, Rename and Delete ask for a name or a confirmation inside the editor:

- New and Clone take a name. A Clone starts as `<name> copy`, and a taken name gets ` copy`, ` copy 2` and so on. A clone keeps the variables and `extends` and drops `color`.
- Rename changes the file name and the YAML `name:`. Another Environment whose `extends` is the old name alone follows the rename.
- Delete asks `Delete Environment "<name>"?` and moves the file to the trash. When the trash fails, a second question offers a permanent delete.
- The Collection's remembered Environment follows a rename. After a delete of the remembered one, the Collection's default applies again.

Keys and unsaved edits:

- `ctrl-s` (the save key) saves the open editor's file and never a Request's Draft. Once the editor closes, it saves the shown Request's Draft again.
- `esc` cancels an open question, otherwise it closes the editor. Keys typed while an editor is open never run a tree key.
- Closing with unsaved edits (the close button or `esc`), choosing another Environment, "Edit .env…", and New, Clone, Rename and Delete ask "Discard unsaved changes?" with Keep editing and Discard. Discard drops the edits.
- A press beside the dialog, `ctrl-shift-g`, and `ctrl-x` in a tab ask the same question before they close Brunr. Discard closes the editor and then Brunr.
- Quitting Herdr or a mod reload closes the editor without asking, and the edits are lost.
- Nothing is kept as a Draft.

## The .env editor

The `.env` editor is drawn in the dialog the same way. It opens from "Edit .env…" in a Collection row's menu and from the button at the bottom of the Environment editor, for Collections on this computer. Its title reads ".env files · <Collection folder>".

- The left side lists the `.env` and `.env.*` files in the Collection folder, `.env` first. The name must be `.env` or `.env.<letters, digits, . _ ->`. New suggests `.env`, or `.env.local` when `.env` exists. The selected file has Delete, which moves it to the trash, with the same second question when the trash fails.
- Only `.env` feeds a Run. With another file selected, a note says "Only .env feeds a Run. Brunr does not pass <file> to the Bruno CLI."
- The file opens in the Table view: Name and Value (masked), with the same reveal, add and remove as the Environment table and no enabled column. "Raw (shows values)" shows the text itself, unmasked. Switching carries unsaved edits across.
- A table save changes only the lines you edited. Comments, blank lines, order, `export` prefixes and quotes stay. Names and values are read by dotenv's rules. A table save masks every value again.
- A Raw save writes the text as typed.
- Keys, conflicts and unsaved edits work as in the Environment editor.

## Keys

`ctrl-shift-g` (in `keys.json`, `mod.open:brunr`) opens Brunr as a dialog or a tab, as the settings say. Pressed again, it closes the dialog, or goes back to the tab you came from. The palette entry "Brunr: Open" does the same.

In the dialog the keyboard is on the tree, the Request column or the Response side (see The Request column). The selected tree row is dimmer while the keyboard is elsewhere.

| Key | Action |
|---|---|
| `up` / `k`, `down` / `j` | previous / next row in the tree, or previous / next Request of a Run on the Response side |
| `g` / `G`, `home` / `end` | first / last row |
| `ctrl-d` / `ctrl-u` | half the tree's height down / up |
| `left` / `h` | fold the Collection or folder, else go to the parent row |
| `right` / `l` | unfold, else go to the first child |
| `enter` | run a Request, fold or unfold a Collection or folder, pick on the Global environment row. On the Request column: into the URL field |
| `ctrl-h` / `ctrl-l` | keyboard one place left / right |
| `r` | run the Request, folder or Collection |
| `p` | run the Request with other values for its URL's `{{variables}}` |
| `e` | pick the Environment (or the Global environment on its row) |
| `t` | show the Request on its File tab |
| `y` | copy the Request's URL |
| `o` | open Bruno desktop (Collections on this computer only) |
| `n`, `shift-n` | New Request, New folder |
| `f2` | Rename |
| `m` | Move to… |
| `ctrl-up` / `ctrl-down` | Move up / Move down |
| `x` / `delete` | Delete |
| `1` to `4` | Response, Headers, Timeline or Tests view |
| `/` | search a Run's Requests |
| `f` | fill the window, or leave full screen (dialog only) |
| `ctrl-s` | save the shown Request's Draft, or the open editor's file |
| `ctrl-r` | read everything again |
| `?` | show every key under the dialog, or only the main ones |
| `shift-f` | move Brunr from the dialog to a pane in the current tab, or from the pane back to the dialog |
| `,` | open the settings |
| `q` | close the dialog (dialog only) |
| `ctrl-x` | close the tab (tab only) |
| `esc` | step back: close a picker, a form, an editor's question, an editor, the settings or the Search box, leave a field, else close the dialog |

`r`, `p`, `e`, `t`, `y`, `o`, `f`, `ctrl-r`, `ctrl-s` and the seven edit keys can be switched off or moved to another key in the settings. The other keys always work, and so does every button and menu entry. Each key is also a command: `herdr-app do brunr.<command>`. The edit commands are `new-request`, `new-folder`, `rename`, `clone`, `move-to`, `move-up`, `move-down`, `delete`, `environments` and `edit-dotenv`, on the selected row.

In a picker: `up` / `k` / `ctrl-k`, `down` / `j` / `ctrl-j`, `enter` or `space`, and `esc`. In the "run with values" form: `tab` / `down` and `shift-tab` / `up` move between boxes, `enter` runs and `esc` closes. In a tree form: `tab` and `shift-tab` move, `enter` confirms and `esc` closes.

Mouse:

- Click selects a row. Double-click runs a Request or folds a Collection or folder. A drag moves a Request or folder (see Tree actions).
- The arrow folds. The Run button at the top runs the selected row.
- The Environment chip opens the picker.
- Right-click opens the row's menu over the dialog, each item with its key: Run, Run folder or Run Collection (when a Run can start), Open file, the edit actions (this computer only), Environment, Global environment, Open Bruno (this computer only), Copy URL, Copy path and Reload. Copy path copies the Collection root, or the file or folder inside it, as a path on its Machine. The menu takes the picker keys.
- The title row also has reload, full screen (dialog only) and the settings gear.

Command palette entries: "Brunr: Open" and "Brunr: Reload".

## Settings

The gear or `,` opens them:

- Open as a tab instead of a dialog. Switching it moves Brunr at once.
- Open the dialog in full screen.
- Open as a pane in the current tab. On: `ctrl-shift-g` splits the focused pane and shows Brunr at its right. Pressed again it moves the keyboard to Brunr's pane, and from there back to the pane you came from. `ctrl-x` closes the pane. This setting comes before "Open as a tab". Switching it on while the dialog is open moves Brunr to the pane at once.
- Show key hints. Off hides the key list under the dialog. `?` shows it again. The list shows the main keys (`?`, `j`/`k`, `enter`, `e`, `/`, `ctrl-s`, `esc`), and `?` switches between them and every key.
- A switch per shortcut key, and the key it is on.

## State

- Shared state holds the settings and what used to be in localStorage: which Collections and folders are unfolded, the Environment chosen per Collection (keyed by Machine and root), the Global environment chosen per workspace file and the name of the Request form's tab last shown. Every copy of the mod reads the same values, since each dialog and each tab is a new copy. The keys are `brunr.saved.<name>`, `brunr.open-as`, `brunr.back` (the tab to go back to), `brunr.dialog` (the open dialog) and `brunr.drafts` (a counter that changes when a Draft does, never its text).
- Collections start unfolded and folders folded until you change them.
- Drafts are held in memory, in module code, so they outlive the dialog. They are never written to shared state or disk except by a save to their own file.
- An editor's values are held only in that editor's state while it is open. They never reach shared state, the Drafts, a picker, the line under the columns, a log or a command-line argument, and Brunr adds no action that copies one.
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
- `p` passes each typed value to the CLI as a command-line argument (`--env-var NAME=VALUE`), which other programs on the machine can see while the Run executes. Do not use it for secrets.
- Closing the dialog during a Run leaves that Run's report file in the app's data folder (`data/brunr/`) until Brunr is next opened.
- Editing works on this computer only. Requests, Environments and `.env` files on another Machine are read-only.
- Herdr's own keys reach Herdr before the dialog: `f2` renames a tab and `alt-up` and `alt-down` step through agents. The dialog binds `f2` in its own key context so Rename gets it. Move up and Move down are on `ctrl-up` and `ctrl-down`.
- A masked field shows one dot per character, so the length of a value is visible. The Raw view and a revealed row show values on screen and in screenshots. A revealed value or the Raw text can be selected and copied with the system keys, as any Herdr text field allows.
- The editors are not separate windows. A Herdr window sits under a dialog, so they take the dialog's columns while open, and only one is open at a time.

## How it works

The key opens a tiny overlay copy of the mod that opens Brunr as a dialog or a tab, as the settings say, and closes at once. Each dialog and each tab is a new copy of the mod.

- `main.js`: the entry. Draws the dialog and the tree, loads and watches Collections, handles keys, clicks and Runs, holds the "run with values" form and wires the other parts in.
- `request.js`: the Request column. `formui.js`, `formpanes.js`, `form.js`, `formview.js`, `formtabs.js`, `formruntime.js`, `formsec.js`: the Request form, its tabs and the section readers and writers.
- `drafts.js`: Drafts in memory. `save.js` and `saveflow.js`: the save path and its questions. `lint.js`: the warnings. `edit.js`, `urlsync.js`, `lines.js`, `yamlblock.js`, `yamlwrite.js`: line-level edits of Request and folder files.
- `picker.js`: the dialog's picker, for menus, choices and questions.
- `treeactions.js`: the tree's edit actions, drag and drop and the run of one operation. `treeform.js`: their forms. `treeops.js`: their rules. `fileops.js`, `envops.js`, `collpaths.js`, `names.js`: Bruno's file, naming and numbering rules. `effects.js`: the only place Brunr changes files, with change-checked writes, the trash and the permanent delete.
- `editors.js`: the editors in the dialog. `envedit.js` and `envview.js`: the Environment editor. `dotedit.js` and `dotview.js`: the `.env` editor. `editparts.js`: what both share. `envtable.js`, `envfile.js`, `dotenv.js`: their rules.
- `response.js`: draws the Response side.
- `tree.js`: the rows, the key map, the URL variables and the confirmation and secret texts. No Herdr calls.
- `runtree.js`: the Run list as rows of folders and Requests, with counts and folds, for the live list and the result alike. No Herdr calls.
- `runfilter.js`: the filters and sort. Takes a finished Run's Responses and gives the Requests to list, in order, with the whole Run's folder counts. No Herdr calls.
- `store.js`: saved state and the in-memory Run store.
- `sources.js`: reads `brunr.json` and the workspace and finds Collection roots. Loads one Collection.
- `machine.js`: every `exec`, `readTextFile`, `watchFolder` and `fs` call for reading and Runs. Lists and reads files, checks the CLI, runs `bru` with its output going to the progress file, reads that file on a `cx.timer` while the Run is in progress, reads and deletes reports and progress files and starts Bruno desktop.
- `plan.js`: turns a target, the chosen Environments and any "run with values" values into the `bru run` arguments, and lists the Requests a Run sends in the CLI's order. No Herdr calls.
- `progress.js`: turns the progress file's text into the finished Requests and the running one. No imports.
- `report.js`: turns the CLI's JSON report, exit code and output into Responses. No Herdr calls.
- `parser.js` and `yaml.js`: read Collection files in both formats and a small YAML subset.
- `openpane.js`: Brunr as a pane in the current tab: the setting, what the key does, and closing the pane.
- `kit/`: shared UI pieces: the frame, list rows, controls, the key legend, the settings panel and opening as a dialog or a tab.
- `icons/`: the SVG icons.

Tests are in `brunr/tests/` in the repo and run with `sh brunr/tests/run.sh`.
