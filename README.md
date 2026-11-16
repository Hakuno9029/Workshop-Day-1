# Snip backend

A zero-dependency Bun URL shortener. Run `bun start` (Bun 1.x).

| Method | Path | Result |
| --- | --- | --- |
| POST | `/api/links` | JSON `{ "url": "https://example.com" }` returns 201 with `{ code, url, shortUrl, hits, createdAt }`; invalid input returns 400 `{ error }` |
| GET | `/api/links` | Array of link objects |
| GET | `/:code` | 302 to the original URL and increments hits, or 404 |

`PORT` defaults to 3000. Short URLs use `BASE_URL`, then
`https://$RAILWAY_PUBLIC_DOMAIN`, then `http://localhost:$PORT`.
Set `PUBLIC_DIR` to serve static files; `/` serves `index.html`, and existing
files take precedence over short codes. API routes take precedence over files.
CORS is open. Storage is in memory and is erased on restart.

Run `bun test` for API and static-file checks.
