// Quick Open (ctrl-p): fuzzy file search like VS Code's. Pure. Scoring follows fzy: matched
// letters earn bonuses at the start of a path part, a word or a camelCase hump, more when they
// run together, and gaps cost a little; a match inside the file name (not its folders) ranks higher.

const GAP_LEAD = -0.005, GAP_TRAIL = -0.005, GAP_INNER = -0.01, CONSEC = 1.0, IN_NAME = 1.5;

function bonuses(s) {
  const b = new Float64Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const p = i ? s[i - 1] : "/", c = s[i];
    b[i] = p === "/" || p === "\\" ? 0.9 : p === "-" || p === "_" || p === " " ? 0.8 : p === "." ? 0.6
      : /[a-z]/.test(p) && /[A-Z]/.test(c) ? 0.7 : 0;
  }
  return b;
}

/** How well `q` matches `s` ({ score, pos } with the matched indexes), or null when it doesn't. */
export function fuzzy(q, s) {
  q = q.replace(/\s+/g, "");
  const n = q.length, m = s.length;
  if (!n) return { score: 0, pos: [] };
  const ql = q.toLowerCase(), sl = s.toLowerCase();
  let k = 0;
  for (let i = 0; i < m && k < n; i++) if (sl[i] === ql[k]) k++;
  if (k < n) return null;
  const B = bonuses(s), D = [], M = [];
  for (let i = 0; i < n; i++) {
    D.push(new Float64Array(m).fill(-Infinity)); M.push(new Float64Array(m).fill(-Infinity));
    const gap = i === n - 1 ? GAP_TRAIL : GAP_INNER;
    let prev = -Infinity;
    for (let j = 0; j < m; j++) {
      if (sl[j] === ql[i]) {
        let sc = -Infinity;
        if (!i) sc = j * GAP_LEAD + B[j];
        else if (j) sc = Math.max(M[i - 1][j - 1] + B[j], D[i - 1][j - 1] + CONSEC);
        D[i][j] = sc;
        prev = M[i][j] = Math.max(sc, prev + gap);
      } else prev = M[i][j] = prev + gap;
    }
  }
  // Walk back for the positions of the best match.
  const pos = new Array(n);
  let required = false;
  for (let i = n - 1, j = m - 1; i >= 0; i--) {
    for (; j >= 0; j--) {
      if (D[i][j] !== -Infinity && (required || D[i][j] === M[i][j])) {
        required = i > 0 && j > 0 && M[i][j] === D[i - 1][j - 1] + CONSEC;
        pos[i] = j--;
        break;
      }
    }
  }
  const name = s.lastIndexOf("/") + 1;
  return { score: M[n - 1][m - 1] + (pos[0] >= name ? IN_NAME : 0), pos };
}

/** A query's file part and its ":line" or ":line:column" suffix (1-based in, 0-based out). */
export function parseQuery(text) {
  const m = /^(.*?)(?::(\d*)(?::(\d*))?)?\s*$/.exec(text.trim());
  const at = m[2] ? { line: Math.max(0, +m[2] - 1), col: m[3] ? Math.max(0, +m[3] - 1) : 0 } : null;
  return { name: m[1].trim(), at };
}

/**
 * The best `limit` matches for `name` among `items` ({ rel, ... }), best first; ties go to the
 * shorter path. With an empty name, the items as given.
 */
export function rank(items, name, limit = 50) {
  if (!name) return items.slice(0, limit).map((it) => ({ ...it, pos: [] }));
  const out = [];
  for (const it of items) {
    const r = fuzzy(name, it.rel);
    if (r) out.push({ ...it, score: r.score, pos: r.pos });
  }
  out.sort((a, b) => b.score - a.score || a.rel.length - b.rel.length);
  return out.slice(0, limit);
}
