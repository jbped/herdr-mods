# palette

A command palette that mods can add entries to, styled after Herdr's own. It lists your own entries first, under Custom, then every mod's entries, under Mods, then every Herdr app command grouped as Herdr groups them (Tab, Pane, Space, …), each with its key from `keys.json`. A sidebar indexes the groups: click one to jump to it. Commands are labeled with the first clause of their description, since Herdr's own labels aren't available to mods.

## Install

1. Copy `mods/palette/` to `~/.config/herdr-app/mods/` and run `herdr-app check ~/.config/herdr-app/mods/palette`.
2. Bind a key to open it. To replace Herdr's palette, put this in the `global` section of `~/.config/herdr-app/keys.json` (see `palette/keys.json`):

   ```json
   "ctrl-shift-p": { "command": "mod.open", "args": { "name": "palette" } }
   ```

   Herdr's own palette stays in the list as `app.palette`.

## Use

The palette opens with the keyboard on the list: `j` / `k` move and `enter` runs. `/` goes to the search box, where you type to filter (every word must match), and `tab` returns to the list. On the list, `shift-j` / `shift-k` jump to the next or previous group, and `q` closes. In both places `up` / `down` or the wheel move, `ctrl` with `j` / `k` or the arrows moves a page (`pagedown` / `pageup` and `ctrl-d` / `ctrl-u` too), `ctrl-n` / `ctrl-p` move a row, `shift-down` / `shift-up` jump a group, `enter` to run, `escape` to close. A command with required arguments asks for them first: type a value for its first argument, or a JSON object such as `{"direction": "right", "mod": "wingman"}`. `escape` goes back to the list.

## Setting a key

Select an entry and press `ctrl-b`. Type the key, such as `ctrl-shift-g`, `alt-f5` or `f8`, and press `enter`. The palette writes it to the `global` section of `~/.config/herdr-app/keys.json`, in place of the key the entry showed, and Herdr applies it at once. An empty box removes the entry's key. `escape` closes the palette without saving.

- Keys are typed, not pressed, because Herdr runs its own keys before a mod sees them.
- A key needs `ctrl`, `alt` or `cmd`, or is a function key. A sequence is written with spaces: `ctrl-space shift-n`.
- A key that already runs something else shows what it runs. A second `enter` replaces it.
- A key also set in a `terminal`, `layout:<name>` or `mod:<name>` section is named, because that section wins there. The palette never changes those sections.
- A Herdr command with required arguments can't take a key. Add it to `palette.json` with its arguments and set that entry's key.
- Keys a mod handles itself while it is open, such as a list's `j` and `k`, are not in `keys.json` and can't be set here.
- Herdr stops adding new default shortcuts to a `keys.json` that has been edited, by the palette or by hand.

## Adding your own entries

Put a list of entries in `~/.config/herdr-app/palette.json`. No mod needs to change, and reinstalling mods leaves the file alone:

```json
[
  { "title": "Split down", "command": "pane.split", "args": { "direction": "down" }, "about": "Open a terminal below the focused pane" },
  { "title": "Open Wingman", "command": "pane.split", "args": { "direction": "right", "mod": "wingman" } }
]
```

Entries have the same fields as a mod's entries below. If the file isn't valid JSON, the palette leaves it out and logs why.

## Adding a mod's entries

Add a `palette` list to the mod's `mod.json`. Each entry runs one command with fixed arguments:

```json
{
  "place": "none",
  "title": "Wingman",
  "palette": [
    { "title": "Open Wingman", "command": "pane.split", "args": { "direction": "right", "mod": "wingman" }, "about": "Review and edit agent changes beside the focused pane" }
  ]
}
```

`title` and `command` are required. `command` is any command `keys.json` can bind, including `<mod>.<command>`. The palette rereads the mods each time it opens.
