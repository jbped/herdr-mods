# Notifyr

Records every notification Herdr shows in a layout and lists them later.

## How it works

Herdr has no notification history and no event for one. A layout's root `"toast": "<mod>"` names the mod that draws every notification, Herdr's own and every `notify()`. Notifyr is that mod: it draws the toast as Herdr's `toast` mod does and adds it to the record when the toast appears.

One mod, three views, chosen by props:

| View | Props | Where |
|---|---|---|
| toast | `{title, body, level, icon, action, timeout, overlay}` from Herdr | the layout root's `"toast": "notifyr"` |
| bell | `{ "bell": true }`, optional `"bare": true` | a block in your layout |
| list | none, or `{ "list": true }` | `mod.open:notifyr`, a dialog 440px wide and 70% high, with vim keys |

## Read state

Every entry is unread until one of these happens. The list shows which one, under the time.

| Shown | When |
|---|---|
| clicked | you clicked its toast (or its Copy button) |
| visited | you arrived at its space, or focused its terminal, after it was recorded |
| opened | you went to it from the list |
| seen | it has nowhere to go, and the list showed it |
| read | you marked it with `r`, `R` or "Mark all read" |

- The space and terminal come from the toast's action when it is recorded: `terminal`, `space`, `tab` or `pane` in its arguments, or the `id` of a `space.*` or `tab.*` command. Herdr's agent notices carry `agent.focus {terminal}`.
- Only arriving counts. A toast for the space you are already in stays unread until you click it, focus its terminal, or leave and come back.
- A toast that times out without a click stays unread.
- Visits are watched by the bell, and by the list while it is open. A layout without the bell records toasts but only marks visits while the list is open.

## The bell

```json
{ "id": "notifyr-bell", "type": "block", "size": { "px": 48 }, "content": { "mod": "notifyr", "props": { "bell": true } } }
```

- It shows a bell in `muted`. With unread entries it turns `accent` and shows the count, up to "99+".
- A click runs `mod.open {name: "notifyr"}`.
- It draws the status bar's `chrome` background and top border. `"bare": true` drops both, for a place with its own background such as a tab bar row.

## The list

- Newest first. Each row has an icon, the title, the whole body and the time: "now", "5m", "3h", then "Nov 16". The tooltip on the time is the full date and time.
- The icon is the toast's own when it has one. Otherwise, for an entry that goes to a terminal, it is that terminal's program icon from Herdr's program table (Claude, Codex, a shell), with a small corner dot in the level color when the level is not info. Any other entry gets a glyph in its level color: a ticked circle for success, a triangle for warning, a crossed circle for error, an "i" for info.
- Toasts keep Herdr's plain level dot.
- An unread entry has an `accent` dot and time. A read one is dimmed and shows how it was read.
- An entry with nowhere to go is marked seen when the list opens. It keeps its dot until the list closes.
- The header counts unread entries and has "Mark all read" and "Clear".
- Clicking a row goes to it, as `enter` does.
- If the shown layout's root does not name `notifyr` as its toast mod, a line at the top says so.

| Key | Action |
|---|---|
| `j` / `down`, `k` / `up` | move |
| `g` / `home`, `G` / `end` | first, last |
| `ctrl-d`, `ctrl-u` | half a page (6 entries) |
| `pagedown`, `pageup` | a page (12 entries) |
| `enter` | go: mark it opened, close the list and run its action. With no action it is only marked. |
| `r` | mark read or unread |
| `R` | mark all read |
| `x` or `delete` | delete the entry |
| `X` | delete all |
| `u` | show unread only, again shows all |
| `?` | show every key |
| `q` or `escape` | close |

If the target of an action is gone (a closed terminal), Herdr reports the error.

## Stored state

Shared values, saved by Herdr in `shared.json`:

- `notifyr.log`: at most 200 entries, newest first: `{ id, at, overlay, title, body, level, icon, action, terminal, space, program, read }`.
  - `at` is milliseconds since 1970, taken when the toast appeared. `body` is cut at 600 characters.
  - `terminal` and `space` are where the action goes, or null.
  - `program` is `{ name, icon, tint }` of what ran in that terminal when the toast appeared, or null. It is kept so the icon outlives the terminal.
  - `read` is null while unread, else `{ at, how }` with `how` one of `clicked`, `visited`, `opened`, `listed`, `marked`.
- `notifyr.seen`: written by the first version only. Entries without a `read` field that are older than it count as read.

Any mod can read them with `shared("notifyr.log")`.

## Limits

- Only layouts whose root names `notifyr` are recorded. Toasts shown before install, on another layout, or while the window is closed are not in the list.
- It replaces Herdr's toast mod in that layout, so later changes to Herdr's toasts do not reach it.
- The list is a centered dialog, not a menu at the bell.
- `X` and Clear delete at once, with no confirmation and no undo.
- No search or filter by text.
