import 'server-only';

import { getServerEnv } from '@/lib/env';
import type { FareProvider } from './fare-provider';
import { createParseProviderFromEnv } from './parse/client';
import { createDeterministicProviderFromEnv } from './deterministic/test-provider';
import { HttpJsonFareProvider } from './http/generic';

export const TEST_PROVIDER_OVERRIDE = 'i-understand-this-is-not-production';

export class ProviderConfigurationError extends Error {}

/**
 * The single place a provider is chosen.
 *
 * Production may only ever use a live provider. Shipping mock fares to real users
 * would be worse than shipping nothing, so this throws rather than degrading.
 */
export function createFareProvider(): FareProvider {
  const env = getServerEnv();
  const normalize = { pricingBasis: env.pricingBasis, amountUnit: env.amountUnit };

  if (env.fareProvider === 'deterministic') {
    if (env.isProduction && env.allowTestProvider !== TEST_PROVIDER_OVERRIDE) {
      throw new ProviderConfigurationError(
        'FARE_PROVIDER=deterministic is not allowed in production. ' +
          'RailDrop refuses to serve simulated fares to real users. ' +
          'Set FARE_PROVIDER=parse, or set RAILDROP_ALLOW_TEST_PROVIDER to the explicit override value if this really is a test deployment.',
      );
    }
    return createDeterministicProviderFromEnv(normalize);
  }

  // A generic JSON provider, configured entirely by environment. This is the
  // escape hatch that makes RailDrop work with WHATEVER fare API you can obtain
  // - a marketplace key, a GDS contract, a partner endpoint, your own proxy -
  // without touching application code.
  if (env.fareProvider === 'http') {
    if (!env.httpProviderUrl) {
      throw new ProviderConfigurationError(
        'FARE_PROVIDER=http requires HTTP_PROVIDER_URL. See .env.example.',
      );
    }
    return new HttpJsonFareProvider({
      urlTemplate: env.httpProviderUrl,
      method: env.httpProviderMethod,
      bodyTemplate: env.httpProviderBody,
      authHeader: env.httpProviderAuthHeader,
      authValueTemplate: env.httpProviderAuthValue,
      apiKey: env.httpProviderKey,
      extraHeaders: env.httpProviderHeaders,
      timeoutMs: env.providerTimeoutMs,
      normalize,
      label: env.httpProviderLabel,
    });
  }

  if (env.fareProvider !== 'parse') {
    throw new ProviderConfigurationError(
      `Unknown FARE_PROVIDER "${env.fareProvider}". Valid values: parse, http, deterministic.`,
    );
  }

  return createParseProviderFromEnv();
}

/** For /api/health and the usage page - never exposes the key. */
export function describeActiveProvider(): { id: string; isLive: boolean; configured: boolean } {
  const env = getServerEnv();
  const id = env.fareProvider;
  if (id === 'parse') return { id, isLive: true, configured: Boolean(env.parseApiKey) };
  if (id === 'http') {
    return {
      id: env.httpProviderLabel,
      isLive: true,
      // An auth header without a key is a misconfiguration worth surfacing.
      configured:
        Boolean(env.httpProviderUrl) &&
        (!env.httpProviderAuthHeader || Boolean(env.httpProviderKey)),
    };
  }
  return { id, isLive: false, configured: true };
}

export type { FareProvider } from './fare-provider';
export {
  ProviderError,
  ProviderSchemaError,
  backoffDelayMs,
  shouldRetry,
  countsTowardCircuit,
} from './fare-provider';
