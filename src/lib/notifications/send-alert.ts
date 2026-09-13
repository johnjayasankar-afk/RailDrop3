import { formatUsdCompact } from "@/lib/domain/money";
import { dateBadge, formatDisplayDate } from "@/lib/domain/calendar";
import { fareFamilyLabel, travelClassLabel } from "@/lib/domain/fare-family";
import { formatClock } from "@/lib/domain/timezone";
import type { CycleStatus, RankedCandidate } from "@/lib/domain/types";
import type { WatchRecord } from "@/lib/db/models";

export interface MailerResult {
  status: "ACCEPTED" | "FAILED";
  providerMessageId: string | null;
  errorMessage: string | null;
}

export interface Mailer {
  send(input: { to: string; subject: string; html: string; text: string }): Promise<MailerResult>;
}

export async function sendFareDropEmail(input: {
  mailer: Mailer;
  to: string;
  watch: WatchRecord;
  best: RankedCandidate;
  others: RankedCandidate[];
  byDate: Map<string, RankedCandidate>;
  appUrl: string;
  checkedAt: Date;
  cycleStatus: CycleStatus;
  skippedPastDates: string[];
}): Promise<MailerResult> {
  const subject = `Fare drop: ${input.watch.originCode} → ${input.watch.destinationCode} from ${formatUsdCompact(input.best.totalPartyPriceCents)} — save ${formatUsdCompact(input.best.savingsCents)}`;
  const html = renderHtml(input);
  const text = renderText(input);
  return input.mailer.send({ to: input.to, subject, html, text });
}

function renderHtml(input: Parameters<typeof sendFareDropEmail>[0]): string {
  const best = input.best;
  const partial =
    input.cycleStatus === "PARTIAL_SUCCESS"
      ? `<p style="color:#7A5A12;font-size:13px;">Best found so far. One or more travel days could not be refreshed.</p>`
      : "";
  const others = input.others
    .map(
      (candidate) => `
      <tr>
        <td style="padding:8px 0;border-top:1px solid #E8E1D6;">
          ${formatDisplayDate(candidate.journey.searchedTravelDate)}
          · ${formatUsdCompact(candidate.totalPartyPriceCents)}
          · Save ${formatUsdCompact(candidate.savingsCents)}
        </td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html><body style="margin:0;background:#efe8d9;color:#16120d;font-family:Georgia,serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <p style="letter-spacing:.18em;text-transform:uppercase;font-size:11px;color:#7a2433;">RailDrop</p>
    <h1 style="font-size:28px;line-height:1.15;margin:8px 0 16px;">RailDrop found cheaper options.</h1>
    <p style="font-size:16px;letter-spacing:.12em;">${input.watch.originCode} → ${input.watch.destinationCode}</p>
    <p style="color:#5c554b;">Your current booking · ${formatDisplayDate(input.watch.desiredTravelDate)} · ${formatUsdCompact(input.watch.currentBookedPriceCents)}${input.watch.bookedTrainNumber ? ` · train ${input.watch.bookedTrainNumber}` : ""}</p>
    ${partial}
    <div style="background:#f7f1e4;border:1px solid #16120d;padding:20px;margin:24px 0;">
      <p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#5c554b;">Cheapest option</p>
      <p style="font-size:42px;margin:8px 0 0;">${formatUsdCompact(best.totalPartyPriceCents)}</p>
      <p style="color:#1b6a44;font-size:16px;margin:4px 0 16px;">Save ${formatUsdCompact(best.savingsCents)}</p>
      <p>${formatDisplayDate(best.journey.searchedTravelDate)}<br/>
      ${best.journey.serviceName ?? "Amtrak"} ${best.journey.trainNumber ?? ""}<br/>
      ${formatClock(best.journey.departureAt)} → ${formatClock(best.journey.arrivalAt)}<br/>
      ${fareFamilyLabel(best.fare.fareFamily)} ${travelClassLabel(best.fare.travelClass)}<br/>
      ${dateBadge(best.dateOffsetDays)}</p>
      <p><a href="${input.appUrl}" style="color:#16120d;font-weight:600;">Open board · confirm on Amtrak</a></p>
      <p style="margin-top:12px;font-size:13px;color:#5c554b;white-space:pre-line;">Paste into Amtrak:
${input.watch.originCode} → ${input.watch.destinationCode}
${formatDisplayDate(best.journey.searchedTravelDate)}
${best.journey.serviceName ?? "Amtrak"} ${best.journey.trainNumber ?? ""}
${formatClock(best.journey.departureAt)} → ${formatClock(best.journey.arrivalAt)}</p>
    </div>
    <h2 style="font-size:14px;letter-spacing:.12em;text-transform:uppercase;">Other cheap options</h2>
    <table width="100%">${others}</table>
    <p style="margin-top:28px;color:#5c554b;font-size:13px;">Listed fares can change. Confirm on Amtrak before you change a ticket. RailDrop does not modify your reservation.</p>
    <p style="color:#5c554b;font-size:12px;">Checked ${input.checkedAt.toISOString()}</p>
  </div>
</body></html>`;
}

function renderText(input: Parameters<typeof sendFareDropEmail>[0]): string {
  const best = input.best;
  const others = input.others
    .map(
      (candidate) =>
        `${formatDisplayDate(candidate.journey.searchedTravelDate)} ${formatUsdCompact(candidate.totalPartyPriceCents)} save ${formatUsdCompact(candidate.savingsCents)}`,
    )
    .join("\n");
  return [
    "RailDrop found cheaper options.",
    `${input.watch.originCode} → ${input.watch.destinationCode}`,
    `Your current booking ${formatDisplayDate(input.watch.desiredTravelDate)} ${formatUsdCompact(input.watch.currentBookedPriceCents)}`,
    "",
    "CHEAPEST OPTION",
    `${formatUsdCompact(best.totalPartyPriceCents)} Save ${formatUsdCompact(best.savingsCents)}`,
    `${formatDisplayDate(best.journey.searchedTravelDate)}`,
    `${best.journey.serviceName ?? "Amtrak"} ${best.journey.trainNumber ?? ""}`,
    `${formatClock(best.journey.departureAt)} → ${formatClock(best.journey.arrivalAt)}`,
    `${fareFamilyLabel(best.fare.fareFamily)} ${travelClassLabel(best.fare.travelClass)}`,
    dateBadge(best.dateOffsetDays),
    "",
    `Open board: ${input.appUrl}`,
    "Confirm on Amtrak before you change a ticket.",
    "",
    "PASTE INTO AMTRAK",
    `${input.watch.originCode} → ${input.watch.destinationCode}`,
    `${formatDisplayDate(best.journey.searchedTravelDate)}`,
    `${best.journey.serviceName ?? "Amtrak"} ${best.journey.trainNumber ?? ""}`,
    `${formatClock(best.journey.departureAt)} → ${formatClock(best.journey.arrivalAt)}`,
    "",
    "OTHER CHEAP OPTIONS",
    others,
    "",
    "Fares and availability can change. RailDrop does not modify your Amtrak reservation automatically.",
    `Checked ${input.checkedAt.toISOString()}`,
  ].join("\n");
}
