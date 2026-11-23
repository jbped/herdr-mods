// A tiny made-up "Shop" API for producing real `bru run` reports.
// node brunr/tests/fixtures/server.mjs [port]   (default 47911)
import { createServer } from "node:http";
import { createHash } from "node:crypto";

const port = Number(process.argv[2] || 47911);
const products = [{ id: 1, name: "Teapot", price: 12.5 }, { id: 2, name: "Kettle", price: 30 }];

const send = (res, status, type, body) => {
  res.writeHead(status, { "content-type": type, "x-shop": "fixture" });
  res.end(body);
};
const json = (res, status, value) => send(res, status, "application/json; charset=utf-8", JSON.stringify(value));

const routes = {
  "GET /health": (req, res) => json(res, 200, { ok: true, service: "shop" }),
  "GET /products": (req, res) => json(res, 200, products),
  "GET /products/page": (req, res) => send(res, 200, "text/html; charset=utf-8", "<!doctype html><html><body><h1>Products</h1></body></html>"),
  "GET /products/top": (req, res) => json(res, 200, [products[0]]),
  "GET /slow": (req, res) => setTimeout(() => json(res, 200, { slow: true }), 400),
  "POST /orders": (req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => json(res, 201, { id: 7, received: body ? JSON.parse(body) : null }));
  },
};

/**
 * Echoes the request it received: method, path with query, headers and body as text. The CLI's
 * report masks secret values (an authorization or API key header, an API key in the query), so
 * the SHA-256 of each header value (as `[name, hash]` pairs, since the report masks by key)
 * and of the URL are echoed too.
 */
function echo(req, res) {
  let body = "";
  req.on("data", (c) => { body += c; });
  const sha = (v) => createHash("sha256").update(String(v)).digest("hex");
  const sha256 = { url: sha(req.url), headers: Object.entries(req.headers).map(([k, v]) => [k, sha(v)]) };
  req.on("end", () => json(res, 200, { method: req.method, url: req.url, headers: req.headers, body, sha256 }));
}

createServer((req, res) => {
  if (req.url.startsWith("/echo")) return echo(req, res);
  const route = routes[`${req.method} ${req.url.split("?")[0]}`];
  if (route) return route(req, res);
  json(res, 404, { error: "not found", path: req.url });
}).listen(port, "127.0.0.1", () => console.log(`shop fixture on http://127.0.0.1:${port}`));
