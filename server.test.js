import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

let server;
let directory;
let origin;

async function unusedPort() {
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await fetch(`${url}/api/links`)).ok) return;
    } catch {
      await Bun.sleep(50);
    }
  }
  throw new Error("Backend did not start");
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "snip-backend-"));
  await writeFile(join(directory, "index.html"), "Snip UI");
  await writeFile(join(directory, "asset.txt"), "static asset");
  const port = await unusedPort();
  origin = `http://127.0.0.1:${port}`;
  server = Bun.spawn([process.execPath, "server.js"], {
    env: { ...process.env, PORT: String(port), BASE_URL: "https://short.example", PUBLIC_DIR: directory },
    stdout: "ignore",
    stderr: "inherit",
  });
  await waitForServer(origin);
});

afterAll(async () => {
  if (server) {
    server.kill();
    await server.exited;
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("Snip API", () => {
  test("validates inputs and returns CORS headers", async () => {
    for (const body of ["{", "null", JSON.stringify({ url: "file:///etc/passwd" }), JSON.stringify({ url: 3 }), JSON.stringify({ url: "https://example.com/\r\nbad" })]) {
      const response = await fetch(`${origin}/api/links`, { method: "POST", body });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBeTruthy();
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
    }
    const preflight = await fetch(`${origin}/api/links`, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
  });

  test("creates, lists and redirects while tracking hits", async () => {
    const response = await fetch(`${origin}/api/links`, {
      method: "POST",
      body: JSON.stringify({ url: "https://example.com/path" }),
    });
    expect(response.status).toBe(201);
    const link = await response.json();
    expect(link.code).toMatch(/^[a-zA-Z0-9]{6}$/);
    expect(link.shortUrl).toBe(`https://short.example/${link.code}`);
    expect(link.hits).toBe(0);
    expect(new Date(link.createdAt).toISOString()).toBe(link.createdAt);
    expect(await (await fetch(`${origin}/api/links`)).json()).toEqual([link]);
    const redirect = await fetch(`${origin}/${link.code}`, { redirect: "manual" });
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe(link.url);
    expect((await (await fetch(`${origin}/api/links`)).json())[0].hits).toBe(1);
    expect((await fetch(`${origin}/unknown`)).status).toBe(404);
    await writeFile(join(directory, link.code), "file wins");
    expect(await (await fetch(`${origin}/${link.code}`)).text()).toBe("file wins");
    expect((await (await fetch(`${origin}/api/links`)).json())[0].hits).toBe(1);
  });

  test("serves static files without escaping the public directory", async () => {
    expect(await (await fetch(`${origin}/`)).text()).toBe("Snip UI");
    expect(await (await fetch(`${origin}/asset.txt`)).text()).toBe("static asset");
    expect((await fetch(`${origin}/%2e%2e%2fserver.js`)).status).toBe(404);
  });

  test("uses the configured base URL, Railway domain, or local port in order", async () => {
    for (const [base, railway, expected] of [
      ["https://configured.example/", "railway.example", "https://configured.example"],
      ["", "railway.example", "https://railway.example"],
      ["", "", null],
    ]) {
      const port = await unusedPort();
      const url = `http://127.0.0.1:${port}`;
      const child = Bun.spawn([process.execPath, "server.js"], {
        env: { ...process.env, PORT: String(port), BASE_URL: base, RAILWAY_PUBLIC_DOMAIN: railway, PUBLIC_DIR: "" },
        stdout: "ignore",
        stderr: "inherit",
      });
      try {
        await waitForServer(url);
        expect(await (await fetch(`${url}/api/links`)).json()).toEqual([]);
        const response = await fetch(`${url}/api/links`, {
          method: "POST",
          body: JSON.stringify({ url: "https://example.com" }),
        });
        const link = await response.json();
        expect(link.shortUrl).toBe(`${expected ?? `http://localhost:${port}`}/${link.code}`);
      } finally {
        child.kill();
        await child.exited;
      }
    }
  });
});
