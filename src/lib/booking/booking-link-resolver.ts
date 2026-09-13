import { formatUsdCompact } from "@/lib/domain/money";
import { fareFamilyLabel, travelClassLabel } from "@/lib/domain/fare-family";
import { formatDisplayDate } from "@/lib/domain/calendar";
import { formatClock } from "@/lib/domain/timezone";
import type { BookingHandoff, FareOption, JourneyOption } from "@/lib/domain/types";

export const AMTRAK_HOME = "https://www.amtrak.com/home.html";
export const AMTRAK_TICKETS = "https://www.amtrak.com/tickets-reservations";

export interface BookingLinkInput {
  journey: JourneyOption;
  fare: FareOption;
  providerBookingUrl?: string | null;
}

export class BookingLinkResolver {
  resolve(input: BookingLinkInput): BookingHandoff {
    const copyText = buildCopyText(input.journey, input.fare);

    if (input.providerBookingUrl && isHttpUrl(input.providerBookingUrl)) {
      return {
        kind: "exact_itinerary",
        url: input.providerBookingUrl,
        label: "Book on Amtrak",
        prefilled: {
          origin: input.journey.originCode,
          destination: input.journey.destinationCode,
          travelDate: input.journey.searchedTravelDate,
          trainNumber: input.journey.trainNumber ?? undefined,
          departureTime: formatClock(input.journey.departureAt),
        },
        copyText,
      };
    }

    return {
      kind: "generic_fallback",
      url: AMTRAK_HOME,
      label: "Book on Amtrak",
      prefilled: {
        origin: input.journey.originCode,
        destination: input.journey.destinationCode,
        travelDate: input.journey.searchedTravelDate,
        trainNumber: input.journey.trainNumber ?? undefined,
        departureTime: formatClock(input.journey.departureAt),
      },
      copyText,
    };
  }
}

export function buildCopyText(journey: JourneyOption, fare: FareOption): string {
  const price =
    fare.totalPartyPriceCents !== null
      ? formatUsdCompact(fare.totalPartyPriceCents)
      : "price unknown";
  return [
    `${journey.originCode} → ${journey.destinationCode}`,
    formatDisplayDate(journey.searchedTravelDate),
    journey.trainNumber
      ? `${journey.serviceName ?? "Train"} ${journey.trainNumber}`
      : (journey.serviceName ?? "Amtrak"),
    formatClock(journey.departureAt),
    `${fareFamilyLabel(fare.fareFamily)} ${travelClassLabel(fare.travelClass)}`,
    `Observed ${price}`,
  ].join(" · ");
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
