import type { FareSearchRequest, FareSearchResult, Station } from "@/lib/domain/types";

export interface FareProvider {
  readonly id: string;
  searchTrips(request: FareSearchRequest): Promise<FareSearchResult>;
  getStations(): Promise<Station[]>;
  healthCheck(): Promise<{ ok: boolean; message: string; latencyMs: number }>;
}

export class ProviderNotConfiguredError extends Error {
  constructor(message = "Fare provider is not configured") {
    super(message);
    this.name = "ProviderNotConfiguredError";
  }
}

export class ProviderRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ProviderRequestError";
  }
}
