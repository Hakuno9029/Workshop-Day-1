# Snip CLI

A zero-dependency Node.js command-line client for the Snip URL shortener.
Node.js 20 or newer is required.

```sh
node cli.js help
node cli.js add https://example.com
node cli.js ls
node cli.js open ABC123
```

Set `SNIP_API` to the backend origin when it is not `http://localhost:3000`.
The `snip`, `snip.cmd`, and `snip.ps1` wrappers run `cli.js` with Node.js.

Run the focused tests with `npm test`.
