// A string as Bruno's YAML writer emits it: `yaml` 2.x stringify with defaultStringType PLAIN and
// lineWidth 0, for a map value (not a key, not inside a flow collection). Ported from
// yaml/dist/stringify/stringifyString.js so the output matches byte for byte. Pure.

const CORE_TAGS = [
  /^(?:~|[Nn]ull|NULL)?$/,
  /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
  /^0o[0-7]+$/,
  /^[-+]?[0-9]+$/,
  /^0x[0-9a-fA-F]+$/,
  /^(?:[-+]?\.(?:inf|Inf|INF|nan|NaN|NAN))$/,
  /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
  /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
];
const NEEDS_QUOTES = /^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/;
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u;
const MIN_MULTILINE = 40;
const NAMED = { "0000": "\\0", "0007": "\\a", "000b": "\\v", "001b": "\\e", "0085": "\\N", "00a0": "\\_", 2028: "\\L", 2029: "\\P" };

/**
 * The scalar text after `key: `. `indent` is the indentation of the value's own lines (the key's
 * column plus two spaces); it is used only when the result spans lines.
 */
export function yamlScalar(value, indent = "  ") {
  const s = String(value ?? "");
  if (CONTROL.test(s)) return doubleQuoted(s, indent);
  return plain(s, indent);
}

function plain(value, indent) {
  if (!value || NEEDS_QUOTES.test(value)) return value.includes("\n") ? block(value, indent) : quoted(value, indent);
  if (value.includes("\n")) return block(value, indent);
  if (CORE_TAGS.some((re) => re.test(value))) return quoted(value, indent);
  return value;
}

function quoted(value, indent) {
  const hasDouble = value.includes('"');
  const hasSingle = value.includes("'");
  return hasDouble && !hasSingle ? singleQuoted(value, indent) : doubleQuoted(value, indent);
}

function singleQuoted(value, indent) {
  if (/[ \t]\n|\n[ \t]/.test(value)) return doubleQuoted(value, indent);
  return "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&\n${indent}`) + "'";
}

function doubleQuoted(value, indent) {
  const json = JSON.stringify(value);
  let str = "";
  let start = 0;
  for (let i = 0, ch = json[i]; ch; ch = json[++i]) {
    if (ch === " " && json[i + 1] === "\\" && json[i + 2] === "n") {
      str += json.slice(start, i) + "\\ ";
      i += 1;
      start = i;
      ch = "\\";
    }
    if (ch !== "\\") continue;
    if (json[i + 1] === "u") {
      str += json.slice(start, i);
      const code = json.substr(i + 2, 4);
      str += NAMED[code] ?? (code.substr(0, 2) === "00" ? "\\x" + code.substr(2) : json.substr(i, 6));
      i += 5;
      start = i + 1;
    } else if (json[i + 1] === "n") {
      if (json[i + 2] === '"' || json.length < MIN_MULTILINE) {
        i += 1;
      } else {
        str += json.slice(start, i) + "\n\n";
        while (json[i + 2] === "\\" && json[i + 3] === "n" && json[i + 4] !== '"') {
          str += "\n";
          i += 2;
        }
        str += indent;
        if (json[i + 2] === " ") str += "\\";
        i += 1;
        start = i + 1;
      }
    } else {
      i += 1;
    }
  }
  return start ? str + json.slice(start) : json;
}

const BLOCK_END_NEWLINES = /(^|(?<!\n))\n+(?!\n|$)/g;

function block(input, indent) {
  if (/\n[\t ]+$/.test(input) || /^\s*$/.test(input)) return quoted(input, indent);
  let value = input;
  let endStart = value.length;
  for (; endStart > 0; --endStart) {
    const ch = value[endStart - 1];
    if (ch !== "\n" && ch !== "\t" && ch !== " ") break;
  }
  let end = value.substring(endStart);
  const endNl = end.indexOf("\n");
  const chomp = endNl === -1 ? "-" : value === end || endNl !== end.length - 1 ? "+" : "";
  if (end) {
    value = value.slice(0, -end.length);
    if (end[end.length - 1] === "\n") end = end.slice(0, -1);
    end = end.replace(BLOCK_END_NEWLINES, `$&${indent}`);
  }
  let startWithSpace = false;
  let startEnd = 0;
  let startNl = -1;
  for (; startEnd < value.length; ++startEnd) {
    const ch = value[startEnd];
    if (ch === " ") startWithSpace = true;
    else if (ch === "\n") startNl = startEnd;
    else break;
  }
  let start = value.substring(0, startNl < startEnd ? startNl + 1 : startEnd);
  if (start) {
    value = value.substring(start.length);
    start = start.replace(/\n+/g, `$&${indent}`);
  }
  const header = "|" + (startWithSpace ? (indent ? "2" : "1") : "") + chomp;
  return `${header}\n${indent}${start}${value.replace(/\n+/g, `$&${indent}`)}${end}`;
}
