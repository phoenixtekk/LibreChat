/** SSRF mitigation — shared types.
 *
 *  Used by the user-supplied-endpoint feature (2a BYOK) and any other
 *  surface that lets users hand the server a URL. Without these guards,
 *  a hostile user can point the server at internal services
 *  (http://redis:6379, http://172.17.0.1:8001, etc.) and have the
 *  authenticated platform make the call on their behalf — classic SSRF.
 *
 *  The validator's job is to refuse before the request leaves the
 *  process. See validator.ts for the actual checks. */

export type SsrfPolicy = {
  /** Allow only these schemes. Default ['http', 'https']. */
  allowedSchemes?: string[];
  /** Block any hostname matching one of these regexes (case-insensitive).
   *  Default blocks the docker network host patterns used in our compose
   *  stack so a malicious user can't reach analytikul-* / vllm-* / hermes-* */
  blockedHostnamePatterns?: RegExp[];
  /** Block any URL whose resolved IP falls in these CIDR ranges. Defaults
   *  cover all private + loopback + link-local + multicast + reserved. */
  blockedCidrs?: string[];
  /** Block these explicit ports even on public IPs (e.g. internal services
   *  hidden behind shared hosting). Default [25, 465, 587, 6379, 27017,
   *  9200, 5432, 3306, 11211, 2375, 2376]. */
  blockedPorts?: number[];
  /** Max number of redirects to follow. Default 5; each redirect is
   *  re-validated. */
  maxRedirects?: number;
  /** Timeout for DNS resolution checks, ms. Default 3000. */
  dnsTimeoutMs?: number;
};

export type SsrfDecision =
  | { allowed: true; resolvedIp: string }
  | { allowed: false; reason: SsrfRejectReason; detail?: string };

export type SsrfRejectReason =
  | 'invalid_url'
  | 'scheme_blocked'
  | 'hostname_pattern_blocked'
  | 'port_blocked'
  | 'dns_failed'
  | 'ip_private'
  | 'ip_loopback'
  | 'ip_link_local'
  | 'ip_multicast'
  | 'ip_reserved'
  | 'timeout';
