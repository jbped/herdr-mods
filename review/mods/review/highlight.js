// Prism highlighting as per-line spans, tokenized in chunks so Herdr's script
// runtime never runs long enough to interrupt it.
import Prism from "./grammars.js"; // core + JS (prism.js) plus markup, C#, JSON, Markdown, CSS, TS, JSX, TSX

const LANGS = {
  // .js goes through JSX too: React projects often keep JSX in .js files.
  js: "jsx", jsx: "jsx", mjs: "javascript", cjs: "javascript",
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx", // .d.ts ends in .ts
  html: "html", htm: "html", xhtml: "html", // Angular templates are .html
  vue: "vue",
  css: "css", scss: "scss",
  yml: "yaml", yaml: "yaml", // docker-compose.yml, compose.yaml and other YAML
  cs: "csharp", csx: "csharp",
  json: "json", jsonc: "json", json5: "json", webmanifest: "json",
  md: "markdown", markdown: "markdown", mdx: "markdown",
};

// Files known by name rather than extension.
const NAMES = [
  [/^(dockerfile|containerfile)(\..+)?$|\.dockerfile$/, "docker"],
  [/^\.env(\..+)?$|\.env$/, "properties"], // KEY=value lines and # comments
];

export const languageOf = (path) => {
  const name = path.split("/").pop().toLowerCase();
  return NAMES.find(([re]) => re.test(name))?.[1] ?? LANGS[name.split(".").pop()] ?? null;
};

// Prism token tree -> one array of {text, type} spans per line.
function tokenLines(code, grammar) {
  const lines = [[]];
  const walk = (tokens, type) => {
    for (const t of tokens) {
      if (typeof t === "string") {
        t.split("\n").forEach((part, i) => {
          if (i > 0) lines.push([]);
          if (part) lines[lines.length - 1].push({ text: part, type });
        });
      // A token's "content" part (Markdown bold, italic, links) takes its parent's color.
      } else walk(Array.isArray(t.content) ? t.content : [t.content], t.type === "content" ? type : t.type);
    }
  };
  walk(Prism.tokenize(code, grammar), null);
  return lines;
}

/** Per-line spans for `lines`, tokenized in chunks cut at blank lines (multi-line tokens stay whole). */
async function chunked(lines, grammar, cx) {
  if (!grammar) return lines.map((l) => (l ? [{ text: l, type: null }] : []));
  const out = [];
  for (let i = 0; i < lines.length;) {
    let end = Math.min(lines.length, i + 150);
    while (end < lines.length && end < i + 300 && lines[end - 1] !== "") end++;
    out.push(...tokenLines(lines.slice(i, end).join("\n"), grammar));
    i = end;
    await cx.sleep(0);
  }
  return out;
}

/** The grammar for a <script> or <style> block, from its tag and `lang` attribute. */
function blockGrammar(tag, attrs) {
  const lang = /\blang\s*=\s*["']?([\w-]+)/i.exec(attrs)?.[1]?.toLowerCase();
  if (tag.toLowerCase() === "style") return Prism.languages[lang === "scss" ? "scss" : "css"];
  return Prism.languages[{ ts: "typescript", typescript: "typescript", tsx: "tsx", jsx: "jsx" }[lang] ?? "javascript"];
}

/**
 * HTML, Vue and Angular templates: <script> and <style> blocks get their own grammar, the rest
 * the template grammar (HTML plus {{ }}). Splitting first keeps a script with blank lines in it
 * whole, which blank-line chunking alone would cut away from its opening tag.
 */
async function regions(lines, cx) {
  const out = [], template = Prism.languages.template;
  let pending = [];
  const flush = async () => { if (pending.length) { out.push(...(await chunked(pending, template, cx))); pending = []; } };
  for (let i = 0; i < lines.length; i++) {
    const open = /<(script|style)\b([^>]*)>/i.exec(lines[i]);
    const closeRe = open && new RegExp(`</${open[1]}\\s*>`, "i");
    if (!open || closeRe.test(lines[i].slice(open.index))) { pending.push(lines[i]); continue; } // inline: template handles it
    pending.push(lines[i]);
    await flush();
    let j = i + 1;
    while (j < lines.length && !closeRe.test(lines[j])) j++;
    out.push(...(await chunked(lines.slice(i + 1, j), blockGrammar(open[1], open[2]), cx)));
    if (j < lines.length) pending.push(lines[j]);
    i = j;
  }
  await flush();
  return out;
}

/**
 * Spans for a few edited lines, at once, while typing. Each line is tokenized on its own, so
 * a line inside a multi-line comment or a <script> block can be off until the pause re-highlight.
 */
export function highlightLines(lines, language) {
  const grammar = language === "html" || language === "vue" ? Prism.languages.template : language && Prism.languages[language];
  return lines.map((l) => (!l ? [] : grammar ? tokenLines(l, grammar)[0] : [{ text: l, type: null }]));
}

/** Per-line spans for `code`. */
export async function highlight(code, language, cx) {
  const lines = code.replace(/\r/g, "").split("\n");
  if (language === "html" || language === "vue") return regions(lines, cx);
  return chunked(lines, language && Prism.languages[language], cx);
}

export function color(type, t) {
  switch (type) {
    case "keyword": return t.ansi5;
    case "string": case "template-string": return t.ansi2;
    case "comment": return t.dim;
    case "number": case "boolean": case "constant": return t.ansi3;
    case "function": case "function-variable": return t.ansi4;
    case "class-name": return t.ansi3;
    case "operator": return t.ansi6;
    case "regex": return t.ansi1;
    case "punctuation": return t.muted;
    // JSON
    case "property": return t.ansi6;
    case "null": return t.ansi3;
    // C#
    case "namespace": case "attribute": case "generic": case "type-expression": case "constructor-invocation": return t.ansi3;
    case "interpolation-string": return t.ansi2;
    // HTML, Vue, Angular templates, JSX
    case "tag": return t.ansi1;
    case "directive-name": case "control-keyword": return t.ansi5; // v-if, :prop, @click, [x], (y), *ngIf, @if
    case "attr-name": return t.ansi3;
    case "attr-value": return t.ansi2;
    case "entity": return t.ansi6;
    case "doctype": case "prolog": case "cdata": return t.dim;
    // CSS
    case "selector": return t.ansi3;
    case "atrule": case "rule": case "statement": case "module-modifier": return t.ansi5;
    case "placeholder": case "parent": return t.ansi3;
    // TypeScript
    case "builtin": return t.ansi5;
    // Docker, YAML, .env
    case "instruction": return t.foreground; // the whole line; its FROM/RUN/... keyword is colored on its own
    case "variable": return t.ansi6;
    case "key": return t.ansi4;
    case "value": case "scalar": return t.ansi2;
    case "anchor": case "alias": case "directive": return t.ansi3;
    case "datetime": return t.ansi3;
    // Markdown
    case "title": case "important": return t.ansi4;
    case "code": case "code-snippet": case "code-block": case "code-language": return t.ansi2;
    case "url": case "link": return t.ansi4;
    case "list": return t.ansi5;
    case "blockquote": case "hr": return t.dim;
    default: return t.foreground;
  }
}
