// E5: line wrap for the built-in editor. Pure. A long line becomes segments that each fit
// `width` display columns, broken after a space when there is one (else mid-word, like VS Code).
// Continuation segments are indented like the line itself ("same" wrapping indent) unless that
// indent takes half the width or more.
import { visualCol } from "./edit.js";

/** The line's segments: [{ from, to, ind }] (character range, indent in display columns). */
export function segments(text, width) {
  width = Math.max(8, Math.floor(width));
  const len = text.length;
  if (visualCol(text, len) <= width) return [{ from: 0, to: len, ind: 0 }];
  const lead = visualCol(text, /^\s*/.exec(text)[0].length);
  const ind = lead < width / 2 ? lead : 0;
  const out = [];
  let from = 0;
  while (from < len) {
    const room = out.length ? width - ind : width, v0 = visualCol(text, from);
    let to = from;
    while (to < len && visualCol(text, to + 1) - v0 <= room) to++;
    if (to === from) to = from + 1; // one character wider than the room (a tab at a narrow width)
    if (to < len) {
      // Break after the last space in the segment, keeping at least one other character on it.
      const sp = text.lastIndexOf(" ", to - 1);
      if (sp >= from && sp + 1 > from && text.slice(from, sp).trim()) to = sp + 1;
    }
    out.push({ from, to, ind: out.length ? ind : 0 });
    from = to;
  }
  return out;
}

/** The segment holding column `col`: the one it starts or sits inside; the line end goes to the last. */
export function segmentOf(segs, col) {
  for (let i = 0; i < segs.length; i++) if (col < segs[i].to || i === segs.length - 1) return i;
  return segs.length - 1;
}
