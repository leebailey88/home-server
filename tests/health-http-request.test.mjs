import assert from 'node:assert/strict';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import test from 'node:test';

import { requestHealthUrl } from '../scripts/lib/health-http-request.mjs';

async function withHttpServer(handler, callback) {
  const server = http.createServer(handler);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('explicit Host header reaches the local HTTP server on the wire', async () => {
  await withHttpServer(
    (request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ host: request.headers.host, path: request.url }));
    },
    async (origin) => {
      const response = await requestHealthUrl(`${origin}/api/health`, {
        headers: { Host: 'altamontiq.com' },
      });

      assert.equal(response.status, 200);
      assert.equal(response.ok, true);
      assert.equal(
        await response.text(),
        JSON.stringify({ host: 'altamontiq.com', path: '/api/health' }),
      );
    },
  );
});

test('explicit-host transport decodes compressed health responses', async () => {
  const body = JSON.stringify({ service: 'community-bank-pilot' });

  await withHttpServer(
    (_request, response) => {
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
      });
      response.end(gzipSync(body));
    },
    async (origin) => {
      const response = await requestHealthUrl(`${origin}/api/health`, {
        headers: { Host: 'communitybankpilot.com' },
      });

      assert.equal(await response.text(), body);
    },
  );
});
