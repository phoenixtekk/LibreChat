import { promises as dnsPromises } from 'dns';
import { isIP } from 'net';
import type { SsrfDecision, SsrfPolicy, SsrfRejectReason } from './types';

const DEFAULT_BLOCKED_HOSTNAME_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^analytikul[-.]/i,
  /^hermes[-.]/i,
  /^vllm[-.]/i,
  /^searxng$/i,
  /^searxng[-.]/i,
  /^postgres$/i,
  /^postgres[-.]/i,
  /^mongo(db)?$/i,
  /^mongo(db)?[-.]/i,
  /^redis$/i,
  /^redis[-.]/i,
  /^docker-socket-proxy$/i,
  /^.*\.internal$/i,
  /^.*\.local$/i,
  /^metadata\./i, // cloud metadata services
];

const DEFAULT_BLOCKED_PORTS = [
  25,    // SMTP
  465,   // SMTPS
  587,   // SMTP submission
  6379,  // Redis
  27017, // Mongo
  9200,  // Elasticsearch
  5432,  // Postgres
  3306,  // MySQL
  11211, // Memcached
  2375,  // Docker API (cleartext)
  2376,  // Docker API (TLS)
  9000,  // Common internal app ports — narrow if it conflicts with a legit upstream
  8500,  // Consul
  4040,  // Common dev port
];

const DEFAULT_DNS_TIMEOUT_MS = 3000;

function isPrivateIPv4(parts: number[]): boolean {
  const [a, b] = parts;
  if (a === 10) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  } // CGNAT
  return false;
}

function classifyIPv4(ip: string): SsrfRejectReason | null {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return 'invalid_url';
  }
  const [a, b] = parts;
  if (a === 127) {
    return 'ip_loopback';
  }
  if (a === 169 && b === 254) {
    return 'ip_link_local';
  } // covers AWS/GCP/Azure metadata
  if (a >= 224 && a <= 239) {
    return 'ip_multicast';
  }
  if (a === 0 || a >= 240) {
    return 'ip_reserved';
  }
  if (isPrivateIPv4(parts)) {
    return 'ip_private';
  }
  return null;
}

function classifyIPv6(ip: string): SsrfRejectReason | null {
  const lower = ip.toLowerCase();
  if (lower === '::1') {
    return 'ip_loopback';
  }
  if (lower === '::') {
    return 'ip_reserved';
  }
  if (lower.startsWith('fe80:')) {
    return 'ip_link_local';
  }
  if (lower.startsWith('ff')) {
    return 'ip_multicast';
  }
  if (
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('::ffff:0:') ||
    lower.startsWith('::ffff:127.')
  ) {
    return 'ip_private';
  }
  return null;
}

/** Classify a resolved IP. Returns the rejection reason if it should be
 *  blocked, or null if it's a public routable IP. */
export function classifyIp(ip: string): SsrfRejectReason | null {
  const family = isIP(ip);
  if (family === 4) {
    return classifyIPv4(ip);
  }
  if (family === 6) {
    return classifyIPv6(ip);
  }
  return 'invalid_url';
}

async function resolveAllWithTimeout(
  hostname: string,
  timeoutMs: number,
): Promise<string[]> {
  const settled = await Promise.allSettled([
    Promise.race([
      dnsPromises.resolve4(hostname),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('dns timeout')), timeoutMs),
      ),
    ]),
    Promise.race([
      dnsPromises.resolve6(hostname),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('dns timeout')), timeoutMs),
      ),
    ]),
  ]);
  const out: string[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      out.push(...r.value);
    }
  }
  return out;
}

/** Validate a URL against the SSRF policy. Returns a decision with either
 *  allowed=true + the resolved IP that should be used for the request
 *  (to mitigate DNS rebinding — the caller should bind to this IP for
 *  the connect, not re-resolve), or allowed=false with a reason.
 *
 *  Best-practice usage: call validateUrl() at request start, then make
 *  the connection using the returned resolvedIp directly (e.g. via
 *  `lookup` callback on http.request) so a DNS rebind between validation
 *  and connect can't reach a different IP. */
export async function validateUrl(
  rawUrl: string,
  policy: SsrfPolicy = {},
): Promise<SsrfDecision> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: 'invalid_url', detail: 'not a parseable URL' };
  }

  const allowedSchemes = policy.allowedSchemes ?? ['http:', 'https:'];
  if (!allowedSchemes.includes(parsed.protocol)) {
    return {
      allowed: false,
      reason: 'scheme_blocked',
      detail: `scheme ${parsed.protocol} not allowed`,
    };
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  const patterns = policy.blockedHostnamePatterns ?? DEFAULT_BLOCKED_HOSTNAME_PATTERNS;
  for (const re of patterns) {
    if (re.test(hostname)) {
      return {
        allowed: false,
        reason: 'hostname_pattern_blocked',
        detail: `hostname ${hostname} matches blocked pattern`,
      };
    }
  }

  const port = parsed.port
    ? parseInt(parsed.port, 10)
    : parsed.protocol === 'https:'
      ? 443
      : 80;
  const blockedPorts = policy.blockedPorts ?? DEFAULT_BLOCKED_PORTS;
  if (blockedPorts.includes(port)) {
    return {
      allowed: false,
      reason: 'port_blocked',
      detail: `port ${port} not allowed`,
    };
  }

  // If the hostname is already a literal IP, classify it directly.
  if (isIP(hostname) !== 0) {
    const reason = classifyIp(hostname);
    if (reason) {
      return { allowed: false, reason };
    }
    return { allowed: true, resolvedIp: hostname };
  }

  let ips: string[];
  try {
    ips = await resolveAllWithTimeout(
      hostname,
      policy.dnsTimeoutMs ?? DEFAULT_DNS_TIMEOUT_MS,
    );
  } catch {
    return { allowed: false, reason: 'dns_failed', detail: hostname };
  }
  if (ips.length === 0) {
    return { allowed: false, reason: 'dns_failed', detail: `${hostname}: no records` };
  }

  // Reject if ANY resolved IP is bad — covers multi-A-record rebinding
  // and split-horizon DNS attacks where one record is public and another
  // is internal.
  for (const ip of ips) {
    const reason = classifyIp(ip);
    if (reason) {
      return {
        allowed: false,
        reason,
        detail: `${hostname} resolves to ${ip}`,
      };
    }
  }

  // Use the first resolved IP for the actual request — caller binds to
  // this directly via lookup callback so a re-resolve between here and
  // connect can't drift to a malicious IP.
  return { allowed: true, resolvedIp: ips[0] };
}
