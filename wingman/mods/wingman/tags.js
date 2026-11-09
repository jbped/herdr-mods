// E4: auto-closing tags for the built-in editor, like VS Code's. Pure: decisions on the text
// before the cursor. Typing ">" that ends an opening tag adds its closing tag after the cursor;
// typing "/" right after "<" completes the innermost tag still open.

const HTML = "html htm xhtml vue svelte astro php";
const XML = "xml svg xsl xslt xaml csproj fsproj vbproj props targets config resx plist";
const JSX = "jsx tsx";
const KIND = {};
for (const e of HTML.split(" ")) KIND[e] = "html";
for (const e of XML.split(" ")) KIND[e] = "xml";
for (const e of JSX.split(" ")) KIND[e] = "jsx";

/** "html", "xml", "jsx" for a path whose files hold tags, else null. */
export function tagKind(path) {
  return KIND[path.split("/").pop().toLowerCase().split(".").pop()] ?? null;
}

// HTML elements that never have a closing tag.
const VOID = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
const NAME = /^[A-Za-z][\w:.-]*/;
const LOOKBACK = 50; // lines

/** The text before the cursor, the last LOOKBACK lines of it. */
function before(lines, line, col) {
  return [...lines.slice(Math.max(0, line - LOOKBACK), line), lines[line].slice(0, col)].join("\n");
}

/**
 * The attributes of a tag from just after its name to where ">" is being typed: true when they
 * read as attributes (name, name="v", name='v', name={expr}, {...spread}), so "a < b && c >" isn't
 * taken for a tag. Ends with "/" (self-closing) or anything else: false.
 */
function attrsOk(s, jsx) {
  let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const braces = () => {
    let depth = 0;
    for (; i < s.length; i++) {
      const ch = s[i];
      if (ch === '"' || ch === "'" || ch === "`") { const end = s.indexOf(ch, i + 1); if (end < 0) return false; i = end; }
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) { i++; return true; }
    }
    return false;
  };
  if (s && !/^\s/.test(s)) return false;
  while (true) {
    ws();
    if (i >= s.length) return true;
    if (jsx && s[i] === "{") { if (!braces()) return false; continue; }
    const name = /^[^\s"'<>\/=`{}]+/.exec(s.slice(i));
    if (!name) return false;
    i += name[0].length; ws();
    if (s[i] !== "=") continue;
    i++; ws();
    const q = s[i];
    if (q === '"' || q === "'") { const end = s.indexOf(q, i + 1); if (end < 0) return false; i = end + 1; }
    else if (jsx && q === "{") { if (!braces()) return false; }
    else { const v = /^[^\s"'<>=`]+/.exec(s.slice(i)); if (!v) return false; i += v[0].length; }
  }
}

/**
 * The closing tag to add when ">" is typed at line/col (`lines` hold the text before it), or null.
 * A JSX fragment, "<>", closes with "</>".
 */
export function closingTag(lines, line, col, kind) {
  if (!kind) return null;
  const text = before(lines, line, col), jsx = kind === "jsx";
  const lt = text.lastIndexOf("<");
  if (lt < 0) return null;
  const tag = text.slice(lt + 1);
  if (jsx && /[\w$)\]]/.test(text[lt - 1] ?? "")) return null; // a generic, Foo<T>, or a comparison
  if (jsx && tag === "") return "</>";
  const name = NAME.exec(tag)?.[0];
  if (!name) return null;
  if (kind === "html" && VOID.has(name.toLowerCase())) return null;
  return attrsOk(tag.slice(name.length), jsx) ? `</${name}>` : null;
}

/**
 * The tag name and ">" to add when "/" is typed right after "<" at line/col (`lines` hold the
 * text before it): the innermost element opened before the cursor and not yet closed, or null.
 */
export function completeClose(lines, line, col, kind) {
  if (!kind || lines[line][col - 1] !== "<") return null;
  const text = before(lines, line, col - 1);
  const stack = [];
  // Comments, then each tag in order: <name ...>, </name>, self-closing <name ... />.
  const re = /<!--[\s\S]*?-->|<\/([A-Za-z][\w:.-]*)?\s*>|<([A-Za-z][\w:.-]*)((?:[^<>"'{}]|"[^"]*"|'[^']*'|\{[^{}]*\})*?)(\/?)>|<>/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[0].startsWith("<!--")) continue;
    if (m[0] === "<>") { if (kind === "jsx") stack.push(""); continue; }
    if (m[0].startsWith("</")) {
      const name = m[1] ?? "";
      const at = stack.lastIndexOf(name);
      if (at >= 0) stack.length = at;
      continue;
    }
    if (m[4] || (kind === "html" && VOID.has(m[2].toLowerCase()))) continue;
    stack.push(m[2]);
  }
  if (!stack.length) return null;
  return stack[stack.length - 1] + ">";
}

/** The cursor sits between an opening tag and its closing tag, "<p>|</p>": Enter opens an indented line. */
export function betweenTags(text, col) {
  const open = /<([A-Za-z][\w:.-]*)[^<>]*>$|<>$/.exec(text.slice(0, col));
  if (!open || /\/>$/.test(open[0])) return false;
  return text.slice(col).startsWith(`</${open[1] ?? ""}>`);
}
