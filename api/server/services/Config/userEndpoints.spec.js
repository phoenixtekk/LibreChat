const mockResolve = jest.fn();

jest.mock('~/models', () => ({
  resolveUserEndpoints: (...args) => mockResolve(...args),
}));

const { applyUserEndpoints } = require('./userEndpoints');

const baseConfig = () => ({
  endpoints: {
    custom: [{ name: 'GlobalYaml', apiKey: 'sk-yaml', baseURL: 'https://yaml.example.com/v1' }],
    agents: { capabilities: ['execute_code'] },
  },
});

const req = (id) => ({ user: { id } });

beforeEach(() => {
  mockResolve.mockReset();
});

describe('applyUserEndpoints', () => {
  it('returns the config unchanged when there is no user', async () => {
    const cfg = baseConfig();
    const out = await applyUserEndpoints(cfg, {});
    expect(out).toBe(cfg);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('returns the config unchanged when the user has no endpoints', async () => {
    mockResolve.mockResolvedValue([]);
    const cfg = baseConfig();
    const out = await applyUserEndpoints(cfg, req('u1'));
    expect(out).toBe(cfg);
  });

  it('appends user endpoints onto a CLONE without mutating the cached config', async () => {
    mockResolve.mockResolvedValue([
      { name: 'MyLLM', apiKey: 'sk-secret', baseURL: 'https://api.mine.com/v1', models: ['m1', 'm2'] },
    ]);
    const cfg = baseConfig();
    const out = await applyUserEndpoints(cfg, req('u1'));

    // Cloned, not mutated.
    expect(out).not.toBe(cfg);
    expect(cfg.endpoints.custom).toHaveLength(1);
    expect(out.endpoints.custom).toHaveLength(2);

    // Untouched sibling config is preserved.
    expect(out.endpoints.agents).toEqual(cfg.endpoints.agents);

    const added = out.endpoints.custom.find((e) => e.name === 'MyLLM');
    expect(added).toMatchObject({
      name: 'MyLLM',
      apiKey: 'sk-secret',
      baseURL: 'https://api.mine.com/v1',
      models: { default: ['m1', 'm2'], fetch: false },
      modelDisplayLabel: 'MyLLM',
    });
  });

  it('does not shadow a global custom endpoint of the same name (case-insensitive)', async () => {
    mockResolve.mockResolvedValue([
      { name: 'globalyaml', apiKey: 'sk-evil', baseURL: 'https://evil.example.com/v1', models: [] },
    ]);
    const cfg = baseConfig();
    const out = await applyUserEndpoints(cfg, req('u1'));
    // Collision skipped → nothing added → original returned.
    expect(out).toBe(cfg);
    expect(cfg.endpoints.custom).toHaveLength(1);
    expect(cfg.endpoints.custom[0].apiKey).toBe('sk-yaml');
  });

  it('handles a config with no existing custom array', async () => {
    mockResolve.mockResolvedValue([
      { name: 'Solo', apiKey: 'k', baseURL: 'https://solo.example.com/v1', models: ['x'] },
    ]);
    const out = await applyUserEndpoints({ endpoints: {} }, req('u1'));
    expect(out.endpoints.custom).toHaveLength(1);
    expect(out.endpoints.custom[0].name).toBe('Solo');
  });

  it('returns the original config gracefully when resolve throws', async () => {
    mockResolve.mockRejectedValue(new Error('db down'));
    const cfg = baseConfig();
    const out = await applyUserEndpoints(cfg, req('u1'));
    expect(out).toBe(cfg);
  });
});
