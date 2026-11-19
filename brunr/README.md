# Brunr

A side panel that lists your Bruno Collections as a tree, edits and runs their Requests with the Bruno CLI and shows each Response in a pane.

![Brunr](preview.png)

## Features

- **Edit a Request.** Bruno's tabs (Params, Body, Headers, Auth, Vars, Script, Assert, Tests, Docs, Settings) sit over the Request's file, with a File tab that holds the text, for HTTP Requests in YAML Collections. Edits stay a Draft until `ctrl-s` saves them, and a Run saves the Draft first.
- **Tree actions.** Create, clone, rename, delete (to the system trash), move and reorder Requests and folders from a menu, a key, or drag and drop.
- **Environments.** Edit an Environment in a table with masked values, and move a secret variable to `.env`. Pick one per Collection from a chip, and a Global environment per Bruno workspace.
- **The .env editor.** Edit `.env` files as a table or as raw text. A table save changes only the lines you edited and keeps comments.
- **Run a Request.** Double-click or press `enter`. The Response opens in the pane with its Response, Headers, Timeline and Tests views.
- **Folder and Collection Runs.** After a confirmation, with a summary line, a pass or fail mark per Request, a list you can filter and sort, and a count of finished Requests while it runs.
- **Collection tree.** Collections, folders and Requests in Bruno's sidebar order, with method badges in the Herdr theme's colours. A change to a Collection on this computer shows at once.
- **Other Machines.** A Collection on WSL or an ssh Machine is listed and run there, under its own heading. Editing works on this computer only.
- **Both formats.** The OpenCollection YAML format and the bru format, in one tree.
- **Open Bruno.** Start Bruno desktop from a row.
- **Keyboard.** One key shows the panel and gives it the keyboard. Move, fold, run, edit and pick without the mouse.
- **Setup help.** When `bru` is missing on a Machine, the panel says what to install and has a Copy button.

## Needs

- Herdr.
- The Bruno CLI (`npm i -g @usebruno/cli`, which needs Node 18 or later) on every Machine that holds a Collection.
- Bruno desktop is optional. Its workspace file is where Collections on this computer are found.
- It runs `bru`, `node --version` and a file-listing command (`sh`, or `powershell` on Windows) on a Collection's Machine. On another Machine it also runs `cat` and `rm`. Open Bruno starts the desktop app.
- For editing it also runs `node` with fixed scripts to create folders, move files and delete permanently, and the system trash: the Recycle Bin through PowerShell on Windows, `trash` on macOS and `gio trash` on Linux.
- It writes Request, folder, Environment and `.env` files in a Collection on this computer, moves files, and sends deleted items to the system trash. It writes a temporary report file per Run and deletes it.
- It reads Collection files, Bruno desktop's `workspace.yml` and `brunr.json`. It reads Environment values and `.env` only in the editors, and only to show and save them.
- A Run sends the Collection's requests to whatever they point at.

## Install

Tell your agent:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/jbped/herdr-mods/tree/main/brunr
```

Or by hand:

1. Copy `mods/brunr/` to `~/.config/herdr-app/mods/`.
2. Merge `keys.json` into `~/.config/herdr-app/keys.json`. It binds `ctrl-shift-u` and `ctrl-s`.
3. Give the panel this block in your own layout, in the row that holds the tab block, on the right. Herdr may already have docked the panel at the window's right edge with a generated id. If so, replace that block with this one. `ctrl-shift-u` works with any id, and the "Brunr: Toggle" palette entry needs the id `brunr`:
   `{ "id": "brunr", "type": "block", "content": { "mod": "brunr" }, "size": { "px": 320 } }`
4. Run `herdr-app check ~/.config/herdr-app/mods/brunr`.

## Use

`ctrl-shift-u` shows the panel and gives it the keyboard. Pressed again, it hides the panel. Click selects a row and shows a Request in an open pane. Double-click runs a Request or folds a folder. Drag a row onto a folder to move it. Right-click opens a row's menu, the play button runs a folder or Collection, and the chip on a Collection picks its Environment.

| Key | Action |
|---|---|
| `up` / `down`, or `k` / `j` | move |
| `left` / `right` | fold / unfold |
| `enter` | run a Request, or fold a folder |
| `r` | run the Request, folder or Collection |
| `e` | pick the Environment |
| `o` | show the Request in the pane |
| `n` / `shift-n` | new Request / new folder |
| `f2` / `delete` | rename / delete |
| `ctrl-s` | save the Request, or the open editor |
| `escape` or `q` | hand the keyboard back to your pane |

Collections on other Machines need `brunr.json`. The config file, every key, editing rules, secrets, Runs, limits and how it works: [`mods/brunr/README.md`](mods/brunr/README.md).
