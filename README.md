# Snip frontend

Angular 19 client for the shared Snip API. Source files live at the root of the
independent `frontend` branch; `main` mounts this branch as a submodule.

Run the backend on port 3000, then `npm ci` and `npm start` here. Open
http://localhost:4200. Angular's development proxy forwards `/api` to
http://localhost:3000. Production requests stay on the page's origin so the
generated bundle can serve UI and API together without a hard-coded hostname.

The reactive form accepts HTTP(S) URLs, prevents concurrent submissions, displays
API/network errors beside the field and reloads the table after creation. The
table displays short codes linked to the server's `shortUrl`, original URLs and
hit counts. Use **Refresh links** after visiting a short link to update hits.
Links open in new tabs. Storage is in memory; backend restarts clear all records.

| Method | Path | Result |
| --- | --- | --- |
| POST | `/api/links` | `{ url }` returns 201 `{ code, url, shortUrl, hits, createdAt }`, or 400 `{ error }` |
| GET | `/api/links` | Array of the same link objects |
| GET | `/:code` | Backend redirects with 302 and increments hits, or returns 404 |

`npm run build` must produce `dist/snip-frontend/browser/index.html`. Keep the
project name and output path unchanged: bundle generation depends on them.

Run `npm test -- --watch=false --browsers=ChromeHeadless` for focused component
and HTTP tests. Set `CHROME_BIN` to a Chromium-compatible browser executable
when it is not discovered automatically. Tests cover validation, successful
creation/list refresh, pending requests, failures and retry.

Manual checks: keyboard navigation and visible focus, announced errors/results,
readable narrow-screen layout, and a created link visible to the CLI. Keep
generated `bundle` files untouched; publish source changes on `frontend`, then
update the superproject's submodule pointer.
