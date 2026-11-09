// E2: auto-closing brackets and quotes for the built-in editor. Pure: decisions on one line's text.

export const PAIRS = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'", "`": "`" };
const CLOSERS = new Set(Object.values(PAIRS));

/**
 * What typing `ch` at `col` of a line does: { skip: true } steps over the same closer already
 * there, { insert } types the pair (the cursor goes between), null types `ch` alone.
 * A pair is only added before whitespace, the line end, or punctuation that ends an expression,
 * and a quote not right after a word character (so "don't" stays one quote).
 */
export function typed(ch, text, col) {
  const prev = text[col - 1] ?? "", next = text[col] ?? "";
  if (CLOSERS.has(ch) && next === ch) return { skip: true };
  const close = PAIRS[ch];
  if (!close) return null;
  if (next !== "" && !/[\s)\]},;:.]/.test(next)) return null;
  if (close === ch && /[\w\\]/.test(prev)) return null;
  return { insert: ch + close };
}

/** The cursor sits inside an empty pair, "(|)": Backspace removes both. */
export function inEmptyPair(text, col) {
  return col > 0 && PAIRS[text[col - 1]] !== undefined && PAIRS[text[col - 1]] === text[col];
}

/** The cursor sits between an opening and closing bracket, "{|}": Enter opens an indented line. */
export function betweenBrackets(text, col) {
  const o = text[col - 1];
  return (o === "(" || o === "[" || o === "{") && PAIRS[o] === text[col];
}
