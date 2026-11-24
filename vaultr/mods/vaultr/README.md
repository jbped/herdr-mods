# Vaultr

A read-only reader for an Obsidian vault, as a Herdr mod. A folder tree and a name search on the left, the note on the right.

## Install

1. Copy `mods/vaultr/` to `~/.config/herdr-app/mods/vaultr/`.
2. Merge `keys.json` into `~/.config/herdr-app/keys.json`. It binds `ctrl-shift-y` to `mod.open:vaultr`, which opens the dialog and closes it again.
3. Run `herdr-app check ~/.config/herdr-app/mods/vaultr`.

## The vault folders

The first time it opens, Vaultr asks for the vault: type the path and press `enter`, or click Browse. The folder is kept in Herdr's shared state as `vaultr.vault`, so the dialog, tabs and panes all read the same vault.

"vaults" at the bottom right, or the `vaultr.vault` command, shows the vaults form. It lists the saved vaults: click one to read it, or its ✕ to drop it from the list (the folder is not touched). The path field adds another vault and switches to it. The list is kept in shared state as `vaultr.vaults`.

`v` switches to the next saved vault and `shift-v` to the one before, going round. The commands `vaultr.next` and `vaultr.prev` do the same for the copy that is showing, so a key in `keys.json` can switch without Vaultr having the keyboard, for example `"alt-v": "vaultr.next"`. Each vault opens on the note it last showed, with the folders it had open.

The folder must be inside your home folder. Herdr only lets a mod read files there, and Vaultr says so when the folder is outside it.

One copy can read a different vault through its props: `{ "vault": "<folder>", "note": "<path below the vault>" }`. `note` is optional. That copy stays on its vault, and `v` does nothing in it.

## Where it opens

| How | Command |
|---|---|
| A dialog over the window | `mod.open {"name": "vaultr"}` (`ctrl-shift-y`) |
| A tab | `tab.new {"name": "Vault", "mod": "vaultr"}` |
| Beside the focused pane | `pane.split {"direction": "right", "mod": "vaultr"}` |

All three are in the palette as "Vaultr: Open", "Vaultr: Open in a tab" and "Vaultr: Open beside this pane".

**The side panel.** Vaultr can also sit in a layout's side panel, next to Files and Changes. This takes a layout of your own (clone a shipped one first):

1. Add a block to the panel's stack: `{ "id": "vaultr", "type": "block", "content": { "mod": "vaultr" } }`.
2. Show it with two commands: `layout.select {"stack": "<the stack's id>", "child": "vaultr"}`, then `layout.show {"id": "<the panel's id>"}`.

A palette entry or a key runs one command, so the pair has to come from a mod. "Vaultr: Open in the side panel" sends `tabs-plus.vaultr`, which a tab bar mod named `tabs-plus` must handle by running those two commands. `vault.svg` in this folder is an icon for its button. The palette also has "Vaultr: Next vault" (`vaultr.next`), "Vaultr: Previous vault" (`vaultr.prev`), "Vaultr: Vaults" (`vaultr.vault`) and "Vaultr: Reload" (`vaultr.reload`), which act on the copy that is showing.

Narrower than 620px, the list and the note take turns: opening a note hides the list, and `b` or the ☰ button brings it back. To return to the note without choosing another, click "← Back to <note>" above the search box, or press `b` or `escape`.

The bar above the note holds, left to right: ☰ (show or hide the list), ← (back to the note you read before this one, like a browser's back button; `backspace` does the same), and breadcrumbs: the folders above the note, then its name. Click a folder in the breadcrumbs to see it open in the list.

Vaultr opens on the note it last showed in that vault, and remembers which folders were open.

## Keys

The keys work while Vaultr has the keyboard: click it, or move onto it with `pane.go`.

| Key | Action |
|---|---|
| `/` | put the cursor in the search box |
| `j` / `down`, `k` / `up` | move down / up the list |
| `enter` | open the selected note, or open and close the selected folder |
| `l` / `right`, `h` / `left` | open / close the selected folder |
| `]` / `[` | scroll to the next / previous heading |
| `backspace` | back to the note before |
| `v` / `shift-v` | switch to the next / previous saved vault |
| `b` | show or hide the list |
| `?` | show or hide the list of every key |
| `o` | open the note in Obsidian |
| `r` | read the vault again |
| `escape` | leave the search box, or clear the search |

In the search box, `down` and `up` move through the results and `enter` opens the selected one, or the first.

In the dialog, `escape` always closes the dialog. Herdr handles it before the mod does.

## What is drawn

- Markdown as Herdr's text view draws it: headings, lists, task lists, tables, quotes, code blocks with a language label, links.
- The properties block (frontmatter) as a box of plain lines above the note.
- `[[Note]]`, `[[Note|alias]]`, `[[Note#Heading]]`, `[[#Heading]]` and `[text](Other note.md)` as links that open in Vaultr. A link to a file that is not a note opens in that file's own app.
- `![[image.png]]` and `![alt](image.png)` as the picture, at most 720px wide.
- `> [!note] Title` callouts as a quote with a bold first line. They have no icon or color, and do not fold.
- `==highlight==` as bold. `%%comments%%` are left out.
- Backlinks under the note, once the vault has been read.

A link finds its note the way Obsidian does: a path from the vault's root, then a path from the note's own folder, then the same name anywhere in the vault.

## What is not drawn

- Mermaid, Dataview and other plugin blocks show as code.
- `![[Note]]` shows a link to the note, not its text.
- Canvas files, PDFs and other attachments are not in the list. A link to one opens it in its own app.
- Images on the web (`![alt](https://…)`) are not fetched.
- Block links (`[[Note#^id]]`) open the note at its top.
- Tags are plain text. There is no tag list, graph or search inside notes.
- An animated GIF may show one frame. This has not been tested.

## Limits

- Read-only. Edit in Obsidian (`o`).
- The vault must be on this computer and inside your home folder.
- Folders whose name starts with a dot, and `node_modules`, are skipped.
- Search shows at most 200 notes.
- Backlinks need every note read once. Measured at about 18 ms a note, so a vault of 280 notes takes about 5 seconds. The note you opened shows first.
- The list draws every row of every open folder. It was tested with 280 notes.
- `]`, `[` and heading links put the heading at the top of the view. Near the end of a note there is not enough text below it, so it stops lower.
- Each image you view is copied to `~/.config/herdr-app/data/vaultr/<vault id>/`, because Herdr only draws images from its own folder. The copies are refreshed when the file changes and are never removed. Delete the folder to clear them.
- On Linux, Herdr refuses to watch a vault with more than 4096 folders. Vaultr then stops following changes. Press `r` to read the vault again.
- Only Windows has been tested. The macOS and Linux paths (`cp`, `open`, `xdg-open`) have not been run.

## Files

- `main.js`: the view.
- `md.js`: Obsidian markdown to what the text view draws.
- `vault.js`: which file a link names, and the list's rows.
- `platform.js`: opening a URL and copying a file on each system.
- `vault.svg`: an icon for a side panel button.

`md.js` and `vault.js` have tests: `sh vaultr/tests/run.sh` in the repo.
