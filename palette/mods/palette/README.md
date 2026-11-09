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

Type to filter (every word must match), `up` / `down`, `pageup` / `pagedown` or the wheel to move, `shift-up` / `shift-down` to jump to the previous or next group, `enter` to run, `escape` to close. A command with required arguments asks for them first: type a value for its first argument, or a JSON object such as `{"direction": "right", "mod": "wingman"}`. `escape` goes back to the list.

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
