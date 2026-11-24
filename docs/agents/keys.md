# Keys

Every mod uses the same key for the same idea, so a person who knows one mod can guess the next. Moving follows Vim. The other keys follow terminal apps such as less and lazygit, and none of them deletes on a key Vim users press without thinking: `d` is left free. Read this before adding or changing a mod's keys.

## Keys while a mod has the keyboard

| Key | Meaning |
|---|---|
| `j` / `k`, `down` / `up` | move |
| `g` / `G`, `home` / `end` | first / last |
| `ctrl-d` / `ctrl-u` | half a page down / up |
| `h` / `l`, `left` / `right` | fold / unfold, or go to the parent / first child |
| `enter` | the selected item's main action |
| `/` | search. `enter` returns to the list, `esc` clears it, then leaves it |
| `ctrl-n` / `ctrl-p` | the next / previous match, which in a filtered list is the next / previous row. `n` / `N` do the same where nothing can be made new, such as a log window |
| `?` | show or hide every key |
| `q` | close |
| `esc` | step back: a question, a text box, a search, a menu. With nothing to step back from, close. Herdr closes a dialog or popup on `esc` before the mod sees it, so there `esc` only steps back out of a text box; give every other step back a key of its own (`n` for a question) |
| `ctrl-r` | read everything again (refresh, reload) |
| `o` | open outside Herdr: the browser, or the app the item belongs to |
| `y` | copy the item's name or URL |
| `,` | settings |
| `]` / `[` | the next / previous view: a grouping, a vault, a board. `tab` does the same where the mod hears it (Herdr's dialog frame takes `tab` to move focus, so a dialog never sees it) |
| `n` | new |
| `f2` | rename. Herdr binds `f2` to its tab rename, so bind it with `cx.bind_keys` in the mod's own key context and handle it with `on_action` (Brunr, Gitr) |
| `x` / `delete` | end it: delete, stop, stop tracking. Asks first when it cannot be undone |
| `a` | hand the item to an agent in a new space |
| `1` to `9` | the views or tabs, in the order shown |

- A shifted action letter does the same thing to every item in the group or list: `R` marks all read, `X` stops all, `C` folds every group, `A` hands every item to an agent. `G` is the exception: it goes to the last item.
- A question takes `y` or `enter` to go ahead, and `n` or `esc` to cancel.
- Every other letter is the mod's own. Pick one the table does not name, and name it after its action when you can.
- Never take a key from the table for another meaning. When an action has no free letter, use a shifted letter or leave it to the `?` list's buttons.

## Lists you type into

In a list where typing filters (Gitr, a search box with the cursor in it), letters type. There:

- `up` / `down`, `home` / `end`, `pageup` / `pagedown`, `enter` and `esc` mean what they mean above.
- Actions use `ctrl` with a letter. `ctrl-r` reads everything again. `f2` renames.

## The legend

The line of key hints at the bottom of a mod looks the same everywhere: each key in `accent`, its word in `dim`, 11px, 12 to 14px apart. `?` hides the line and shows every key above it on `raised` with a top border. Copy Vaultr's or Dockr's (`kit/legend.js`).

## Opening a mod

A mod that opens as a dialog or a panel takes `ctrl-shift-<letter>` in `keys.json` (`alt-shift-<letter>` when the `ctrl` one is taken). Pressing it again closes the mod.
