// Drafts: a Request's unsaved edits, in memory only. Module code is shared by every copy of the
// mod, so the panel copy and the pane copy see the same Drafts. Nothing here is ever written to
// disk, shared state or stored state: shared state carries only a counter (`brunr.drafts`) that
// makes the other copies draw again. Request text can hold tokens.
//
// A record is `{ base, text, changed, kept }` for a Request a pane has opened:
// - `base`: the text on disk the editing started from, the `expected` text of a save.
// - `text`: what the editor holds. The Request has a Draft when `text !== base`.
// - `changed`: the text on disk when it changed under a Draft, else null (the pane says so).
// - `kept`: the disk text the person chose "Keep mine" for, so the same change is not reported again.
import { setShared, shared } from "herdr";

export const TICK = "brunr.drafts";

/** The key of a Request: its Machine, Collection root and path. The same as its tree row's key. */
export const draftKey = (machine, root, path) => `${machine ?? ""}|${String(root ?? "").replace(/\\/g, "/").replace(/\/+$/, "")}#${path}`;

/** True when a record holds unsaved edits. */
export const isDraft = (rec) => Boolean(rec) && rec.text !== rec.base;

const clean = (disk) => ({ base: disk, text: disk, changed: null, kept: null });

/**
 * The pure core: the next record after an event. Events:
 * - `{ type: "open", disk }`: a pane shows the Request; `disk` is its text on disk now.
 * - `{ type: "edit", text }`: the editor's text changed.
 * - `{ type: "saved", text }`: `text` was written to disk.
 * - `{ type: "discarded", disk }`: the person discarded the Draft, or reloaded from disk.
 * - `{ type: "disk", disk }`: the file changed on disk.
 * - `{ type: "keep" }`: "Keep mine" after a change on disk.
 * Editing back to the starting text leaves no Draft. A disk change with no Draft moves the starting
 * text to the new one. A disk change under a Draft marks it `changed`, unless the disk now holds
 * the Draft's text, which ends the Draft.
 */
export function reduce(rec, event) {
  switch (event.type) {
    case "open":
    case "disk": {
      const disk = event.disk;
      if (disk == null) return rec;
      if (!isDraft(rec)) return clean(disk);
      if (disk === rec.text) return clean(disk);
      if (disk === rec.base || disk === rec.kept) return { ...rec, changed: null };
      return { ...rec, changed: disk };
    }
    case "edit":
      if (!rec) return null;
      return rec.text === event.text ? rec : { ...rec, text: event.text, ...(event.text === rec.base ? { changed: null, kept: null } : {}) };
    case "saved":
      if (!rec) return null;
      return rec.text === event.text ? clean(event.text) : { ...rec, base: event.text, changed: null, kept: null };
    case "discarded":
      return event.disk == null ? (rec ? clean(rec.changed ?? rec.base) : null) : clean(event.disk);
    case "keep":
      return rec?.changed != null ? { ...rec, kept: rec.changed, changed: null } : rec;
  }
  return rec;
}

// The store

const records = new Map();
let waiters = [];

function changed() {
  const w = waiters;
  waiters = [];
  for (const resolve of w) resolve();
  try { setShared(TICK, ((Number(shared(TICK)) || 0) + 1) % 1000000); } catch {}
}

function apply(key, event) {
  const before = records.get(key) ?? null;
  const after = reduce(before, event);
  if (after === before) return after;
  if (after) records.set(key, after); else records.delete(key);
  changed();
  return after;
}

/** Resolves the next time any Draft changes. */
export function nextChange() { return new Promise((resolve) => waiters.push(resolve)); }

/** The record of a Request, or null. */
export const get = (key) => records.get(key) ?? null;

/** True when the Request has a Draft. */
export const has = (key) => isDraft(records.get(key));

/** Every key with a Draft. */
export const keys = () => [...records].filter(([, r]) => isDraft(r)).map(([k]) => k);

/** A pane shows the Request, whose text on disk is `disk` (null when it cannot be read). */
export const open = (key, disk) => apply(key, { type: "open", disk });

/** The editor's text. */
export const edit = (key, text) => apply(key, { type: "edit", text });

/** `text` was written to disk. */
export const saved = (key, text) => apply(key, { type: "saved", text });

/** Back to the file on disk: `disk` when it was read again, else the last known disk text. */
export const discard = (key, disk = null) => apply(key, { type: "discarded", disk });

/** The file's text on disk changed (or was read again). */
export const diskChanged = (key, disk) => apply(key, { type: "disk", disk });

/** Keeps the Draft after a change on disk. */
export const keep = (key) => apply(key, { type: "keep" });

/**
 * Feeds a reloaded Collection's file texts to the records of that Collection: `collectionKey` is
 * `<machine>|<root>`, `files` maps a relative path to its text.
 */
export function collectionRead(collectionKey, files) {
  const prefix = `${collectionKey}#`;
  for (const key of [...records.keys()]) {
    if (!key.startsWith(prefix)) continue;
    const text = files?.[key.slice(prefix.length)];
    if (typeof text === "string") apply(key, { type: "disk", disk: text });
  }
}

/** The keys of `key` and of everything under it when it is a folder (`<key>/…`). */
const under = (key) => [...records.keys()].filter((k) => k === key || k.startsWith(`${key}/`));

/**
 * A file or folder was renamed or moved: its records, and the records under a folder, take the
 * new key. A record already at a new key is replaced.
 */
export function rekey(from, to) {
  const moved = under(from);
  for (const k of moved) {
    const rec = records.get(k);
    records.delete(k);
    records.set(to + k.slice(from.length), rec);
  }
  if (moved.length) changed();
}

/** An operation wrote `base` over the file under a record: its Draft becomes `text` on top of it. */
export function rebase(key, base, text) {
  const rec = records.get(key);
  if (!rec) return;
  records.set(key, text === base ? { base, text: base, changed: null, kept: null } : { ...rec, base, text, changed: null, kept: null });
  changed();
}

/** A file or folder was deleted: its records, and those under a folder, go. */
export function drop(key) {
  const gone = under(key);
  for (const k of gone) records.delete(k);
  if (gone.length) changed();
}

/** The keys with a Draft at `key` or under it. */
export const draftsUnder = (key) => under(key).filter((k) => isDraft(records.get(k)));

/** Forgets every record. For tests. */
export function clear() { records.clear(); }
