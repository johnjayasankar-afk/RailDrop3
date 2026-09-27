import { afterEach, describe, expect, it } from 'vitest';
import {
  createFareProvider,
  describeActiveProvider,
  ProviderConfigurationError,
  TEST_PROVIDER_OVERRIDE,
} from '@/lib/providers';
import { resetServerEnvCache } from '@/lib/env';

const ORIGINAL = { ...process.env };

function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetServerEnvCache();
}

afterEach(() => {
  process.env = { ...ORIGINAL };
  resetServerEnvCache();
});

describe('provider factory production guard', () => {
  it('allows the deterministic provider outside production', () => {
    setEnv({
      NODE_ENV: 'test',
      FARE_PROVIDER: 'deterministic',
      RAILDROP_ALLOW_TEST_PROVIDER: undefined,
    });
    const provider = createFareProvider();
    expect(provider.id).toBe('deterministic');
    expect(provider.isLive).toBe(false);
  });

  it('REFUSES to serve simulated fares in production', () => {
    setEnv({
      NODE_ENV: 'production',
      FARE_PROVIDER: 'deterministic',
      RAILDROP_ALLOW_TEST_PROVIDER: undefined,
    });
    expect(() => createFareProvider()).toThrow(ProviderConfigurationError);
    expect(() => createFareProvider()).toThrow(/not allowed in production/i);
  });

  it('rejects a near-miss override value', () => {
    setEnv({
      NODE_ENV: 'production',
      FARE_PROVIDER: 'deterministic',
      RAILDROP_ALLOW_TEST_PROVIDER: 'true',
    });
    expect(() => createFareProvider()).toThrow(ProviderConfigurationError);
  });

  it('permits production simulation only with the explicit, loud override', () => {
    setEnv({
      NODE_ENV: 'production',
      FARE_PROVIDER: 'deterministic',
      RAILDROP_ALLOW_TEST_PROVIDER: TEST_PROVIDER_OVERRIDE,
    });
    expect(createFareProvider().id).toBe('deterministic');
  });

  it('rejects an unknown provider name', () => {
    setEnv({ NODE_ENV: 'test', FARE_PROVIDER: 'mystery' });
    expect(() => createFareProvider()).toThrow(/Unknown FARE_PROVIDER/);
  });

  it('builds the live provider when configured', () => {
    setEnv({ NODE_ENV: 'test', FARE_PROVIDER: 'parse', PARSE_API_KEY: 'pmx_live' });
    const provider = createFareProvider();
    expect(provider.id).toBe('parse');
    expect(provider.isLive).toBe(true);
  });

  it('reports the active provider without leaking the key', () => {
    setEnv({ NODE_ENV: 'test', FARE_PROVIDER: 'parse', PARSE_API_KEY: 'pmx_live' });
    const described = describeActiveProvider();
    expect(described).toEqual({ id: 'parse', isLive: true, configured: true });
    expect(JSON.stringify(described)).not.toContain('pmx_live');
  });

  it('reports an unconfigured live provider honestly', () => {
    setEnv({ NODE_ENV: 'test', FARE_PROVIDER: 'parse', PARSE_API_KEY: '' });
    expect(describeActiveProvider().configured).toBe(false);
  });
});
