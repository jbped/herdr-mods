// @ts-nocheck
// The report reader: the Bruno CLI's JSON report plus its exit code and output to plain Responses.
// Pure: no Herdr, no Node APIs.

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

/** `text` without ANSI colour and control sequences. */
export function stripAnsi(text) {
  return String(text ?? "").replace(ANSI, "");
}

/** `512 B`, `1.2 KB`, `3.4 MB`. Empty for a missing size. */
export function formatSize(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** `87 ms`, `1.24 s`. Empty for a missing time. */
export function formatTime(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

const clean = (text) => stripAnsi(text).trim();
const EMPTY_SUMMARY = Object.freeze({ requests: 0, passed: 0, failed: 0, skipped: 0, duration: 0 });

function noReport(message) {
  return { ok: false, message, summary: { ...EMPTY_SUMMARY }, responses: [] };
}

const joinLines = (...parts) => parts.filter(Boolean).join("\n");

/** The Run's outcome. See the module header for the shape. Any input field may be missing. */
export function readRun(input) {
  const { reportText, code, stdout, stderr, timedOut } = input ?? {};
  const out = clean(stdout);
  const err = clean(stderr);
  if (timedOut) return noReport("The Run timed out.");
  if (reportText == null || String(reportText).trim() === "") {
    if (code != null && code !== 0) return noReport(err || out || `The Bruno CLI exited with code ${code}.`);
    return noReport(joinLines("The Bruno CLI wrote no report.", err || out));
  }
  let data;
  try {
    data = JSON.parse(String(reportText));
  } catch (e) {
    return noReport(joinLines(`The report is not valid JSON: ${e.message}`, err || out));
  }
  const iterations = Array.isArray(data) ? data : data && Array.isArray(data.results) ? [data] : null;
  if (!iterations) return noReport(joinLines("The report has an unexpected shape.", err || out));
  const results = iterations.flatMap((it) => (it && Array.isArray(it.results) ? it.results : []));
  const skipped = results.filter(isSkipped);
  const responses = results.filter((r) => r && !isSkipped(r)).map(toResponse);
  const passed = responses.filter((r) => r.ok).length;
  const summary = {
    requests: responses.length + skipped.length,
    passed,
    failed: responses.length - passed,
    skipped: skipped.length,
    duration: Math.round(results.reduce((ms, r) => ms + (Number(r?.runDuration) || 0) * 1000, 0)),
  };
  if (responses.length === 0) {
    const reasons = skipped.map((r) => `${pathOf(r)}: ${firstLine(r.error ?? r.response?.statusText) || "skipped"}`);
    return { ok: false, message: joinLines("The Bruno CLI ran no Request.", ...reasons, out), summary, responses };
  }
  return { ok: passed === responses.length, message: null, summary, responses };
}

// The CLI lists a file it could not read, or a Request it would not send, as a skipped result.
const isSkipped = (r) => !r || r.skipped === true || r.status === "skipped" || r.response?.status === "skipped";

const pathOf = (r) => String(r?.path ?? r?.test?.filename ?? "");
const firstLine = (text) => String(text ?? "").trim().split("\n")[0];

function toResponse(r) {
  const req = r.request ?? {};
  const res = r.response ?? {};
  const status = typeof res.status === "number" ? res.status : null;
  const failedNetwork = status === null;
  const tests = testsOf(r);
  const error = typeof r.error === "string" && r.error ? r.error : failedNetwork ? "The Request got no response." : null;
  const path = pathOf(r);
  const { body, language } = bodyOf(res.data, headerValue(res.headers, "content-type"));
  return {
    name: String(r.name || path.slice(path.lastIndexOf("/") + 1) || ""),
    path,
    ok: !failedNetwork && !error && r.status !== "error" && r.status !== "fail" && tests.every((t) => t.ok),
    error,
    method: String(req.method ?? ""),
    url: String(req.url ?? ""),
    requestHeaders: pairs(req.headers),
    requestBody: bodyText(req.data),
    status,
    statusText: failedNetwork ? "" : String(res.statusText ?? ""),
    time: failedNetwork || typeof res.responseTime !== "number" ? null : res.responseTime,
    size: failedNetwork || typeof res.size !== "number" ? null : res.size,
    headers: pairs(res.headers),
    body,
    language,
    tests,
  };
}

function testsOf(r) {
  const asserts = (r.assertionResults ?? []).map((a) => ({
    name: [a.lhsExpr, a.rhsExpr].filter((x) => x != null && x !== "").join(": "),
    kind: "assert",
    ok: a.status === "pass",
    error: a.error ?? null,
  }));
  const scripted = [...(r.preRequestTestResults ?? []), ...(r.testResults ?? []), ...(r.postResponseTestResults ?? [])]
    .map((t) => ({ name: String(t.description ?? ""), kind: "test", ok: t.status === "pass", error: t.error ?? null }));
  return [...asserts, ...scripted];
}

/** Header object to `[name, value]` pairs. Headers set to null were not sent and are left out. */
function pairs(headers) {
  if (!headers || typeof headers !== "object") return [];
  return Object.entries(headers)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v)]);
}

function headerValue(headers, name) {
  const hit = pairs(headers).find(([k]) => k.toLowerCase() === name);
  return hit ? hit[1] : "";
}

/** A body as text: objects and JSON strings pretty-printed, nothing as "". */
function bodyText(data) {
  return parseBody(data).text;
}

function parseBody(data) {
  if (data === null || data === undefined) return { text: "", json: false };
  if (typeof data !== "string") return { text: JSON.stringify(data, null, 2) ?? "", json: true };
  try {
    return { text: JSON.stringify(JSON.parse(data), null, 2), json: true };
  } catch {
    return { text: data, json: false };
  }
}

function bodyOf(data, contentType) {
  const { text, json } = parseBody(data);
  const ct = contentType.toLowerCase();
  const language = /json/.test(ct) ? "json" : /html/.test(ct) ? "html" : /xml/.test(ct) ? "xml" : json && text !== "" ? "json" : "text";
  return { body: text, language };
}
