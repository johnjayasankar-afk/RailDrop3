import type {
  FareSearchRequest,
  FareSearchResult,
  JourneyOption,
  Station,
} from "@/lib/domain/types";
import { STATIONS } from "@/lib/stations/catalog";
import type { FareProvider } from "./fare-provider";

export class FixtureFareProvider implements FareProvider {
  readonly id = "parse:amtrak-com-api";
  failDates = new Set<string>();

  async searchTrips(request: FareSearchRequest): Promise<FareSearchResult> {
    const started = Date.now();
    const requestId = crypto.randomUUID();
    if (this.failDates.has(request.travelDate)) {
      return {
        request,
        status: "PROVIDER_ERROR",
        journeys: [],
        providerError: { code: "timeout", message: "Provider timeout", retryable: true },
        metadata: {
          provider: this.id,
          requestId,
          retrievedAt: new Date().toISOString(),
          latencyMs: Date.now() - started,
          creditsCharged: 0,
        },
      };
    }

    const day = Number(request.travelDate.slice(-2));
    const journeys = buildFixtureJourneys(request, day);
    return {
      request,
      status: journeys.length === 0 ? "NO_INVENTORY" : "SUCCESS",
      journeys,
      metadata: {
        provider: this.id,
        requestId,
        retrievedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        creditsCharged: 2,
      },
    };
  }

  async getStations(): Promise<Station[]> {
    return STATIONS.map((station) => ({
      ...station,
      country: "US",
    }));
  }

  async healthCheck() {
    return { ok: true, message: "fixture provider", latencyMs: 1 };
  }
}

function buildFixtureJourneys(request: FareSearchRequest, day: number): JourneyOption[] {
  const bucket = day % 3;
  const cheapest = [7400, 8100, 8600][bucket];
  const train = [
    { name: "Northeast Regional", number: "179", depart: "07:05", arrive: "11:14" },
    { name: "Acela", number: "2150", depart: "06:10", arrive: "09:28" },
    { name: "Northeast Regional", number: "171", depart: "11:05", arrive: "15:18" },
  ][bucket];

  const baseMeta = {
    provider: "parse:amtrak-com-api",
    requestId: "fixture",
    retrievedAt: new Date().toISOString(),
    latencyMs: 1,
    creditsCharged: 2,
  };

  const cheap: JourneyOption = {
    id: `${request.travelDate}:${request.originCode}:${train.number}`,
    searchedTravelDate: request.travelDate,
    serviceName: train.name,
    trainNumber: train.number,
    serviceType: "DIRECT_RAIL",
    originCode: request.originCode,
    destinationCode: request.destinationCode,
    departureAt: `${request.travelDate}T${train.depart}:00`,
    arrivalAt: `${request.travelDate}T${train.arrive}:00`,
    durationMinutes: 249,
    transferCount: 0,
    legs: [
      {
        originCode: request.originCode,
        destinationCode: request.destinationCode,
        departureAt: `${request.travelDate}T${train.depart}:00`,
        arrivalAt: `${request.travelDate}T${train.arrive}:00`,
        serviceName: train.name,
        trainNumber: train.number,
        serviceType: "DIRECT_RAIL",
      },
    ],
    fares: [
      fare("FLX", "Coach", cheapest, request.passengers.adultCount, `${request.travelDate}:flx`),
      fare(
        "VLU",
        "Coach",
        cheapest - 1500,
        request.passengers.adultCount,
        `${request.travelDate}:vlu`,
      ),
    ],
    provider: baseMeta,
  };

  const later: JourneyOption = {
    ...cheap,
    id: `${request.travelDate}:${request.originCode}:93`,
    serviceName: "Northeast Regional",
    trainNumber: "93",
    departureAt: `${request.travelDate}T17:00:00`,
    arrivalAt: `${request.travelDate}T21:10:00`,
    fares: [
      fare("FLX", "Coach", 11900, request.passengers.adultCount, `${request.travelDate}:eve`),
    ],
    legs: [
      {
        originCode: request.originCode,
        destinationCode: request.destinationCode,
        departureAt: `${request.travelDate}T17:00:00`,
        arrivalAt: `${request.travelDate}T21:10:00`,
        serviceName: "Northeast Regional",
        trainNumber: "93",
        serviceType: "DIRECT_RAIL",
      },
    ],
  };

  const bus: JourneyOption = {
    ...cheap,
    id: `${request.travelDate}:${request.originCode}:bus`,
    serviceName: "Amtrak Thruway",
    trainNumber: "8401",
    serviceType: "THRUWAY_OR_BUS",
    departureAt: `${request.travelDate}T08:30:00`,
    arrivalAt: `${request.travelDate}T14:00:00`,
    fares: [fare("FLX", "Coach", 4900, request.passengers.adultCount, `${request.travelDate}:bus`)],
    legs: [
      {
        originCode: request.originCode,
        destinationCode: request.destinationCode,
        departureAt: `${request.travelDate}T08:30:00`,
        arrivalAt: `${request.travelDate}T14:00:00`,
        serviceName: "Amtrak Thruway",
        trainNumber: "8401",
        serviceType: "THRUWAY_OR_BUS",
      },
    ],
  };

  return [cheap, later, bus];
}

function fare(family: string, travelClass: string, cents: number, adults: number, id: string) {
  return {
    id,
    fareFamily: family === "FLX" ? ("FLEXIBLE" as const) : ("VALUE" as const),
    fareFamilyRaw: family,
    travelClass: travelClass === "Coach" ? ("COACH" as const) : ("BUSINESS" as const),
    travelClassRaw: travelClass,
    availability: "AVAILABLE" as const,
    observedPriceCents: cents,
    priceSemantics: "PER_TRAVELER" as const,
    pricePerTravelerCents: cents,
    totalPartyPriceCents: cents * adults,
    priceFailureReason: null,
  };
}
