import { realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute, sep } from "node:path";

const port = Number(process.env.PORT ?? 3000);
const baseUrl = (
  process.env.BASE_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : `http://localhost:${port}`)
).replace(/\/+$/, "");
const publicDir = process.env.PUBLIC_DIR ? await realpath(process.env.PUBLIC_DIR) : null;
const links = new Map();
const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body, status = 200) {
  return Response.json(body, { status, headers: cors });
}

function generateCode() {
  let code = "";
  const bytes = new Uint8Array(16);
  while (code.length < 6) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte < 248) code += alphabet[byte % 62];
      if (code.length === 6) break;
    }
  }
  return code;
}

async function staticFile(pathname) {
  if (!publicDir) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const candidate = resolve(publicDir, `.${decoded === "/" ? "/index.html" : decoded}`);
  const within = (path) => {
    const rel = relative(publicDir, path);
    return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  };
  if (!within(candidate)) return null;
  try {
    const actual = await realpath(candidate);
    if (!within(actual)) return null;
    const file = Bun.file(actual);
    return (await file.exists()) ? file : null;
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  }
}

Bun.serve({
  port,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (pathname === "/api/links") {
      if (request.method === "GET") return json([...links.values()]);
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }
      if (!body || typeof body.url !== "string" || /[\x00-\x1f\x7f]/.test(body.url)) {
        return json({ error: "Invalid URL" }, 400);
      }
      try {
        const url = new URL(body.url);
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Invalid scheme");
      } catch {
        return json({ error: "Invalid URL" }, 400);
      }
      let code;
      do {
        code = generateCode();
      } while (links.has(code));
      const link = { code, url: body.url, shortUrl: `${baseUrl}/${code}`, hits: 0, createdAt: new Date().toISOString() };
      links.set(code, link);
      return json(link, 201);
    }

    if (request.method === "GET" || request.method === "HEAD") {
      const file = await staticFile(pathname);
      if (file) return new Response(request.method === "HEAD" ? null : file, { headers: cors });
      if (request.method === "GET" && /^\/[^/]+$/.test(pathname)) {
        const link = links.get(pathname.slice(1));
        if (link) {
          link.hits++;
          return new Response(null, { status: 302, headers: { ...cors, Location: new URL(link.url).href } });
        }
      }
    }
    return json({ error: "Not found" }, 404);
  },
});

console.log(`Snip listening on port ${port}`);
