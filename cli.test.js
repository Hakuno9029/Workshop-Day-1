'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const path = require('node:path');
const { formatLinks, isHttpUrl, run } = require('./cli');

function mockResponse(status, body, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers),
    async json() { return body; }
  };
}

test('validates HTTP(S) URLs only', () => {
  assert.equal(isHttpUrl('https://example.com/a'), true);
  assert.equal(isHttpUrl('http://localhost:3000'), true);
  assert.equal(isHttpUrl('file:///tmp/file'), false);
  assert.equal(isHttpUrl('not a URL'), false);
});

test('prints help without making an API request', async () => {
  let output = '';
  await run(['help'], {
    stdout: text => { output = text; },
    fetch: () => { throw new Error('should not fetch'); }
  });
  assert.match(output, /snip add <url>/);
  assert.match(output, /SNIP_API/);
});

test('add posts a URL and prints the shortUrl', async () => {
  let request;
  let output = '';
  await run(['add', 'https://example.com'], {
    env: { SNIP_API: 'http://api.test/' },
    stdout: text => { output = text; },
    fetch: async (url, options) => {
      request = { url, options };
      return mockResponse(201, { shortUrl: 'http://api.test/ABC123' });
    }
  });
  assert.equal(request.url, 'http://api.test/api/links');
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(JSON.parse(request.options.body), { url: 'https://example.com' });
  assert.equal(output, 'http://api.test/ABC123');
});

test('rejects invalid add input before fetching', async () => {
  let called = false;
  await assert.rejects(run(['add', 'file:///tmp/file'], {
    fetch: () => { called = true; }
  }), /Usage: snip add/);
  assert.equal(called, false);
});

test('lists links in aligned columns and handles an empty list', async () => {
  let output = '';
  await run(['ls'], {
    stdout: text => { output = text; },
    fetch: async () => mockResponse(200, [
      { code: 'ABC123', hits: 2, url: 'https://example.com/a' },
      { code: 'XYZ789', hits: 10, url: 'https://example.org' }
    ])
  });
  assert.equal(output, 'CODE    HITS  URL\nABC123     2  https://example.com/a\nXYZ789    10  https://example.org');

  await run(['ls'], {
    stdout: text => { output = text; },
    fetch: async () => mockResponse(200, [])
  });
  assert.equal(output, 'No links yet.');
});

test('open requests a manual redirect and launches its Location target', async () => {
  let request;
  let opened;
  await run(['open', 'ABC123'], {
    env: { SNIP_API: 'http://api.test' },
    fetch: async (url, options) => {
      request = { url, options };
      return mockResponse(302, null, { location: 'https://example.com/target' });
    },
    openUrl: async url => { opened = url; }
  });
  assert.equal(request.url, 'http://api.test/ABC123');
  assert.equal(request.options.redirect, 'manual');
  assert.equal(opened, 'https://example.com/target');
});

test('reports unknown codes and API errors', async () => {
  await assert.rejects(run(['open', 'ABC123'], {
    fetch: async () => mockResponse(404, { error: 'Not found' })
  }), /Unknown short code: ABC123/);
  await assert.rejects(run(['ls'], {
    fetch: async () => mockResponse(503, { error: 'Unavailable' })
  }), /Unavailable/);
});

test('dead backend exits with status 1 and writes errors to stderr', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'cli.js'), 'ls'], {
    encoding: 'utf8',
    env: { ...process.env, SNIP_API: 'http://127.0.0.1:1' },
    timeout: 5000
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Error: Could not reach the API:/);
  assert.equal(result.stdout, '');
});

test('Windows command wrapper forwards help', () => {
  const result = spawnSync('cmd.exe', ['/d', '/c', path.join(__dirname, 'snip.cmd'), 'help'], {
    encoding: 'utf8',
    timeout: 5000
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /snip add <url>/);
});
