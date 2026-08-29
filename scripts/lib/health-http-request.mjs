import http from 'node:http';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';

function headerEntries(headers = {}) {
  if (Array.isArray(headers)) return headers;
  if (typeof headers.entries === 'function') return [...headers.entries()];
  return Object.entries(headers);
}

function hasHeader(entries, name) {
  const normalizedName = name.toLowerCase();
  return entries.some(([key]) => String(key).toLowerCase() === normalizedName);
}

function decodeBody(buffer, encoding) {
  const normalizedEncoding = String(encoding || '')
    .trim()
    .toLowerCase();

  if (!normalizedEncoding || normalizedEncoding === 'identity') return buffer;
  if (normalizedEncoding === 'gzip') return gunzipSync(buffer);
  if (normalizedEncoding === 'deflate') return inflateSync(buffer);
  if (normalizedEncoding === 'br') return brotliDecompressSync(buffer);

  throw new Error(`Unsupported content encoding for health check: ${normalizedEncoding}`);
}

function rawHttpRequest(url, init, entries) {
  return new Promise((resolve, reject) => {
    const headers = Object.fromEntries(entries);
    if (!hasHeader(entries, 'accept-encoding')) {
      headers['Accept-Encoding'] = 'identity';
    }

    const request = http.request(
      url,
      {
        method: init.method || 'GET',
        headers,
        signal: init.signal,
      },
      (response) => {
        const chunks = [];

        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('error', reject);
        response.on('end', () => {
          try {
            const decodedBody = decodeBody(
              Buffer.concat(chunks),
              response.headers['content-encoding'],
            );
            const status = response.statusCode || 0;

            resolve({
              status,
              ok: status >= 200 && status < 300,
              text: async () => decodedBody.toString('utf8'),
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    request.on('error', reject);
    request.end();
  });
}

export async function requestHealthUrl(url, init = {}) {
  const entries = headerEntries(init.headers);
  const target = new URL(url);

  if (target.protocol === 'http:' && hasHeader(entries, 'host')) {
    return rawHttpRequest(target, init, entries);
  }

  return fetch(target, init);
}
