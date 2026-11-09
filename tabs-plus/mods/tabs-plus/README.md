# tabs-plus

Herdr's `tabs` mod (the tab bar) with a side panel that more mods can join. A clone of `tabs` 0.1.14: Herdr never updates clones, so changes to the shipped `tabs` don't reach it.

## What it adds

- **Panel buttons for mod blocks.** Next to Files and Changes, a button for each block in the layout's `panel-body` stack that runs Wingman (one per view: Review, Edit) or Wayfinder. A block only gets a button when the layout has it.
- **A width per panel tab.** Switching to a panel tab resizes the panel to the width it had last time, and dragging the panel records the width for the tab shown. Wingman and Wayfinder start at 960px.
- **Commands for the palette.** `tabs-plus.wingmanReview`, `tabs-plus.wingmanEdit` and `tabs-plus.wayfinder` select that panel tab and show the panel. A palette entry runs one command, and a hidden panel block gets no commands, so the tab bar, which is always shown, does it.

## Install

1. Copy `mods/tabs-plus/` to `~/.config/herdr-app/mods/` and run `herdr-app check ~/.config/herdr-app/mods/tabs-plus`.
2. In a layout of your own (a clone, since Herdr's shipped layouts are read-only), set the `tabs` block's `content.mod` to `tabs-plus`.
3. Add the panel blocks of the mods you use to `panel-body`, and raise the `panel` column's `max` (for example to 2400) so wide tabs fit. See the Wingman and Wayfinder READMEs for their blocks.
