#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');

const DEFAULT_API = 'http://localhost:3000';
const USAGE = `Usage:
  snip add <url>    Create a short link
  snip ls           List links and hit counts
  snip open <code>  Open the original URL in your browser
  snip help         Show this help

Set SNIP_API to change the API base URL (default: ${DEFAULT_API}).`;

function apiBase(env) {
  return (env.SNIP_API || DEFAULT_API).replace(/\/+$/, '');
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function request(fetchImpl, url, options) {
  let response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(10000), ...options });
  } catch (error) {
    if (error && error.name === 'TimeoutError') {
      throw new Error('API request timed out.');
    }
    throw new Error(`Could not reach the API: ${error.message}`);
  }
  return response;
}

async function responseError(response) {
  let message = `API request failed (${response.status}).`;
  try {
    const body = await response.json();
    if (body && typeof body.error === 'string' && body.error.trim()) {
      message = body.error.trim();
    }
  } catch {
    // Keep the HTTP status message when the API did not return JSON.
  }
  return new Error(message);
}

function formatLinks(links) {
  if (links.length === 0) return 'No links yet.';

  const rows = links.map(link => [
    String(link.code),
    String(link.hits),
    String(link.url)
  ]);
  const widths = [4, 4, 3].map((minimum, column) =>
    Math.max(minimum, ...rows.map(row => row[column].length))
  );
  const formatRow = row => `${row[0].padEnd(widths[0])}  ${row[1].padStart(widths[1])}  ${row[2]}`;
  return [formatRow(['CODE', 'HITS', 'URL']), ...rows.map(formatRow)].join('\n');
}

function openInBrowser(url, platform = process.platform) {
  let command;
  let args;
  if (platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', error => reject(new Error(`Could not launch browser: ${error.message}`)));
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

async function run(argv, dependencies = {}) {
  const env = dependencies.env || process.env;
  const stdout = dependencies.stdout || (text => process.stdout.write(`${text}\n`));
  const fetchImpl = dependencies.fetch || globalThis.fetch;
  const launch = dependencies.openUrl || openInBrowser;
  const [command, ...args] = argv;
  const base = apiBase(env);

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    stdout(USAGE);
    return;
  }

  if (command === 'add') {
    if (args.length !== 1 || !isHttpUrl(args[0])) {
      throw new Error('Usage: snip add <http(s)://url>');
    }
    const response = await request(fetchImpl, `${base}/api/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: args[0] })
    });
    if (!response.ok) throw await responseError(response);
    const link = await response.json();
    if (!link || typeof link.shortUrl !== 'string') {
      throw new Error('API response did not include a shortUrl.');
    }
    stdout(link.shortUrl);
    return;
  }

  if (command === 'ls') {
    if (args.length !== 0) throw new Error('Usage: snip ls');
    const response = await request(fetchImpl, `${base}/api/links`);
    if (!response.ok) throw await responseError(response);
    const links = await response.json();
    if (!Array.isArray(links)) throw new Error('API response was not a link list.');
    stdout(formatLinks(links));
    return;
  }

  if (command === 'open') {
    if (args.length !== 1 || !/^[A-Za-z0-9]{6}$/.test(args[0])) {
      throw new Error('Usage: snip open <6-character-code>');
    }
    const response = await request(fetchImpl, `${base}/${encodeURIComponent(args[0])}`, {
      redirect: 'manual'
    });
    if (response.status === 404) throw new Error(`Unknown short code: ${args[0]}`);
    if (response.status < 300 || response.status >= 400) {
      throw await responseError(response);
    }
    const location = response.headers.get('location');
    if (!location) throw new Error('API redirect did not include a Location header.');
    let target;
    try {
      target = new URL(location, base).toString();
    } catch {
      throw new Error('API returned an invalid redirect target.');
    }
    if (!isHttpUrl(target)) throw new Error('API returned a non-HTTP redirect target.');
    await launch(target);
    return;
  }

  throw new Error(`Unknown command: ${command}. Run "snip help" for usage.`);
}

if (require.main === module) {
  run(process.argv.slice(2)).catch(error => {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { formatLinks, isHttpUrl, openInBrowser, run };
