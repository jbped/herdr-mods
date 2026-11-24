# Brunr

A dialog that lists your Bruno Collections as a tree, edits the selected Request beside it and runs it with the Bruno CLI.

![Brunr](preview.png)

## Features

- **One dialog, three columns.** The Collection tree, the selected Request and the last Run's Response. It opens over the window or as its own tab, and `f` fills the window.
- **Edit a Request.** Bruno's tabs (Params, Body, Headers, Auth, Vars, Script, Assert, Tests, Docs, Settings) and the whole file as text. Unsaved edits stay as a Draft until you save or discard them.
- **Run a Request.** Double-click or press `enter`. The Response shows its Response, Headers, Timeline and Tests views. A Draft is saved first.
- **Run with other values.** `p` asks for a value for each `{{variable}}` in a Request's URL and uses them for that Run only.
- **Folder and Collection Runs.** After a confirmation, with live progress, a pass or fail mark per Request, the first failure selected and a list you can search, filter and sort.
- **Organise the tree.** Create, clone, rename, move and delete Requests and folders from the menu, the keys or by dragging, with Bruno's naming and numbering. Deletes go to the system trash.
- **Environments.** Pick one per Collection, and one Global environment per Bruno workspace. Edit them in a table with every value masked until you reveal it, and move a secret to `.env`.
- **The .env editor.** Edit a Collection's `.env` files as a masked table that keeps comments, or as raw text.
- **Other Machines and both formats.** A Collection on WSL or an ssh Machine is listed and run there, read-only. The YAML and bru formats share one tree.
- **Open file, Copy URL, Copy path and Open Bruno.** Show a Request's file, copy its URL or path, or start Bruno desktop.
- **Keyboard and settings.** Everything works from the keys, and `?` shows them. The settings open Brunr as a tab or a dialog, in full screen, hide the key hints, and switch any shortcut off or move it.
- **Setup help.** When `bru` is missing on a Machine, the dialog says what to install and has a Copy button.

## Needs

- Herdr.
- The Bruno CLI (`npm i -g @usebruno/cli`, which needs Node 18 or later) on every Machine that holds a Collection.
- Bruno desktop is optional. Its workspace file is where Collections on this computer are found.
- It runs `bru`, `node` and a file-listing command (`sh`, or `powershell` on Windows) on a Collection's Machine. On another Machine it also runs `cat` and `rm`. A delete runs the system trash: PowerShell's Recycle Bin call on Windows, `trash` on macOS and `gio trash` on Linux. Open Bruno starts the desktop app.
- It reads Collection files, Bruno desktop's `workspace.yml` and `brunr.json`. It writes the files you save, create, move or delete inside a Collection on this computer, and a temporary report file per Run. It reads `.env` only in its editor.
- A Run sends the Collection's requests to whatever they point at.

## Install

Tell your agent:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/jbped/herdr-mods/tree/main/brunr
```

Or by hand:

1. Copy `mods/brunr/` to `~/.config/herdr-app/mods/`.
2. Merge `keys.json` into `~/.config/herdr-app/keys.json`. It binds `ctrl-shift-u`.
3. Run `herdr-app check ~/.config/herdr-app/mods/brunr`.

## Use

`ctrl-shift-u` opens Brunr. Pressed again, it closes the dialog, or goes back from the tab. Click selects a row and shows a Request, double-click runs it, and right-click opens a row's menu. Drag a Request or folder to move it.

| Key | Action |
|---|---|
| `up` / `down`, or `k` / `j` | move |
| `left` / `right`, or `h` / `l` | fold / unfold |
| `enter` | run a Request, or fold a folder |
| `r` | run the Request, folder or Collection |
| `e` | pick the Environment |
| `ctrl-h` / `ctrl-l` | keyboard left / right: tree, Request, Response |
| `ctrl-s` | save |
| `n` | New Request |
| `?` | show every key, or only the main ones |
| `esc` | step back, or close |

Collections on other Machines need `brunr.json`. The config file, every key, the Request form, tree actions, the editors, settings, secrets, Runs, limits and how it works: [`mods/brunr/README.md`](mods/brunr/README.md).
