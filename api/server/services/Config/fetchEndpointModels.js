/**
 * Fetch the model list from a user's custom endpoint ONCE, at creation time,
 * pinned to the SSRF-validated IP (Feature 2a).
 *
 * Why not LibreChat's native `models.fetch: true`? That re-fetches
 * `baseURL/models` on every request and re-resolves DNS each time, which
 * reopens the DNS-rebinding SSRF vector the BYOK-endpoint feature exists to
 * close (store a public URL, then rebind it to an internal IP). Instead the
 * caller validates the URL with the SSRF guard, then hands us the resolved IP
 * and we connect to THAT ip — so a rebind between validation and fetch can't
 * redirect us — while keeping the hostname for TLS SNI / cert verification.
 * The fetched ids are stored once and served statically (runtime fetch:false).
 */
const https = require('https');
const http = require('http');
const net = require('net');
const { URL } = require('url');

const MAX_MODELS = 100;
const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 6000;

function pinnedLookup(resolvedIp) {
  const family = net.isIP(resolvedIp) || 4;
  return (hostname, options, callback) => {
    if (options && options.all) {
      return callback(null, [{ address: resolvedIp, family }]);
    }
    return callback(null, resolvedIp, family);
  };
}

function getJson(baseURL, apiKey, resolvedIp) {
  const url = new URL(baseURL.replace(/\/+$/, '') + '/models');
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        servername: url.hostname,
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        lookup: pinnedLookup(resolvedIp),
        timeout: TIMEOUT_MS,
      },
      (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          reject(new Error(`status ${res.statusCode}`));
          return;
        }
        let data = '';
        let total = 0;
        res.on('data', (chunk) => {
          total += chunk.length;
          if (total > MAX_BYTES) {
            req.destroy();
            reject(new Error('response too large'));
            return;
          }
          data += chunk;
        });
        res.on('end', () => resolve(data));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

/**
 * @param {string} baseURL
 * @param {string} apiKey
 * @param {string} resolvedIp - the IP returned by the SSRF validator for baseURL
 * @returns {Promise<string[]>} de-duplicated model ids (capped), or [] on any failure
 */
async function fetchEndpointModels(baseURL, apiKey, resolvedIp) {
  if (!resolvedIp) {
    return [];
  }
  const raw = await getJson(baseURL, apiKey, resolvedIp);
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed?.data)
    ? parsed.data
    : Array.isArray(parsed)
      ? parsed
      : [];
  const ids = list
    .map((entry) => (typeof entry === 'string' ? entry : entry?.id))
    .filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 128);
  return [...new Set(ids)].slice(0, MAX_MODELS);
}

module.exports = { fetchEndpointModels };
