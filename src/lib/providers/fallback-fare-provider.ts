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
    /* Returned as-is, including its own metadata.source.
     *
     * Which provider answered is not bookkeeping — the two do not describe a
     * fare the same way. Parse reports a real fare family; Wanderu reports
     * none, so its fares are UNKNOWN. A board that silently mixed the two
     * would show "Saver" on one date and "Unknown fare" on the next for no
     * reason the reader could see, and the change-rule note would differ with
     * it. The source travels with the result so that is at least traceable.
     *
     * This used to spread metadata over itself under a comment about
     * preserving request-id lineage, which it did not do. */
    return this.secondary.searchTrips(request);
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
