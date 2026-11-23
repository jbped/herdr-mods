// Text as lines that remember their own line endings, so an edit to one line leaves every other
// byte alone: CRLF files stay CRLF and a missing final newline stays missing. Pure.

/** `[{ body, end }]`: `end` is "\r\n", "\n" or "" (only on the last line). Empty text gives []. */
export function splitLines(text) {
  const s = String(text ?? "");
  const out = [];
  const re = /([^\n]*?)(\r?\n)|([^\n]+)$/g;
  let m;
  while ((m = re.exec(s)) && m[0] !== "") {
    out.push(m[3] !== undefined ? { body: m[3], end: "" } : { body: m[1], end: m[2] });
  }
  return out;
}

export const joinLines = (lines) => lines.map((l) => l.body + l.end).join("");

/** The text's line ending: the first one found, else "\n". */
export function eolOf(text) {
  const m = /\r?\n/.exec(String(text ?? ""));
  return m ? m[0] : "\n";
}

/**
 * `lines` with `count` lines from `at` replaced by `bodies`. Each new line takes the ending of the
 * line it replaces; extra lines take `eol`. The last new line keeps the ending of the last removed
 * line, so a missing final newline stays missing.
 */
export function replaceLines(lines, at, count, bodies, eol) {
  const removed = lines.slice(at, at + count);
  const lastEnd = removed.length ? removed[removed.length - 1].end : null;
  const fresh = bodies.map((body, i) => ({ body, end: removed[i]?.end || eol }));
  if (fresh.length && lastEnd !== null) fresh[fresh.length - 1] = { body: fresh[fresh.length - 1].body, end: lastEnd };
  if (!fresh.length && count && at > 0 && at + count >= lines.length && lastEnd === "") {
    // Removing the last lines of a file with no final newline: the new last line loses its ending.
    const prev = lines[at - 1];
    return [...lines.slice(0, at - 1), { body: prev.body, end: "" }];
  }
  return [...lines.slice(0, at), ...fresh, ...lines.slice(at + count)];
}

/** `lines` with `bodies` inserted before index `at`, ending with `eol`. Keeps a missing final newline. */
export function insertLines(lines, at, bodies, eol) {
  if (!bodies.length) return lines;
  const fresh = bodies.map((body) => ({ body, end: eol }));
  if (at >= lines.length && lines.length && lines[lines.length - 1].end === "") {
    const last = lines[lines.length - 1];
    fresh[fresh.length - 1] = { body: fresh[fresh.length - 1].body, end: "" };
    return [...lines.slice(0, -1), { body: last.body, end: eol }, ...fresh];
  }
  return [...lines.slice(0, at), ...fresh, ...lines.slice(at)];
}

/** The line's text with a leading byte-order mark removed. */
export const bare = (line) => (line?.body ?? "").replace(/^﻿/, "");

export const indentOf = (body) => /^ */.exec(body)[0].length;

export const isBlankOrComment = (body) => /^\s*(#.*)?$/.test(body);
