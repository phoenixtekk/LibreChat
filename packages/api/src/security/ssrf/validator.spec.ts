import { classifyIp, validateUrl } from './validator';

jest.mock('dns', () => ({
  promises: {
    resolve4: jest.fn(),
    resolve6: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { promises: mockDns } = require('dns') as {
  promises: { resolve4: jest.Mock; resolve6: jest.Mock };
};

beforeEach(() => {
  mockDns.resolve4.mockReset();
  mockDns.resolve6.mockReset();
  // Default: no AAAA records so IPv4 cases drive the test.
  mockDns.resolve6.mockRejectedValue(new Error('ENOTFOUND'));
});

describe('classifyIp', () => {
  it('flags loopback', () => {
    expect(classifyIp('127.0.0.1')).toBe('ip_loopback');
    expect(classifyIp('::1')).toBe('ip_loopback');
  });

  it('flags private ranges incl. CGNAT', () => {
    expect(classifyIp('10.0.0.1')).toBe('ip_private');
    expect(classifyIp('172.16.0.1')).toBe('ip_private');
    expect(classifyIp('172.31.255.255')).toBe('ip_private');
    expect(classifyIp('192.168.1.1')).toBe('ip_private');
    expect(classifyIp('100.64.0.1')).toBe('ip_private');
    expect(classifyIp('fd00::1')).toBe('ip_private');
  });

  it('flags link-local (incl. cloud metadata 169.254.169.254)', () => {
    expect(classifyIp('169.254.169.254')).toBe('ip_link_local');
    expect(classifyIp('fe80::1')).toBe('ip_link_local');
  });

  it('flags multicast and reserved', () => {
    expect(classifyIp('224.0.0.1')).toBe('ip_multicast');
    expect(classifyIp('0.0.0.0')).toBe('ip_reserved');
    expect(classifyIp('255.255.255.255')).toBe('ip_reserved');
    expect(classifyIp('ff02::1')).toBe('ip_multicast');
  });

  it('docker bridge 172.17.0.1 is private', () => {
    expect(classifyIp('172.17.0.1')).toBe('ip_private');
  });

  it('passes public IPs', () => {
    expect(classifyIp('8.8.8.8')).toBeNull();
    expect(classifyIp('1.1.1.1')).toBeNull();
  });
});

describe('validateUrl — static checks (no DNS)', () => {
  it('rejects non-http(s) schemes', async () => {
    const d = await validateUrl('ftp://example.com/x');
    expect(d.allowed).toBe(false);
    expect(d.allowed === false && d.reason).toBe('scheme_blocked');
  });

  it('rejects unparseable URLs', async () => {
    const d = await validateUrl('not a url');
    expect(d.allowed).toBe(false);
  });

  it('rejects blocked hostname patterns (internal services)', async () => {
    for (const host of [
      'http://localhost/x',
      'http://redis:6379/x',
      'http://analytikul-app:3080/x',
      'http://docker-socket-proxy:2375/x',
      'http://foo.internal/x',
      'http://metadata.google.internal/x',
    ]) {
      const d = await validateUrl(host);
      expect(d.allowed).toBe(false);
    }
  });

  it('rejects blocked ports even on a public host', async () => {
    mockDns.resolve4.mockResolvedValue(['8.8.8.8']);
    const d = await validateUrl('http://example.com:6379/x');
    expect(d.allowed).toBe(false);
    expect(d.allowed === false && d.reason).toBe('port_blocked');
  });

  it('rejects IP-literal hosts that resolve to private space without DNS', async () => {
    const d = await validateUrl('http://169.254.169.254/latest/meta-data');
    expect(d.allowed).toBe(false);
    expect(d.allowed === false && d.reason).toBe('ip_link_local');
    expect(mockDns.resolve4).not.toHaveBeenCalled();
  });
});

describe('validateUrl — DNS resolution', () => {
  it('allows a hostname resolving to a public IP and returns that IP', async () => {
    mockDns.resolve4.mockResolvedValue(['93.184.216.34']);
    const d = await validateUrl('https://api.example.com/v1');
    expect(d.allowed).toBe(true);
    expect(d.allowed === true && d.resolvedIp).toBe('93.184.216.34');
  });

  it('rejects a hostname resolving to a private IP', async () => {
    mockDns.resolve4.mockResolvedValue(['10.1.2.3']);
    const d = await validateUrl('https://sneaky.example.com/v1');
    expect(d.allowed).toBe(false);
    expect(d.allowed === false && d.reason).toBe('ip_private');
  });

  it('rejects multi-record answers where ANY record is internal (split-horizon)', async () => {
    mockDns.resolve4.mockResolvedValue(['93.184.216.34', '127.0.0.1']);
    const d = await validateUrl('https://split.example.com/v1');
    expect(d.allowed).toBe(false);
    expect(d.allowed === false && d.reason).toBe('ip_loopback');
  });

  it('rejects when DNS returns no records', async () => {
    mockDns.resolve4.mockResolvedValue([]);
    const d = await validateUrl('https://void.example.com/v1');
    expect(d.allowed).toBe(false);
    expect(d.allowed === false && d.reason).toBe('dns_failed');
  });

  it('mitigates DNS rebinding: re-resolves each call, so a flip to a private IP is caught', async () => {
    // First validation: host resolves public -> allowed.
    mockDns.resolve4.mockResolvedValueOnce(['93.184.216.34']);
    const first = await validateUrl('https://rebind.example.com/v1');
    expect(first.allowed).toBe(true);
    expect(first.allowed === true && first.resolvedIp).toBe('93.184.216.34');

    // Attacker flips DNS to an internal address; a fresh validation rejects it.
    mockDns.resolve4.mockResolvedValueOnce(['169.254.169.254']);
    const second = await validateUrl('https://rebind.example.com/v1');
    expect(second.allowed).toBe(false);
    expect(second.allowed === false && second.reason).toBe('ip_link_local');
  });
});
