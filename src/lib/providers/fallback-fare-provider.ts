import type { FareSearchRequest, FareSearchResult, Station } from "@/lib/domain/types";
import { logger } from "@/lib/logger";
import type { FareProvider } from "./fare-provider";

/**
 * Try primary live source first; fall back to secondary only on PROVIDER_ERROR.
 * Never invents fares — both providers must be real live sources.
 */
export class FallbackFareProvider implements FareProvider {
  readonly id: string;

  constructor(
    private readonly primary: FareProvider,
    private readonly secondary: FareProvider | null,
  ) {
    this.id = primary.id;
  }

  async searchTrips(request: FareSearchRequest): Promise<FareSearchResult> {
    const primaryResult = await this.primary.searchTrips(request);
    if (primaryResult.status !== "PROVIDER_ERROR" || !this.secondary) {
      return primaryResult;
    }
    logger.warn("provider.fallback", {
      origin: request.originCode,
      destination: request.destinationCode,
      travelDate: request.travelDate,
      primaryError: primaryResult.providerError?.message ?? null,
      secondary: this.secondary.id,
    });
    const secondaryResult = await this.secondary.searchTrips(request);
    return {
      ...secondaryResult,
      metadata: {
        ...secondaryResult.metadata,
        // Preserve original request id lineage in logs via credits / latency already set.
      },
    };
  }

  async getStations(): Promise<Station[]> {
    try {
      return await this.primary.getStations();
    } catch {
      if (this.secondary) return this.secondary.getStations();
      throw new Error("No fare provider stations available");
    }
  }

  async healthCheck() {
    const primary = await this.primary.healthCheck();
    if (primary.ok || !this.secondary) return primary;
    return this.secondary.healthCheck();
  }
}
