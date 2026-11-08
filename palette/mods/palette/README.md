# palette

A command palette that mods can add entries to. It lists every mod's own entries first, then every Herdr app command, each with its key from `keys.json`.

## Install

1. Copy `mods/palette/` to `~/.config/herdr-app/mods/` and run `herdr-app check ~/.config/herdr-app/mods/palette`.
2. Bind a key to open it. To replace Herdr's palette, put this in the `global` section of `~/.config/herdr-app/keys.json` (see `palette/keys.json`):

   ```json
   "ctrl-shift-p": { "command": "mod.open", "args": { "name": "palette" } }
   ```

   Herdr's own palette stays in the list as `app.palette`.

## Use

Type to filter (every word must match), `up` / `down`, `pageup` / `pagedown` or the wheel to move, `enter` to run, `escape` to close. A command with required arguments asks for them first: type a value for its first argument, or a JSON object such as `{"direction": "right", "mod": "wingman"}`. `escape` goes back to the list.

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
