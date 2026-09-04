import type { FareSearchRequest, FareSearchResult, Station } from "@/lib/domain/types";
import type { FareProvider } from "./fare-provider";
import { logger } from "@/lib/logger";

export class FallbackFareProvider implements FareProvider {
  readonly id: string;

  constructor(
    private readonly primary: FareProvider,
    private readonly secondary: FareProvider,
  ) {
    this.id = primary.id;
  }

  async searchTrips(request: FareSearchRequest): Promise<FareSearchResult> {
    const first = await this.primary.searchTrips(request);
    if (first.status !== "PROVIDER_ERROR") return first;
    logger.info("provider.fallback", {
      origin: request.originCode,
      destination: request.destinationCode,
      travelDate: request.travelDate,
      primaryError: first.providerError?.message,
    });
    const second = await this.secondary.searchTrips(request);
    return {
      ...second,
      metadata: {
        ...second.metadata,
        rawJourneyRef: second.metadata.rawJourneyRef ?? `fallback-from:${this.primary.id}`,
      },
    };
  }

  async getStations(): Promise<Station[]> {
    try {
      const stations = await this.primary.getStations();
      if (stations.length > 0) return stations;
    } catch {
      // Use the secondary catalog when the primary source is unavailable.
    }
    return this.secondary.getStations();
  }

  async healthCheck() {
    const primary = await this.primary.healthCheck();
    if (primary.ok) return primary;
    return this.secondary.healthCheck();
  }
}
