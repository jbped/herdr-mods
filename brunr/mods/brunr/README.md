# Brunr

A side panel for Herdr that lists Bruno Collections as a tree, edits their Requests (as Bruno's tabs or as text), folders, Environments and `.env` files, runs the Requests with the Bruno CLI and shows each Response in a pane.

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

A bad entry is left out and a notice in the panel names it. A file that is not valid JSON gives the defaults and a notice with the parse error.

## Where Collections come from

1. Bruno desktop's workspace file. The default path is `<home>/AppData/Roaming/bruno/default-workspace/workspace.yml` on Windows, `<home>/Library/Application Support/bruno/default-workspace/workspace.yml` on macOS and `<home>/.config/bruno/default-workspace/workspace.yml` elsewhere. Its Collection paths may be relative to the workspace folder. These Collections are always on this computer.
2. The entries of `brunr.json`, after the workspace ones.

A Collection listed twice (same Machine and same root) shows once. A Collection is a folder holding `opencollection.yml` (the YAML format) or `bruno.json` (the bru format). A Collection shows under its own name, else its folder's name. When the Collections sit on more than one Machine, each Machine gets a heading, and "This computer" is the name for this one.

The tree stays current in two ways:

- Collections on this computer are watched, and a change in the folder reloads that Collection.
- Collections on another Machine are read again every 30 seconds.

The refresh button, the palette entry "Brunr: Reload" and the `brunr.reload` command read `brunr.json`, the workspace, every Collection and the CLI check again.

When it loads a Collection, Brunr reads only the files it needs: the config file, and the Request, folder and Environment files of the Collection's format (`.yml` or `.bru`). Dot files, dot folders and `node_modules` are not listed or read, so loading never opens `.env`. It reads at most 2000 files per Collection. From Environment files it takes variable names and flags, not values. Values are read only by the editors (see Secrets).

## Choosing an Environment

An Environment is a file in the Collection. Its name is the file name without the extension, which is what `--env` takes.

- The Environment chip on a Collection row, the `e` key and the row menu pick the Environment of that Collection. "No Environment" is a choice.
- Until a choice is made, or when the chosen Environment no longer exists, the Collection's default Environment is used.
- The choice is remembered per Collection.

A Global environment is a file in the `environments` folder beside the workspace's `workspace.yml`. Brunr shows a "Global environment" row above the workspace's Collections when that folder has any. One choice per workspace applies to all of its Collections, and a Run passes `--global-env` and `--workspace-path`. Collections that came from `brunr.json` get no Global environment.

Brunr warns on an Environment that still has secret variables. The warning shows on the chip, in the picker and in the panel's footer, and names the variables. The Environment editor and the Secrets section say how to move them to `.env`.

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
- On Windows, `node -e` with a fixed script finds `bru.cmd` on the PATH, reads the CLI's script path out of it and starts that script with `node` itself, the way the npm shim does. No `cmd.exe` is involved, so `%`, `&`, quotes and parentheses in a path or Environment name are passed as they are. When the script cannot be found next to `bru.cmd`, Brunr starts `bru.cmd` directly as before, and that Run shows no progress.
- The CLI's exit code and its whole output still reach the result.

Rules:

- A Request Run times out after 60 seconds, and a folder or Collection Run after 10 minutes. A timed-out Run shows "The Run timed out."
- One Run goes at a time across the whole mod. Run buttons and keys do nothing while a Run is in progress, and the tooltip says so.
- A Run cannot be cancelled.
- A Request Run starts at once. A folder or Collection Run first asks `Run 4 Requests in "Products" against local?` in Herdr's confirm dialog. Enter runs and Esc cancels. A folder with no Requests shows a toast and runs nothing.
- Runs are off for a Machine where `bru` does not start. At start and on reload Brunr runs `bru --version` and `node --version` on each Machine, with a 20 second timeout. A notice then gives the step: install Node.js first when it is missing, else `npm i -g @usebruno/cli`. It has a Copy button.
- Each Run writes the CLI's JSON report and a progress file, and deletes both after reading them. On this computer they are `data/brunr/run-*.json` and `run-*.log` in the app home. On another Machine they are `/tmp/brunr-*.json` and `/tmp/brunr-*.log`.
- A report or progress file left behind by a timed-out Run is deleted at the next Run. The panel also deletes `run-*.json` and `run-*.log` files left by an earlier session when it starts.

Progress during a folder or Collection Run:

- While the CLI runs, Brunr reads the progress file every 500 ms and redraws only when it changed. The CLI writes one line as each Request finishes, such as `products/List Products (200 OK) - 23 ms`.
- Brunr works out the order the CLI sends the Requests in, so it can name the Request that runs next. In each folder the CLI sends the subfolders first, sorted by name and then moved to their `seq` place, then the Requests by `seq`, a missing `seq` counting as 1. When the finished Requests do not match that order, the running Request is not named and only the counts and the finished list show.
- A finished Request's live mark comes from its HTTP status only: ✓ for 2xx and 3xx, ✗ otherwise. Assertions and tests are not shown live. The final result replaces the live list, so a Request can change from ✗ to ✓ or back.

A Run's output goes to the Response pane of the focused tab. The pane is reused when the tab has one. Otherwise it opens to the right of the focused pane, or in a new tab when no pane has focus.

## The Response pane

The pane has a Request side and a Response side (see Editing a Request). This section is the Response side. A Run of one Request shows:

- A top line with the Request's name, method and URL, then the status with its text, the time and the size.
- Four views: Response, Headers (with the count), Timeline and Tests (passed over total). The Tests label turns red when anything failed.
- Response is a read-only editor with syntax colours for JSON, HTML and XML. A body over 400000 characters is cut.
- Timeline shows the Request as it was sent: resolved URL, headers and body, then the status and time.
- Tests lists each assertion and each script test with its error text.

While a folder or Collection Run is in progress, the pane shows:

- A summary line with a spinner and `4 of 16`.
- The list of finished Requests as they finish, each with its mark, method, name and status, grouped under their folders as described below. The running Request is the last row, with a spinner in place of the mark, and each folder that holds it shows a spinner beside its count. Request rows cannot be selected until the Run ends.
- When the Run ends, the pane shows the result as below, with the same rows and folds, so the list does not jump.

A single Request Run shows a spinner until it ends.

A folder or Collection Run adds:

- A summary line with the number of Requests, passed, failed and skipped, and the total time.
- A list of Responses, each with a pass or fail mark, method, name and status. A Request with no response shows `ERR`. The first failed Response is selected, else the first.
- The list sits left of the views when the Response side is 720px wide or more, and above them when it is narrower.

The list is a tree, as in the panel:

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

- The four filters combine. A control away from its first value has its value drawn in the accent colour. When the pane is narrow, the text field shrinks first.
- Sorting keeps the folder tree. Requests are sorted inside their own folder and folders keep their Run order. `Slowest` and `Fastest` use the response time and `Status` the status number, with Requests that got no response last. `Name` ignores case. Ties keep the Run order.
- A folder with no Request left is hidden, nested folders too. Folder counts always describe the whole Run, so a filter never changes them.
- The summary line adds `showing <n> of <total>` while a filter is on.
- When nothing matches, the list says `No Requests match.` with a `Clear filters` button that resets the four filters and keeps the sort.
- When the selected Request is filtered out, the first one shown is selected.
- The filters and sort stay as they are for later Runs in the same pane, so `Failed` stays on while a folder runs again. The one exception is the method: when a new Run ends and the chosen method does not occur in it, the method goes back to `Any`.
- While a Run is in progress the toolbar is disabled and the live list shows every Request in Run order, since pass and fail are not known yet.

When the CLI sends no Request, or fails before it starts, the pane shows its message in a box.

Everything the Response side shows is held in memory and goes when the pane closes.

## Editing a Request

The pane beside your terminal has a Request side and a Response side. In a pane 900px wide or more the Request side is on the left and the Response side on the right, each half of the width. In a narrower pane the Request side is on top.

A click on a Request row shows the Request on the Request side when the focused tab has a Brunr pane. A click never opens a pane and never sends anything. `o` and the row menu's Open show the Request in the pane, and open the pane when the tab has none. Double-click and `enter` still run the Request.

The Request side, top to bottom:

- A bar with the method menu (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS), the URL field and Run.
- A line with the Request's name, its path in the Collection, an `Unsaved` mark while it has a Draft, Save and Discard.
- Notes, when they apply: "Editing works on this computer only.", a read error, and the changed-on-disk line (below).
- Bruno's tabs and the shown tab's content (see The Request form). A Request that does not get the tabs shows its file as text instead, under the line "The form is available for HTTP Requests in YAML Collections."
- The warnings for the text, each with its line. A click on one opens the File tab and moves the cursor to that line.

The bar and the text:

- The method menu changes the method line and nothing else. It is greyed out when the file has no method line.
- The URL field changes the `url` line, and the params follow it (see Params). It is greyed out when the file has no `url` line.
- A change to the method or `url` line, in File or by a tab, shows in the bar.
- A Request whose text does not parse cannot run, so Run is off until it parses.

A Draft is a Request's unsaved edits:

- A Request with a Draft has a dot on its tree row and `Unsaved` in the pane.
- Drafts are held in memory. They survive switching to another Request and closing the pane. They are lost when Herdr quits or the mod reloads.
- Discard goes back to the file on disk, read again.

Save (`ctrl-s` while the pane holds the keyboard, or the Save button):

- Text with warnings asks first: `Save "List Products" with a warning?` (or `with 2 warnings?`), each warning with its line, then Cancel and Save anyway. Cancel keeps the Draft.
- The warnings are: text that does not read as a Request, a YAML file whose `info.type` is folder, script or app, a tab in YAML indentation, a key twice in one YAML map, and a plain YAML value that starts with `{{`, `@`, a backtick, `*`, `&` or `!`, or that holds a colon followed by a space. The CLI rejects or misreads these.
- When the text does not read as a Request at all, the dialog adds "Brunr will list it as a broken file and leave it out of Runs."
- A save writes the file only when it is still the text the Draft started from. When it changed on disk, the dialog `"List Products" changed on disk` offers Reload from disk (drops your edits) or Overwrite.

When the shown file changes on disk:

- With no Draft, the Request side shows the new text.
- With a Draft, a line says "The file changed on disk." with Reload (drops the Draft) and Keep mine. Keep mine keeps the Draft, and the next save still asks Reload from disk or Overwrite.

Runs with Drafts:

- Run (the button, double-click, `enter`, `r`) on a Request with a Draft saves it first by the same path, warning and conflict dialogs included. When the save is cancelled or refused, nothing runs. The pane's Run button works while the panel is hidden.
- A folder or Collection Run saves nothing by itself. When Requests in it have Drafts it asks `2 Requests have unsaved changes.` with Cancel, Run without saving and Save and run. Save and run stops at the first Request that does not save, names it and does not run.
- A toast names a Request and never shows its text.

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
- The pane opens on the tab used last, and on Params the first time. Only the tab's name is remembered.
- The strip wraps onto more lines when the pane is narrow, so every tab stays reachable.
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
  - A hand-written shape: a flow list or flow items (`headers: [{ name: a }]`), a quoted or repeated key, a scalar where a list or map belongs, a line outside every entry, and a comment after a quoted value (`value: "x" # note`).

Params and the URL field keep each other in step, in both directions, as Bruno does:

- The URL splits at its first `?` outside `{{ }}`. The query params are the `&` pairs after it up to a `#`, split at the first `=` and not decoded. A pair with no `=` has no value and a pair with no name is dropped.
- The path params are the `:name` segments before the `?`, and `:name` inside a segment such as `Items(id=:id)`.
- An edit of the URL field makes the new list: the URL's query params (enabled), then new path params with empty values, then the disabled query params as they were, then the enabled path params the URL still has, as they were.
- This drops the description of every enabled query param, and every disabled path param. A list equal to the old one leaves the params block alone. A file with no params block and a URL with no query or `:name` segment gets only its `url` line changed.
- An edit of the Query table rebuilds the URL: the part before the first `?`, then `?` and the enabled rows that have a name as `name=value`, not encoded, joined by `&`. A `#fragment` is dropped. The table edit keeps the rows' descriptions.
- Path rows come from the `:name` segments. Their names cannot be edited, they have no checkbox, and they cannot be added or removed. A path row whose `:name` is no longer in the URL is dropped at the next Params edit.
- A file whose URL has a query but no params rows loses that query from the URL at the first Query table edit.
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

Where Brunr's pane differs from Bruno's:

- The tab strip wraps. Bruno moves tabs that do not fit into a menu.
- The body mode menu is at the top of the Body tab. Bruno puts it at the right of the tab bar.
- Script shows both editors at once. Bruno has Pre Request and Post Response sub-tabs.
- A body mode switch keeps only the text or rows described above. Bruno keeps every mode's content in memory.
- Prettify handles JSON only, and its message shows in the Body tab. Bruno also prettifies XML and shows a toast.
- The API key placement item reads "Query Params". Bruno's reads "Query Param".
- Timeout is one field that takes a number or `inherit`. Bruno has a control to inherit or override, which shows the timeout of its Preferences.
- Not built: description columns, drag to reorder, Bulk Edit, the list of inherited headers, the multipart Content-Type column and file rows, Settings' Tags and Enable App, naming the folder or Collection that Inherit comes from, Auth modes beyond the five, and the file, SPARQL and GraphQL body modes.

## Tree actions

The edit actions work on Collections on this computer. A row of another Machine has no edit entries and no edit keys. The keys act on the selected row while the panel holds the keyboard, and the row menu lists each action with its key.

| Action | Key | Rows |
|---|---|---|
| New Request | `n` | Collection, folder, Request |
| New folder | `shift-n` | Collection, folder, Request |
| Clone | menu only | Request |
| Rename | `f2` | folder, Request |
| Delete | `delete` | folder, Request |
| Move to… | `m` | folder, Request |
| Move up, Move down | `alt-up`, `alt-down` | folder, Request |

Each action:

- **New Request** opens the dialog "New Request" with Name, File name, Method (the seven of the method menu) and URL, and the button Create. The Request goes in the selected folder, the selected Request's folder or the Collection root. The file name follows the name until you edit it. The Request is numbered last, selected and shown in the pane, which opens when the tab has none. The query params and `:name` path params of the URL are written into the file.
- **New folder** opens "New folder" with Name and Directory name. It creates the directory and a folder file holding the name, the number and the auth mode `inherit`.
- **Clone** opens `Clone "<name>"` with the name `<name> copy`, then `<name> copy 2` and so on, after an existing copy suffix is removed. Its number is the count of Requests in the folder plus one.
- **Rename** opens `Rename "<name>"`. The name inside the file always changes. The file or directory name changes only when you edit its field. A folder with no folder file gets one.
- **Delete** asks `Delete "<name>"?` or `Delete folder "<name>"?`. The detail says "It goes to the trash." or "The folder and the 3 Requests in it go to the trash.", and adds "It has unsaved changes." when it or a Request in it has a Draft. The buttons are Cancel and Move to trash. The remaining items in the folder are renumbered.
- **Move to…** opens a picker `Move "<name>" to` with the Collection and its folders, indented, then the Collection root and folders of the other Collections of the same format on this computer. The item's own folder is greyed out, and a folder's own subfolders are not listed.
- **Move up** and **Move down** move a Request among Requests and a folder among folders, as the panel shows them.

The trash and permanent delete:

- The trash is the Recycle Bin on Windows, Trash on macOS and `gio trash` on Linux.
- When the trash fails or does not exist, a second dialog `"<name>" cannot go to the trash` gives the reason, says it cannot be undone and offers Delete permanently. Nothing is deleted permanently without that second confirmation, and never outside the Collection.

Bruno's naming and numbering rules, which Brunr follows:

- A file name comes from the name: `<>:"/\|?*` and control characters become `-`, leading spaces and hyphens and trailing dots and spaces are removed, and spaces inside stay.
- A name is refused when it is empty, over 255 characters or a Windows reserved device name (CON, PRN, AUX, NUL, COM0 to COM9, LPT0 to LPT9). The reason shows under the field as you type, for example "Name cannot be empty." or "Special characters aren't allowed in the name. Invalid character 'x'."
- A taken file or directory name gets ` 1`, ` 2` and so on, compared ignoring case.
- The items of a folder are numbered 1 to n in one list of folders and Requests. A Request with no number counts as 1. A change writes only the files whose number changed.
- A new Request or folder is numbered one more than the count of folders and Requests in its parent, and a clone one more than the count of Requests in its folder.
- The panel orders each folder as Bruno's sidebar does: folders first, then Requests. Folders sort by name and then move to their number. Requests sort by number, and ties sort by name ignoring case.

Moves:

- A move goes to a folder or the root of the same Collection, or to a Collection of the same format on this computer. The item keeps its file name unless the target has it, and then the clash rule applies.
- The source folder's remaining items are renumbered. The target's items are renumbered only for a drop between rows. A move onto a folder or Collection keeps the item's number.
- A move between Collections of different formats is refused. A drop onto such a Collection shows the toast "Not moved: another format" with both formats named, and Move to… lists only Collections of the same format.

Drag and drop:

- Drag a Request or folder by its row. The dragged row dims.
- A drop on the middle third of a folder row, or on a Collection row, moves the item in. The row is highlighted with a border in the accent colour.
- A drop on the top or bottom third of a folder row, or the top or bottom half of a Request row, places the item there in that row's folder. A line in the accent colour shows where.
- A row with no highlight or line takes no drop: a folder onto itself or its own subfolders, an item onto the folder it is already in, a drop that changes nothing, and a row of another Machine.
- Esc, or releasing the button away from the rows, cancels the drag.

Running an action:

- While one runs, the panel header shows a spinner and the edit actions are off. Afterwards the tree reloads, the new or moved item is selected and its folders unfold.
- A failed action names the step that failed, for example "Step 2 of 3 (writing folder.yml) failed: ...", and says how many earlier steps already ran. The tree reloads either way.
- A rename or move carries the Draft to the new path, with the new name or number made in the Draft too, and a pane that shows the Request follows it. A delete drops the Drafts under it, and a pane that shows it empties.
- An open dialog does not survive a mod reload. It then says "Brunr was reloaded. Close this dialog and open it again."

Broken files:

- A Request file that does not parse stays in the tree under its file name, with a warning mark and no method. The footer shows the parse message.
- It opens as text, so it can be fixed and saved. It can be renamed (the file name only), moved with Move to… and deleted. It cannot run, be cloned or be moved up or down, and a drop places it at the end of a folder.
- It is not counted in a folder's Requests, not renumbered and not sent in a Run.

## Environments

The Environment editor is a window, 760 by 540px, that opens from:

- "Edit…" beside an Environment in the Environment picker, and "Manage Environments…" at its bottom.
- "Edit Environments…" in a Collection row's menu.

Both exist for Collections on this computer only. You drag the window by its title bar. It stays open when you click elsewhere, and its × closes it. Several editors can be open at once.

The left side lists the Collection's Environments with New. The selected one has Clone, Rename and Delete, and "Edit .env…" opens the `.env` editor for the same Collection. The right side is the selected Environment's table:

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
- When the name is already in `.env`, the dialog says "NAME is already in .env. Move replaces its value." and the button becomes Replace.
- It is off while the table has unsaved changes.

New, Clone, Rename and Delete ask for a name or a confirmation inside the editor window:

- New and Clone take a name. A Clone starts as `<name> copy`, and a taken name gets ` copy`, ` copy 2` and so on. A clone keeps the variables and `extends` and drops `color`.
- Rename changes the file name and the YAML `name:`. Another Environment whose `extends` is the old name alone follows the rename.
- Delete asks `Delete Environment "<name>"?` and moves the file to the trash. When the trash fails, a second question offers a permanent delete.
- A Collection's chosen Environment follows a rename. After a delete of the chosen one, the Collection's default applies again.

Unsaved edits:

- Closing the window, choosing another Environment, and New, Clone, Rename and Delete ask "Discard unsaved changes?" with Keep editing and Discard. Discard drops the edits.
- A layout switch, quitting Herdr or a mod reload closes the window without asking and the edits are lost.
- Esc cancels an open question, otherwise it closes the window.

## The .env editor

The `.env` editor is a window of the same size. It opens from "Edit .env…" in a Collection row's menu and from the button at the bottom of the Environment editor, for Collections on this computer.

- The left side lists the `.env` and `.env.*` files in the Collection folder, `.env` first. The name must be `.env` or `.env.<letters, digits, . _ ->`. New suggests `.env`, or `.env.local` when `.env` exists. The selected file has Delete, which moves it to the trash, with the same second question when the trash fails.
- Only `.env` feeds a Run. With another file selected, a note says "Only .env feeds a Run. Brunr does not pass <file> to the Bruno CLI."
- The file opens in the Table view: Name and Value (masked), with the same reveal, add and remove as the Environment table and no enabled column. "Raw (shows values)" shows the text itself, unmasked. Switching carries unsaved edits across.
- A table save changes only the lines you edited. Comments, blank lines, order, `export` prefixes and quotes stay. Names and values are read by dotenv's rules. A table save masks every value again.
- A Raw save writes the text as typed.
- Conflicts and unsaved edits work as in the Environment editor.

## Secrets

Brunr reads and writes secret values, and keeps them in one place. These rules apply to every editor:

- A value is read from disk only when you open an editor on its file, or confirm Move to .env, which reads `.env`. It is written back to the same file on save.
- A value exists only in the open editor. It is not placed in shared state, stored state, a toast, a log or a command-line argument.
- Values are masked by default, with a reveal per row.
- A Request's form values, such as a bearer token or a basic password, are part of the Draft text and follow the Draft's rules: memory only, never shared state, stored state, a toast, a log or a command-line argument. The Auth tab masks the Password, Token and API key Value fields, one dot per character, with an eye button per field. Other form fields are not masked, as in Bruno.
- The editors keep no Draft. Closing one with unsaved edits asks, then discards them.
- Brunr has no clipboard action for a value. The row menus, picker and footer show no value.
- The `.env` table save keeps comments and blank lines. Bruno's own table save does not.
- A variable marked secret in Bruno keeps its value in Bruno's own store. Brunr does not read or write that store, and the CLI cannot read it. A Run sees such a variable as empty, and Brunr warns on the Environment. Move to .env rewrites the variable as `{{process.env.NAME}}`, which Bruno desktop reads too.
- A Run gets secrets only from the `.env` in the Collection root. The CLI reads it, and Brunr passes none on the command line.

Three limits remain:

- A revealed value, the Raw text, the File tab and the unmasked form fields can be selected and copied with the system keys. Herdr's input and editor components cannot turn that off.
- A Response's Timeline shows the request as sent, with resolved values, until its pane closes.
- A screenshot taken while a row or an Auth field is revealed, in the Raw view, on the File tab or on a form tab with values in it contains the values.

## Keys

`ctrl-shift-u` and `ctrl-s` are in `keys.json`.

`ctrl-shift-u`:

- With the panel hidden, it shows the panel and gives it the keyboard (`mod.open:brunr`).
- With the panel shown and the keyboard in another pane, it hides the panel and leaves the keyboard where it is.
- While the panel holds the keyboard, it hides the panel and hands the keyboard back (`brunr.hide`, in the `mod:brunr` section).

`ctrl-s` is `brunr.save` in the `mod:brunr` section. A `mod:<name>` command reaches every shown copy of the mod, so each copy decides for itself:

- A Brunr pane saves its Draft only while that pane has the keyboard.
- An Environment or `.env` editor saves only while one of its own fields or the window has the keyboard.
- While an editor window is open, the pane does not save its Draft, so one press saves one thing. The panel ignores it.

With the keyboard in the panel, keys with `ctrl`, `alt` (except `alt-up` and `alt-down`) or the platform key are not used by it:

| Key | Action |
|---|---|
| `up` / `k` | previous row |
| `down` / `j` | next row |
| `home` / `end` | first / last row |
| `left` / `h` | fold the Collection or folder, else go to the parent row |
| `right` / `l` | unfold, else go to the first child |
| `enter` | run a Request, fold or unfold a Collection or folder, pick on the Global environment row. Nothing on a broken file |
| `r` | run the Request, folder or Collection. Nothing on a broken file |
| `e` | pick the Environment (or the Global environment on its row) |
| `o` | show the Request in the pane, opening the pane when the tab has none |
| `b` | open Bruno desktop (Collections on this computer only) |
| `n` | New Request in the selected folder, the selected Request's folder or the Collection root |
| `shift-n` | New folder there |
| `f2` | rename a folder or Request |
| `delete` | delete a folder or Request |
| `m` | Move to… |
| `alt-up` / `alt-down` | Move up / Move down |
| `esc` / `q` | hand the keyboard back to the pane on the left. `esc` first cancels a drag |

The edit keys do nothing on a row of another Machine.

In a picker or menu: `up`, `down`, `enter` and `esc`. In a dialog: `left`, `right` and `tab` move between the buttons, `enter` chooses and `esc` closes. In a form (New Request, New folder, Rename, Clone): `enter` confirms and `esc` cancels. In an editor window: `esc` cancels an open question, else closes the window, asking first when there are unsaved edits.

Mouse:

- Click selects a row. On a Request it also shows the Request in the tab's Brunr pane when there is one. Double-click runs a Request or folds a Collection or folder.
- The arrow folds. The play button on a hovered or selected Collection or folder row runs it.
- The Environment chip opens the picker.
- Dragging a Request or folder moves it (see Tree actions).
- Right-click opens the row's menu, in this order, each entry only where it applies:
  - Request: Open, Run, Clone, Rename, Move to…, Move up, Move down, Delete.
  - Folder: Run folder, New Request, New folder, Rename, Move to…, Move up, Move down, Delete.
  - Collection: Run Collection, New Request, New folder, Edit Environments…, Edit .env….
  - A broken file: Open, Rename, Move to…, Delete.
  - Then, for any row of a Collection: Environment, Open Bruno (this computer only), Copy URL (a Request), Copy path and Reload. The Global environment row has Global environment.
  - Each entry shows its key as a hint: o, Enter, F2, m, Alt+Up, Alt+Down, Del, r, n, Shift+N, e and b.

Command palette entries: "Brunr: Toggle" (`layout.toggle` for the block `brunr`), "Brunr: Keys" and "Brunr: Reload".

## State

- The panel keeps in its localStorage: which Collections and folders are unfolded, the Environment chosen per Collection (keyed by Machine and root) and the Global environment chosen per workspace file. Herdr keeps it in store files under `data/brunr/` in the app home.
- The pane keeps the name of the last used Request tab in localStorage (`requestTab`). Nothing else of the form is stored.
- Collections start unfolded and folders folded until you change them.
- Drafts are held in memory by the mod and are never written to disk. Request text can hold tokens, and the form's fields hold the same text.
- The form's inputs, editors, reveal toggles and Prettify message are held in memory by the pane copy and go when the pane closes.
- Dialog forms (New Request, Rename and so on) hold what you typed in memory, by the form's id.
- An Environment or `.env` value exists only in its open editor and is stored nowhere.
- Folds in the Response pane's list are held in memory for one Run.
- The Response pane's filters and sort are held in memory by that pane until it closes. They are never written to disk or shared state.
- Runs and Responses are never written to disk. The report and progress files are the only exception, and they live for the length of one Run.
- Shared state holds two counters, `brunr.tick` and `brunr.drafts`, that make the other copies of the mod draw again, and `brunr.request`. `brunr.request` holds the last ask a popup, dialog or editor made for the panel or a pane: a kind, a row key (Machine, Collection path and the path inside it), an action, a choice id, a form id, an Environment or Global environment name or file path, a method name and an address. An ask from a form menu adds the tab, the field name, a row number and the chosen option, which is a mode, a placement or an operator. It never holds Request text, a value typed in a form, an Environment value, a `.env` value or Response data.

Each pane copy reads its asks from an in-memory log of the last 50, because shared state holds only the latest ask. The log holds the same fields.

## Limits

- Editing works on this computer only. Herdr's change-checked write exists only here, and a Collection on another Machine is edited there. Runs still work on other Machines.
- Bruno desktop reloads a Request when its file changes. When that Request has unsaved changes in Bruno, Bruno keeps them and its next save overwrites the file with no check. Brunr cannot see this.
- Bruno desktop rewrites a whole Request file from its own model on every save, so hand formatting and comments in a Request last only until Bruno saves it.
- Drafts do not survive Herdr quitting or a mod reload. An Environment or `.env` editor loses its unsaved edits on a layout switch, on quitting and on a mod reload.
- The method menu and the URL field are greyed out for a Request whose file has no such line.
- On Windows the Recycle Bin call may show Windows' own error dialog when a file is in use.
- Requests with prompt variables are skipped by the CLI.
- OAuth2 works only for the `client_credentials` and `password` grants.
- A YAML file the CLI cannot parse aborts the whole Run, for example an unquoted value containing a colon followed by a space. Brunr's own reader is more forgiving, so the tree can show a Request the CLI will not run. The save warnings catch the common cases.
- A file Brunr cannot read adds to a count on the Collection row, and the footer names the first five.
- There is no cancel for a Run.
- Run progress shows HTTP statuses only. Assertion and test results appear when the Run ends.
- The running Request is named only while the CLI sends Requests in the order Brunr expects. Requests with the same `seq` keep the folder's listing order, which Brunr takes as the file name ignoring case, as Windows lists files. Another Machine may list them in another order.
- On Windows, a timed-out Run may leave the CLI running until it ends by itself, since Brunr ends the `node` that started it.
- Secrets stored in Bruno desktop are empty in a CLI Run (see Secrets).
- With API Key auth set to add the key to the query, `bru` 4.3 does not send the key when the Request's URL starts with a variable such as `{{baseUrl}}`. It adds the key before it fills in the variables. A URL that starts with a literal host works.
- Known defect: a pane opened as a new tab, which happens when the focused tab has no focused pane, can attach to the previous tab. It then shows that tab's Request and takes that tab's menu choices and dialog answers, and closing it clears that tab's shown Request. A pane opened beside the focused pane is not affected.
- On Windows Brunr starts `bru.cmd`, so the npm global folder must be on the PATH Herdr was started with. Without it the panel shows the missing CLI notice. Moves, new folders, permanent deletes and the Recycle Bin call start `node`, so it must be on that PATH too.
- Bruno desktop cannot be told to open a specific Request, so "Open Bruno" only starts the app. Brunr looks for it at `<home>/AppData/Local/Programs/Bruno/Bruno.exe` on Windows, `/Applications/Bruno.app` on macOS and `bruno` on the PATH elsewhere.
- `"place": "right"` is not enough to place the panel. On the Herdr version tested, the shipped `main` layout did not dock it, and a personal layout docked it at the window root, full height, with a generated id. The page's Install therefore adds a block with the id `brunr`. `ctrl-shift-u` finds the block by its mod, so it works with any id. The "Brunr: Toggle" palette entry uses the id `brunr`.
- Collections on another Machine are listed and read with `sh` and `cat`, so that Machine needs both.
- A Global environment applies only to Collections listed in the workspace file.
- Paths are used as the Machine gives them. A Collection on WSL is not the same Collection as the same folder seen from Windows.

## How it works

One mod draws every part. Herdr starts a copy of it for the panel, for each Request and Response pane, for each popup and dialog, for each editor window and for the key's pass-through, and the props tell them apart.

- `main.js`: the entry. Chooses the copy by its props, loads and watches Collections, handles keys, clicks and Runs.
- `panel.js`: draws the tree, the notices and the footer.
- `request.js`: draws the Request side of the pane (bar, name line, notes, tab strip, File editor, warnings) and turns its input into Draft edits.
- `response.js`: draws the pane's frame and the Response side, and takes the asks addressed to the pane when it draws.
- `popup.js`: draws the Environment pickers, the row, method and form menus and the question dialogs. A menu is at most 440px high and its list scrolls.
- `forms.js`: draws the New Request, New folder, Rename and Clone dialogs.
- `actions.js`: the panel's tree actions: menus, dialogs, Move to, delete, drag and drop, and the run of one operation.
- `treeops.js`: the rules of the tree actions: positions to Bruno's numbers, the drop rule, Move to's choices, form messages, how a Draft follows its file and the row menu's entries. No Herdr calls.
- `fileops.js`: every file operation as a plan of effects, by Bruno's on-disk rules. No Herdr calls.
- `envops.js`: the Environment operations of `fileops.js`. No Herdr calls.
- `collpaths.js`: paths, siblings and sequence numbers shared by the operations. No Herdr calls.
- `names.js`: file and display names by Bruno's rules. No imports.
- `form.js`: the form's entry points: `canForm`, `readTab`, `writeTab`, `tabBadge`, the tab list and the data each tab reads and writes. No Herdr calls.
- `formtabs.js`: the readers and writers of Params, Headers, Body, Auth, Docs and Settings. No Herdr calls.
- `formruntime.js`: the readers and writers of Vars, Script, Tests and Assert. No Herdr calls.
- `formsec.js`: finds, replaces, creates and removes a section by Bruno's key order, and matches old rows to new ones. No Herdr calls.
- `yamlblock.js`: line-level tools for block maps and list items that leave other lines as they are. No Herdr calls.
- `formview.js`: the form's view rules: which tabs show, labels, menus, the row tables and what an edit makes of the data, when a field is reset from the text, and Prettify. No Herdr calls.
- `formui.js`: the form's view state (inputs, editors, reveals), the tab strip, the row table, menus and buttons.
- `formpanes.js`: the bodies of the ten form tabs and the "can only be edited in File" notice.
- `edit.js`: format writers that change a Request or folder file in place, and the text of a new one. No Herdr calls.
- `urlsync.js`: the URL field's edit with the params block rewritten as Bruno does. No Herdr calls.
- `yamlwrite.js`: a string as Bruno's YAML writer emits it. No imports.
- `lines.js`: text as lines that keep their own line endings. No imports.
- `lint.js`: the warnings before a save. No Herdr calls.
- `effects.js`: the only place that changes files. It performs write, mkdir, move and trash effects, and permanent deletes, and stops at the first failure.
- `drafts.js`: the pure Draft core and the in-memory Draft store.
- `save.js`: one Draft's save, change-checked. `saveflow.js`: the save path with its dialogs.
- `envfile.js`: Environment rows, the Environment writer and in-place edits, for both formats. No Herdr calls.
- `envtable.js`: the row state of both tables, with its rules. No Herdr calls.
- `envedit.js`, `envview.js`: the Environment editor's logic and drawing.
- `dotenv.js`: the `.env` reader and the line-preserving editor. No imports.
- `dotedit.js`, `dotview.js`: the `.env` editor's logic and drawing.
- `editparts.js`: what the two editors share: the window frame, the table with masked values, the questions drawn inside the window, buttons.
- `tree.js`: the rows, the key map, the block finder and the confirmation and secret texts. No Herdr calls.
- `runtree.js`: the Response pane's Run list as rows of folders and Requests, with counts and folds, for the live list and the result alike. No Herdr calls.
- `runfilter.js`: the Response pane's filters and sort. Takes a finished Run's Responses and gives the Requests to list, in order, with the whole Run's folder counts. No Herdr calls.
- `store.js`: saved state, the in-memory Run store, shown Requests, forms, the open editor windows and the asks between copies, with the log of the last 50 asks that pane copies read.
- `sources.js`: reads `brunr.json` and the workspace and finds Collection roots. Loads one Collection.
- `machine.js`: every `exec`, `readTextFile`, `watchFolder` and `fs` call except the ones in `effects.js`. Lists and reads files, checks the CLI, runs `bru` with its output going to the progress file, reads that file on a `cx.timer` while the Run is in progress, reads and deletes reports and progress files and starts Bruno desktop.
- `plan.js`: turns a target and the chosen Environments into the `bru run` arguments, and lists the Requests a Run sends in the CLI's order. No Herdr calls.
- `progress.js`: turns the progress file's text into the finished Requests and the running one. No imports.
- `report.js`: turns the CLI's JSON report, exit code and output into Responses. No Herdr calls.
- `parser.js` and `yaml.js`: read Collection files in both formats and a small YAML subset. `parser.js` also gives Bruno's sidebar order and the broken files.
- `icons/`: the SVG icons.

Tests are in `brunr/tests/` in the repo and run with `sh brunr/tests/run.sh`.
