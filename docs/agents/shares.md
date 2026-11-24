# Shares

A share is a top-level folder that a visitor installs as one unit:

```
<share>/
  README.md      the page a visitor reads
  preview.png    one screenshot, also the picture herdr.dev shows
  RECIPE.md      the brief herdr.dev needs (format: "Layouts and mods other people made" in ~/.config/herdr-app/AGENTS.md)
  keys.json      the keys it expects, when it has any
  mods/<name>/   the mod, with its README.md as the full reference
```

`./check.sh` holds the page's rules and writes the list of shares in the root `README.md` from each page's title, summary and `preview.png`. Change that list only through the pages.

## Two READMEs

- **The page**, `<share>/README.md`, answers what a visitor asks before installing: what is it, what does it do, what does it need and touch, how do I install it. Copy the shape of `palette/README.md`.
- **The reference**, `<share>/mods/<name>/README.md`, holds everything else: keys, config, settings, limits, how it works. It is copied into the person's config with the mod.

A fact lives in one of the two. The page's last line links to the reference and names what is there.

Writing the page:

- Summary: one sentence a person who has never seen the mod understands.
- Features: every feature a person can use, as `- **Name.** one or two sentences`, the biggest first. A person who reads only this list knows everything the mod offers. How it works goes in the reference.
- Needs: programs, platforms, what it replaces or rebinds, then what it touches: programs it runs, files it reads or writes outside its own folder, network.
- Install: the agent prompt, then the by-hand steps, ending on `herdr-app check`.
- Use: how to open it and the mouse actions in a sentence or two, then a table of the keys a person needs on day one. The full key list goes in the reference.

## Updating a mod

Mods are edited in `~/.config/herdr-app/mods/`, where Herdr hot-reloads them, then copied here.

1. `./sync.sh <share>` copies the mod from the config folder into the worktree.
2. Update the reference for what changed.
3. Update the page when the change adds, removes or alters a feature, a day-one key, a need, something it touches or an install step.
4. Retake `preview.png` when the look changed.
5. Update `RECIPE.md`, when the share has one, from the real files.
6. `./check.sh` prints `ok`. Commit the root `README.md` when it wrote it.

## Adding a share

1. Create `<share>/mods/<name>/`, then `./sync.sh <share>`.
2. Choose its keys from `docs/agents/keys.md`. Add `keys.json` with the keys it expects, and a `LICENSE` when the mod is cloned from someone else's.
3. Write the reference, then the page.
4. Take `preview.png`.
5. `./check.sh` prints `ok`.

## preview.png

Take it with `herdr-app shot <share>/preview.png` in a private Herdr app, showing the mod in use with made-up repos, branches, tickets and names. The picture is public, so every word in it must be one you would publish.

For a styled preview, treat Dockr's preview as the composition reference:

- Keep the real mod interface dominant, large and readable. Do not invent, redraw or substantially crop its UI.
- Put the display title above the interface and align its left edge with the interface frame. Use the public product name, not the folder slug; for example, `Agents+` and `Tabs+`.
- Keep the title visually attached to the interface: target roughly 16–24 pixels between the title's visible bottom and the frame. Increase that gap only when the available header space would otherwise clip or crowd the title, as in Dockr.
- Use one clean sans-serif typeface and consistent title sizing across the set.
- Give each mod its own restrained accent palette while keeping the overall dark developer-tool aesthetic.
- Add depth with soft directional light, an illuminated frame, shadow and sparse corner geometry. Avoid flat template backgrounds, decorative ribbons, stages and busy glass layers.
- Use a 16:10 canvas to match the Herdr Gallery's 960×600 image slot. Preserve comparable outer margins, but let the interface's natural proportions determine its exact height; extend the background instead of stretching the interface.
- Generate or capture each interface first, then add title, framing and layout deterministically so image generation cannot drift typography or alignment.
- Review the previews together before publishing. Check title spelling, alignment, interface fidelity, public-safe data and visual weight at gallery size.
