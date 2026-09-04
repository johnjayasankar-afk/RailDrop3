import { dollarsToCents, partyTotalCents } from "@/lib/domain/money";
import { classifyServiceType } from "@/lib/domain/service-type";
import type {
  FareOption,
  FareSearchRequest,
  JourneyLeg,
  JourneyOption,
  ProviderMetadata,
  ServiceType,
  TravelClass,
} from "@/lib/domain/types";
import { codeFromWanderuId, isAmtrakCarrier, tripMatchesStation } from "./wanderu-station-map";

export interface WanderuTrip {
  trip_id?: string;
  carrier?: string;
  price?: number;
  pricing?: { USD?: { price?: number } };
  transfers?: number;
  duration?: number;
  vehicle_types?: string[];
  depart_id?: string;
  arrive_id?: string;
  depart_name?: string;
  arrive_name?: string;
  depart_cityname?: string;
  arrive_cityname?: string;
  depart_state?: string;
  arrive_state?: string;
  depart_wcityid?: string;
  arrive_wcityid?: string;
  depart_datetime?: string;
  arrive_datetime?: string;
  itinerary_info?: {
    itinerary?: WanderuLeg[];
  };
}

export interface WanderuLeg {
  part_type?: string;
  vehicle_type?: string;
  operator_name?: string;
  train_number?: string;
  carrier_id?: string;
  depart_id?: string;
  arrive_id?: string;
  depart_datetime_iso?: string;
  arrive_datetime_iso?: string;
}

export function normalizeWanderuTrips(
  trips: WanderuTrip[],
  request: FareSearchRequest,
  metadata: ProviderMetadata,
  options: { relaxStationMatch?: boolean } = {},
): JourneyOption[] {
  const journeys: JourneyOption[] = [];
  for (const trip of trips) {
    const journey = normalizeTrip(trip, request, metadata, options);
    if (journey) journeys.push(journey);
  }
  return dedupeJourneys(journeys);
}

function normalizeTrip(
  trip: WanderuTrip,
  request: FareSearchRequest,
  metadata: ProviderMetadata,
  options: { relaxStationMatch?: boolean } = {},
): JourneyOption | null {
  const vehicles = (trip.vehicle_types ?? []).map((value) => value.toLowerCase());
  const travelLegs = (trip.itinerary_info?.itinerary ?? []).filter(
    (leg) => leg.part_type === "travel",
  );
  const isTrain =
    vehicles.includes("train") || travelLegs.some((leg) => leg.vehicle_type === "train");
  if (!isTrain) return null;

  const operator = travelLegs[0]?.operator_name ?? null;
  if (!isAmtrakCarrier(trip.carrier, operator)) return null;
  if (vehicles.includes("bus") && !isTrain) return null;

  const originOk = tripMatchesStation(
    request.originCode,
    trip.depart_id,
    trip.depart_cityname,
    trip.depart_state,
    trip.depart_wcityid,
    options.relaxStationMatch,
  );
  const destOk = tripMatchesStation(
    request.destinationCode,
    trip.arrive_id,
    trip.arrive_cityname,
    trip.arrive_state,
    trip.arrive_wcityid,
    options.relaxStationMatch,
  );
  if (!originOk || !destOk) return null;

  const dollars = trip.pricing?.USD?.price ?? trip.price;
  const perTraveler = dollarsToCents(dollars ?? NaN);
  if (perTraveler == null) return null;

  const departureAt =
    travelLegs[0]?.depart_datetime_iso ?? trip.depart_datetime ?? `${request.travelDate}T00:00:00`;
  const arrivalAt = travelLegs.at(-1)?.arrive_datetime_iso ?? trip.arrive_datetime ?? departureAt;
  const trainNumber = firstTrainNumber(travelLegs) ?? trip.trip_id?.split(",").at(-1) ?? null;
  const serviceName = operator ?? (trip.carrier === "USACL" ? "Acela" : "Amtrak");
  const railLegs = travelLegs.filter((leg) => leg.vehicle_type === "train");
  const serviceType: ServiceType = classifyServiceType({
    legCount: Math.max(railLegs.length, trip.transfers ? trip.transfers + 1 : railLegs.length || 1),
    serviceNames: railLegs.map((leg) => leg.operator_name ?? serviceName),
    rawTypes: railLegs.map((leg) => leg.vehicle_type),
  });

  const legs: JourneyLeg[] = (railLegs.length ? railLegs : travelLegs).map((leg, index, all) => {
    const originCode =
      codeFromWanderuId(leg.depart_id) ??
      (index === 0 ? request.originCode : (codeFromWanderuId(all[index - 1]?.arrive_id) ?? "—"));
    const destinationCode =
      codeFromWanderuId(leg.arrive_id) ??
      (index === all.length - 1
        ? request.destinationCode
        : (codeFromWanderuId(all[index + 1]?.depart_id) ?? "—"));
    return {
      originCode,
      destinationCode,
      departureAt: leg.depart_datetime_iso ?? departureAt,
      arrivalAt: leg.arrive_datetime_iso ?? arrivalAt,
      serviceName: leg.operator_name ?? serviceName,
      trainNumber: leg.train_number ?? null,
      serviceType,
    };
  });

  const travelClass: TravelClass = /acela/i.test(serviceName) ? "BUSINESS" : "COACH";
  const fare: FareOption = {
    id: `${trip.trip_id ?? metadata.requestId}:listed`,
    fareFamily: "FLEXIBLE",
    fareFamilyRaw: "WANDERU_LISTED",
    travelClass,
    travelClassRaw: travelClass,
    availability: "AVAILABLE",
    observedPriceCents: perTraveler,
    priceSemantics: "PER_TRAVELER",
    pricePerTravelerCents: perTraveler,
    totalPartyPriceCents: partyTotalCents(perTraveler, request.passengers.adultCount),
    priceFailureReason: null,
  };

  return {
    id: trip.trip_id ?? `${request.travelDate}:${trainNumber}:${departureAt}`,
    searchedTravelDate: request.travelDate,
    serviceName,
    trainNumber,
    serviceType,
    originCode: request.originCode,
    destinationCode: request.destinationCode,
    departureAt,
    arrivalAt,
    durationMinutes:
      typeof trip.duration === "number" && Number.isFinite(trip.duration)
        ? Math.round(trip.duration * 60)
        : null,
    transferCount: trip.transfers ?? Math.max(0, railLegs.length - 1),
    legs: legs.length
      ? legs
      : [
          {
            originCode: request.originCode,
            destinationCode: request.destinationCode,
            departureAt,
            arrivalAt,
            serviceName,
            trainNumber,
            serviceType,
          },
        ],
    fares: [fare],
    provider: metadata,
  };
}

function firstTrainNumber(legs: WanderuLeg[]): string | null {
  for (const leg of legs) {
    if (leg.train_number) return String(leg.train_number);
  }
  return null;
}

function dedupeJourneys(journeys: JourneyOption[]): JourneyOption[] {
  const seen = new Set<string>();
  const out: JourneyOption[] = [];
  for (const journey of journeys) {
    const key = `${journey.trainNumber}:${journey.departureAt}:${journey.arrivalAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(journey);
  }
  return out;
}
