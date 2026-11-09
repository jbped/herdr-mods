// E6: find and replace in the current file. Pure: matching works line by line.

const MAX = 10000;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The search for a query: { re }, { error } for a bad regular expression, or null for none. */
export function compile(query, { regex = false, cased = false, word = false } = {}) {
  if (!query) return null;
  let src = regex ? query : escape(query);
  if (word) src = `\\b(?:${src})\\b`;
  try { return { re: new RegExp(src, cased ? "g" : "gi") }; }
  catch (e) { return { error: String(e.message ?? e) }; }
}

/** Every match in `texts` (one string per line), in order: { line, from, to }. Empty matches are skipped. */
export function findAll(texts, re) {
  const out = [];
  for (let line = 0; line < texts.length && out.length < MAX; line++) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(texts[line])) && out.length < MAX) {
      if (!m[0]) { re.lastIndex++; continue; }
      out.push({ line, from: m.index, to: m.index + m[0].length });
    }
  }
  return out;
}

const before = (m, p) => m.line < p.line || (m.line === p.line && m.from < p.col);

/** The match after position p (inclusive when `at`), wrapping around; -1 when there are none. */
export function nextMatch(ms, p, at = false) {
  if (!ms.length) return -1;
  const i = ms.findIndex((m) => (at ? !before(m, p) : m.line > p.line || (m.line === p.line && m.from > p.col)));
  return i < 0 ? 0 : i;
}

/** The match before position p, wrapping around; -1 when there are none. */
export function prevMatch(ms, p) {
  if (!ms.length) return -1;
  for (let i = ms.length - 1; i >= 0; i--) if (before(ms[i], p)) return i;
  return ms.length - 1;
}

/** What one match becomes: the replacement text, with $1 and the like for a regular expression. */
export function replacement(text, re, repl, regex) {
  return regex ? text.replace(new RegExp(re.source, re.flags.replace("g", "")), repl) : repl;
}

/** "12" or "12:5" (1-based) as a position, or null. */
export function parseLine(s) {
  const m = /^\s*(\d+)\s*(?::\s*(\d+))?\s*$/.exec(s);
  return m ? { line: Math.max(0, +m[1] - 1), col: m[2] ? Math.max(0, +m[2] - 1) : 0 } : null;
}
