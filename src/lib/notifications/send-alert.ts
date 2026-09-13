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
      ? `<p style="color:#8a4a0b;font-size:13px;">Best found so far. One or more travel days could not be refreshed.</p>`
      : "";
  const others = input.others
    .map(
      (candidate) => `
      <tr>
        <td style="padding:8px 0;border-top:1px solid #e2e3dd;">
          ${formatDisplayDate(candidate.journey.searchedTravelDate)}
          · ${formatUsdCompact(candidate.totalPartyPriceCents)}
          · Save ${formatUsdCompact(candidate.savingsCents)}
        </td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html><body style="margin:0;background:#f8f6f1;color:#0f1712;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <p style="font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:.1em;text-transform:uppercase;font-size:11px;color:#8c2f39;">RailDrop</p>
    <h1 style="font-size:28px;line-height:1.15;font-weight:500;letter-spacing:-.02em;margin:8px 0 16px;">RailDrop found cheaper options.</h1>
    <p style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:16px;font-weight:600;letter-spacing:.06em;">${input.watch.originCode} → ${input.watch.destinationCode}</p>
    <p style="color:#5f6862;">Your current booking · ${formatDisplayDate(input.watch.desiredTravelDate)} · ${formatUsdCompact(input.watch.currentBookedPriceCents)}${input.watch.bookedTrainNumber ? ` · train ${input.watch.bookedTrainNumber}` : ""}</p>
    ${partial}
    <div style="background:#ffffff;border:1px solid #e2e3dd;border-radius:16px;padding:20px;margin:24px 0;">
      <p style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#5f6862;">Cheapest option</p>
      <p style="font-size:42px;font-weight:500;letter-spacing:-.03em;margin:8px 0 0;">${formatUsdCompact(best.totalPartyPriceCents)}</p>
      <p style="color:#1f6b4a;font-size:16px;margin:4px 0 16px;">Save ${formatUsdCompact(best.savingsCents)}</p>
      <p>${formatDisplayDate(best.journey.searchedTravelDate)}<br/>
      ${best.journey.serviceName ?? "Amtrak"} ${best.journey.trainNumber ?? ""}<br/>
      ${formatClock(best.journey.departureAt)} → ${formatClock(best.journey.arrivalAt)}<br/>
      ${fareFamilyLabel(best.fare.fareFamily)} ${travelClassLabel(best.fare.travelClass)}<br/>
      ${dateBadge(best.dateOffsetDays)}</p>
      <p><a href="${input.appUrl}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#1c3326;color:#ffffff;font-weight:600;text-decoration:none;">Open board · confirm on Amtrak</a></p>
      <p style="margin-top:12px;font-size:13px;color:#5f6862;white-space:pre-line;">Paste into Amtrak:
${input.watch.originCode} → ${input.watch.destinationCode}
${formatDisplayDate(best.journey.searchedTravelDate)}
${best.journey.serviceName ?? "Amtrak"} ${best.journey.trainNumber ?? ""}
${formatClock(best.journey.departureAt)} → ${formatClock(best.journey.arrivalAt)}</p>
    </div>
    <h2 style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:12px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:#5f6862;">Other cheap options</h2>
    <table width="100%">${others}</table>
    <p style="margin-top:28px;color:#5f6862;font-size:13px;">Listed fares can change. Confirm on Amtrak before you change a ticket. RailDrop does not modify your reservation.</p>
    <p style="color:#5f6862;font-size:12px;">Checked ${input.checkedAt.toISOString()}</p>
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
