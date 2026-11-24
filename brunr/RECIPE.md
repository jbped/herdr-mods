# Brunr

A dialog over the Herdr window, or a tab of its own, with three columns: your Bruno Collections as a tree in the Herdr theme's colours, the selected Request with Bruno's tabs and its file as text, and the last Run's Response with Response, Headers, Timeline and Tests views. The Bruno CLI runs a Request, a folder or a whole Collection. The tree's menu, keys and drag and drop create, clone, rename, move and delete Requests and folders by Bruno's rules, and an Environment editor and a `.env` editor take the columns' place while they are open.

![Brunr](preview.png)

## What you see

The preview shows the dialog with a made-up Shop Collection: the tree on the left with Create Order selected, the Request column on its Body tab with a JSON body, and the Response column with a 201 Created Response.

The dialog is a centred box 96% of the window wide, up to 1800px, and 92% of the window high, or the whole window in full screen or as a tab. A press beside the box closes it. Its frame has 22px padding, a 16px radius, a 1px `border`, a `popover` fill, 14px between sections and 13px text. Top to bottom:

- **Title row**: "Brunr" in 16px semibold, then "4 Collections · 33 Requests" in 11px `dim`, a 13px turning ring in `working` while Collections load, a Run runs or a tree action runs, then 26px bordered buttons on `raised` with an 8px radius: "Run", "Run folder" or "Run Collection" with a 10px play icon in `done` (only when a Run can start), reload, full screen (dialog only) and the settings gear, then "Esc" in 11px `dim`.
- **Columns**, 14px apart:
  - **Tree**, 22% of the dialog wide, never under 240px or over 380px. Notices first, each on `raised` with an 8px radius and 12px text: a config problem in `blocked` with a 13px warning icon, or "No Bruno CLI on this computer. Runs are off." in `ansi3` semibold with the install step in `muted`, the command in the terminal font and a "Copy" button. Then the rows, which scroll: 32px high, an 8px radius, 13.5px text, 8px left padding plus 14px per level. The selected row is on `selected`, or on `hover` while the keyboard is elsewhere. A Machine heading is a section label. A Global environment row has a 13px globe icon and its name in `muted` and an Environment chip. A Collection row has a 16px fold arrow in `dim`, the name in medium weight, a ring while it loads, a `blocked` warning icon when it cannot be read, the count of unreadable files in `blocked`, and the Environment chip: 22px high, at most 130px wide, an 8px radius, a 1px `border`, the name in `foreground` or "No Environment" in `dim`, and an 11px `ansi3` warning icon first when the Environment has secret variables. A folder row has the arrow, a 13px folder icon in `muted`, the name and its Request count in 11px `dim`. A Request row has a 16px spacer, a 36px method badge in 10.5px semibold (GET `ansi2`, POST `ansi5`, PUT `ansi3`, PATCH `ansi6`, DELETE `ansi1` shown as "DEL", others `muted`, OPTIONS "OPT", GRAPHQL "GQL", CONNECT "CONN") and the name, then a 7px `ansi3` dot while it has a Draft. A Request file that does not parse shows a 12px `blocked` warning icon in the badge's place and its file name in `muted`. A running row has a 12px ring in `working`, and a running folder or Collection shows "2/5" before it. Under the rows, a box on `raised` with 12px text: the selected Request's badge and URL in the terminal font, a folder's or Collection's Request count, a broken file's parse message in `blocked`, the first five unreadable files, "Environment: local" and the secret warning in `ansi3`.
  - **Request column**, on `background` with an 8px radius and a 1px `border`. A 44px bar: the method menu (28px, the method in its colour, a 10px chevron), the URL field (28px, the terminal font at 11.5px) and Run. A 34px line: the name in semibold, the path in `dim`, "Unsaved" in `ansi3` with a 7px dot, then Save and Discard (26px, an 8px radius, on `raised`). Notes on `raised` with a 12px warning icon. Then the tab strip, 26px tabs with an 8px radius, wrapping: Params, Body, Headers, Auth, Vars, Script, Assert, Tests, Docs, Settings and File, the shown one on `selected`, a count in 10px `accent` or a 6px `accent` dot when its section has content. Then the tab's fields or the File editor with YAML colours, and at the bottom the warnings with their line numbers. With no Request it says "Select a Request to see it here." in `dim`.
  - **Response side**, the same box. "No Response yet. Select a Request and press enter to run it." in `dim`. A Run shows a 42px top line (the name in semibold at most 220px, a 44px badge, the URL in the terminal font at 11.5px `muted`, a 20px status chip on `raised` in `done`, `ansi3` or `blocked`, the time and size in `muted`), the view tabs and the view. A folder or Collection Run adds a 34px summary line ("8 Requests", "6 passed" in `done`, "2 failed" in `blocked`, "0 skipped" in `ansi3`, the time at the right), a 40px toolbar (a 26px "Search" field and the Result, Status, Method and Sort controls) and the Run list of 28px rows grouped under folder rows with `<passed>/<total>` in 10.5px. The list is 240px wide at the left when the Response side is 640px wide or more, else above the views.
  - Under 760px wide (a pane beside a terminal) the tree is a 190px high strip across the top without the selection box, and the other two sit under it. When the dialog is 1150px wide or more, the Request column and the Response side share the room right of the tree. Narrower, the Request column sits above the Response side and is 46px high while empty.
- **Note line**, when there is one: 11px text in `dim`, or `blocked` for a failure.
- **Legend**, after a 1px divider: each key in `accent` semibold and its meaning in `dim`, 11px, 12px apart, wrapping.

Over the dialog, 60px from the top and 22px from the left, on `popover` with a 12px radius, a 1px `border` and a large shadow:

- **Picker**, 400px wide (460px with a detail, 280px for a plain menu under its button). One opened by a press sits 4px under its trigger, left edges aligned, or above it when there is no room below, and never closer than 8px to the dialog's edge. A right-click menu opens at the pointer. One opened by a key sits at the dialog's top left, 60px down. Its parts: the title in semibold, an optional detail in 11px `muted`, then 32px rows (48px with a warning line) with a dot in `accent` on the current one, a hint at the right in 11px `dim`, an "Edit…" button (20px, a 1px `border`) on Environment rows, Collection names in bold and greyed-out rows in `dim`, then a divider and the legend "j/k move, enter choose, esc back". The row menu, the Environment and Global environment pickers, Move to… and every question are pickers.
- **Forms**, 460px wide: New Request, New folder, Rename and Clone, with 32px fields under 11px `muted` labels, a message under each in 11px `blocked`, the method chips (24px, the method's colour, an `accent` border on the chosen one), Cancel and the action's button on `solid`, and the legend "tab next, enter create, esc back". The "run with values" form has the same look.

An open editor replaces the three columns with one box on `background`: a 36px title line ("Environments · Shop" or ".env files · Shop" in 13px semibold, a 24px close button), a 200px list on `surface` at the left (New at the top, the selected item on `selected` with Clone, Rename and Delete under it, "Edit .env…" at the bottom), and the table at the right: a 26px header (Name, Value, "Show" or "Hide" with an eye), 30px rows with a 16px enabled box (an `accent` ✓), a 190px name field and a value field in the terminal font at 12px, masked as dots, a 24px eye and a 24px ×, and a 44px footer with the status, Discard and Save on `solid`. A secret row shows "Secret. Its value is kept by Bruno, not in this file." in `muted` and a "Move to .env" button. Questions are a 440px card on `surface` centred on `canvas`.

## How it behaves

Brunr shows Run results, not agent statuses. It does not touch agents.

- `ctrl-shift-u` opens Brunr as a dialog or a tab, as the settings say, and pressed again closes the dialog or goes back from the tab.
- Click selects a row and shows a Request in the Request column without sending it. Double-click runs a Request or folds a folder. The arrow folds. The chip opens the Environment picker. Right-click opens the row's menu. Selecting a folder keeps the last Request shown.
- Keys on the tree: `j`/`k` and the arrows move, `h`/`l` fold, `enter` runs or folds, `r` runs, `p` runs with other values, `e` picks the Environment, `o` shows the File tab, `y` copies the URL, `b` opens Bruno desktop, `n` New Request, `shift-n` New folder, `shift-r` Rename, `m` Move to…, `ctrl-up`/`ctrl-down` Move up and down, `delete` Delete, `1`-`4` the views, `/` search, `f` full screen, `ctrl-s` save, `ctrl-r` reload, `?` the key list, `,` the settings, `esc` steps back then closes. `ctrl-h` and `ctrl-l` move the keyboard between the tree, the Request column and the Response side.
- Typing in the Request column edits a Draft. The tree row gets its dot and the column "Unsaved". `ctrl-s` or Save writes it, asking first in a picker when the text has warnings or the file changed on disk. A Run of a Request with a Draft saves it first.
- A Request Run starts at once. A folder or Collection Run asks `Run 4 Requests in "Products" against local?` first, and asks about Drafts in it. During the Run the tree row and the Response side show "4 of 16" and the running Request.
- A tree action runs its file operation, reloads the tree and selects the result. A rename or move carries Drafts along and the Request column follows. A delete goes to the system trash after a confirmation, and a permanent delete needs a second one when the trash fails.
- A drag over a folder's middle third or a Collection highlights the row with an `accent` border. Over a folder's top or bottom third or a Request's top or bottom half, a 2px `accent` line shows the place. The dragged row is at half opacity. A drop with no highlight does nothing. A drop onto a Collection of the other format says so under the columns.
- An editor opens in place of the columns. `esc` cancels its question or closes it, asking "Discard unsaved changes?" when the table has edits. `ctrl-s` saves the editor's file and not a Request's Draft.
- A Collection on this computer is watched and reloads when it changes. A Collection on another Machine reloads every 30 seconds and is read-only.

## Built from

One mod, `brunr`, in `mods/brunr/`. Its `mod.json`: `"place": "none"`, `"title": "Brunr"`, an overlay `{ "kind": "popup", "width": 1, "height": 1, "frame": "none" }` and the palette entries "Brunr: Open" (`mod.open` with `{ "name": "brunr" }`) and "Brunr: Reload" (`brunr.reload`). No layout block.

Keys, in `keys.json`:

```json
{ "global": { "ctrl-shift-u": "mod.open:brunr" } }
```

The copy is chosen by `props()`: the key opens a 1 by 1 popup copy that opens Brunr as a tab or as a dialog (`openOverlay` with `kind: "dialog"`, `width: 1`, `height: 1`, `frame: "none"`, `props: { dialog: true }`) and closes. Each dialog and tab is a new copy. Shared state is read through `brunr.saved.<name>` keys, so every copy sees the same settings, folds and Environment choices.

Modules: `main.js` (the dialog, the tree, keys, Runs, the "run with values" form), `request.js` and the `form*.js` files (the Request column and form), `drafts.js`, `save.js`, `saveflow.js`, `lint.js`, `edit.js`, `urlsync.js`, `lines.js`, `yamlblock.js`, `yamlwrite.js` (Drafts and saving), `openpane.js` (opening as a pane in the tab, the key `shift-f` and the header button that move the dialog to a pane and back), `picker.js` (every menu and question), `treeactions.js`, `treeform.js`, `treeops.js`, `fileops.js`, `envops.js`, `collpaths.js`, `names.js`, `effects.js` (tree actions and file changes), `editors.js`, `envedit.js`, `envview.js`, `dotedit.js`, `dotview.js`, `editparts.js`, `envtable.js`, `envfile.js`, `dotenv.js` (the editors), `response.js`, `tree.js`, `runtree.js`, `runfilter.js`, `store.js`, `sources.js`, `machine.js`, `plan.js`, `progress.js`, `report.js`, `parser.js`, `yaml.js`, and `kit/` (frame, rows, controls, legend, settings panel, opening as a dialog or tab).

Config, `brunr.json` in the app home: `{ "workspace": "<path of a workspace.yml>", "collections": [ { "machine": "<name, optional>", "path": "<Collection root or a folder of them>" } ] }`.

Herdr calls: `appHome`, `home`, `checking`, `exec`, `readTextFile`, `writeTextFile`, `watchFolder`, `window`, `props`, `layout`, `focused`, `panes`, `spaces`, `settings`, `theme`, `shared`, `setShared`, `openOverlay`, `closeOverlay`, `nextCommand` and `run`. UI from `gpui-kit` and `gpui-base`: `View`, `div`, `svg`, `v_flex`, `h_flex`, `ScrollHandle`, `Editor`, `EditorState`, `Input` and `InputState`, with `cx.bind_keys`, `key_context` and `on_action` for `esc` and the save key.

Programs, all through `exec`:

- `bru run ...` with its output going to a progress file, on the Collection's Machine. Not on Windows: `sh -c 'out=$1; shift; exec "$@" >"$out" 2>&1' sh <file> bru run ...`. On Windows: `node -e <fixed script> -- <file> run ...`, which reads the CLI script's path out of `bru.cmd` on the PATH, else in `%APPDATA%\npm`, and starts it with `node` and no shell.
- `bru --version` and `node --version` on each Machine.
- Listing: `sh -c` on any Machine, `powershell -NoProfile -NonInteractive -Command` on Windows when `fs` is refused. Reading on another Machine: `sh -c` with `cat`. Reports on another Machine: `cat` and `rm`.
- File changes on this computer: `writeTextFile` with the expected text, and `node -e <fixed script>` for mkdir, move and the permanent delete. The trash: PowerShell's Recycle Bin call through `node` on Windows, `trash` on macOS and `gio trash` on Linux.
- Open Bruno: `cmd /d /c start` with `Bruno.exe` on Windows, `open /Applications/Bruno.app` on macOS and `bruno` on Linux.

Art: fourteen SVG icons on a 16 by 16 viewBox in `mods/brunr/icons/`: `chevron-down`, `chevron-right`, `close`, `collection`, `expand`, `eye`, `eye-off`, `folder`, `globe`, `play`, `reload`, `shrink`, `spinner` and `warning`. They take `currentColor`.

## Watch out

Facts of Herdr that a fresh build gets wrong:

- A Herdr window (`kind: "window"`) sits under a dialog, so an editor opened as a window from the dialog is hidden. Draw it inside the dialog.
- The app closes the top dialog on `esc` before the mod's key handler hears it. Put the dialog in a key context with `esc` bound to the mod's own action while a picker, form, editor, field or drag is open. The same `esc` can arrive twice, so ignore a second one within 300ms.
- An Input or an Editor keeps `ctrl-h`, `ctrl-l` and its own keys. Bind the save key in a key context around the fields with `cx.bind_keys`, so `ctrl-s` reaches the dialog from any field.
- Herdr's global keys reach Herdr first: `f2` renames a tab and `alt-up` and `alt-down` step through agents. Keys for a dialog must avoid them.
- A `cx` kept from an earlier turn is no longer valid. A callback that runs later, such as a question's button, must use the `cx` of its own turn.
- A drag that ends on another row fires no click on either row. A release outside the rows must end the drag, so the frame and the area around the dialog also listen for the button going up.
- `exec` cannot start `bru.cmd` by name on Windows. Start the CLI's script with `node`. `fs` reads are refused outside the home folder, and `readTextFile` reads anywhere.

Facts of the Bruno CLI (4.3.0):

- A failed assertion leaves the result's `status` as `"pass"`. Compute pass or fail from the assertions and tests.
- Every Run lists each unreadable Collection file as a skipped result with its parse error. Count these as skipped, not as Responses.
- A YAML file the CLI cannot parse aborts the whole Run. Lint before a save and warn.
- The CLI's order: in each folder, subfolders first by name then moved to their `seq`, then Requests by `seq`, a missing `seq` counting as 1.
- `--env` takes the Environment's file name without the extension.

Limits and assumptions:

- Editing works on this computer only, because the change-checked write exists only here.
- `p` passes typed values as command-line arguments, which other programs can see during the Run.
- Closing the dialog during a Run leaves its report file in `data/brunr/` until Brunr next opens. A press beside it or the key asks "Discard unsaved changes?" first when an editor has unsaved edits.
- At most 2000 files per Collection. One Run at a time. A Run cannot be cancelled. Timeouts are 60 seconds for a Request and 10 minutes for a folder or Collection.
- A masked value still shows its length. The Raw view shows values.

## Done when

1. `herdr-app check` passes on the mod folder, and `sh brunr/tests/run.sh` passes.
2. With a workspace that lists a Collection, the dialog shows it as a tree with method badges, and a folder starts folded.
3. A click on a Request shows it in the Request column with Bruno's tabs and sends nothing. Typing in the URL field marks the tree row and the column "Unsaved", and `ctrl-s` writes the file.
4. Double-clicking a Request shows a status, time, size and a pretty-printed JSON body. Headers, Timeline and Tests switch.
5. Running a folder asks `Run 4 Requests in "Products" against local?` first, then shows the summary line and the list with ✓ and ✗ marks.
6. `n` on a folder opens New Request. A name with `?` gives a file name with `-`, and Create writes the file numbered last and shows it in the Request column.
7. `shift-r` on a Request with a Draft renames its file, and the Draft and the Request column follow it.
8. `m` lists the Collection's folders and the other Collections of the same format. Choosing one moves the file, and `bru run` still runs it there.
9. Dragging a Request onto a folder's middle moves it in. Dragging it onto a Collection of the other format moves nothing and says why.
10. `delete` asks, then puts the file in the system trash, and the Request column empties when it showed it.
11. A Request file that does not parse shows a warning mark and opens on the File tab, and Run is off.
12. "Edit…" in the Environment picker opens the Environment editor with every value masked. An edit, `ctrl-s` and `bru run` use the new value, and a Request's Draft stays unsaved.
13. Move to .env on a secret writes `.env` and rewrites the variable as `{{process.env.NAME}}`.
14. "Edit .env…" opens the `.env` table. A table save changes only the edited line and keeps comments. Raw shows the text.
15. `esc` in an editor with unsaved edits asks "Discard unsaved changes?", and Discard closes it without writing.
16. After all of the above, no typed value is in the app home's `shared.json` or anywhere else outside the Collection files.
