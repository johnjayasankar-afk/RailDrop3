import { formatUsdCompact } from "@/lib/domain/money";
import { dateBadge, formatDisplayDate } from "@/lib/domain/calendar";
import { fareFamilyLabel, travelClassLabel } from "@/lib/domain/fare-family";
import { formatClock } from "@/lib/domain/timezone";
import type { CycleStatus, RankedCandidate } from "@/lib/domain/types";
import type { WatchRecord } from "@/lib/db/models";
import { unsubscribeHeaders, unsubscribeUrl } from "./unsubscribe";
import { alertBoardUrl } from "@/lib/domain/board-url";

export interface MailerResult {
  status: "ACCEPTED" | "FAILED";
  providerMessageId: string | null;
  errorMessage: string | null;
}

export interface Mailer {
  send(input: {
    to: string;
    subject: string;
    html: string;
    text: string;
    /** List-Unsubscribe and friends. Optional so test mailers stay simple. */
    headers?: Record<string, string>;
  }): Promise<MailerResult>;
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
  const origin = originOf(input.appUrl);
  const stop = unsubscribeUrl(origin, input.watch.id);
  const html = `${renderHtml(input)}${unsubscribeFooterHtml(stop)}`;
  const text = `${renderText(input)}${stop ? `\n\nStop these emails: ${stop}` : ""}`;
  return input.mailer.send({
    to: input.to,
    subject,
    html,
    text,
    headers: unsubscribeHeaders(origin, input.watch.id),
  });
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

  const preheader = `${formatUsdCompact(best.totalPartyPriceCents)} on ${formatDisplayDate(best.journey.searchedTravelDate)} — ${formatUsdCompact(best.savingsCents)} below what you paid.`;
  /* The board, already showing the day this drop is on, cheapest first.
   *
   * The generic watch link made the reader do the filtering again: a ±3 window
   * on a busy corridor opens at sixty rows ranked by a heuristic, and the fare
   * the email is about can be anywhere in it. This lands on the right day with
   * the five-row cap lifted. It deliberately does not pin the row — by the time
   * someone opens their mail that fare may be gone, and a link pinning it would
   * open on an empty board and look broken rather than sold out. */
  const boardLink = alertBoardUrl(input.appUrl, best.journey.searchedTravelDate);

  return `<!doctype html>
<html><head><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<style>
  /* The paper palette inverts badly in a dark client: near-white panels on a
     dark chrome, with ink that the client then tries to lighten. Clients that
     support this get the board's own dark values; everyone else keeps the
     inline light styles below, which stay authoritative. */
  @media (prefers-color-scheme: dark) {
    .rd-body { background:#0f1d15 !important; color:#f0f7f3 !important; }
    .rd-card { background:#1f382b !important; border-color:#2b4a39 !important; }
    .rd-muted { color:#a3b8ac !important; }
    .rd-ink { color:#f0f7f3 !important; }
  }
</style></head>
<body class="rd-body" style="margin:0;background:#f8f6f1;color:#0f1712;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif;">
  <!-- Inbox preview text. Without it the preview showed the "RAILDROP" eyebrow. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <p style="font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:.1em;text-transform:uppercase;font-size:11px;color:#8c2f39;">RailDrop</p>
    <h1 style="font-size:28px;line-height:1.15;font-weight:500;letter-spacing:-.02em;margin:8px 0 16px;">RailDrop found cheaper options.</h1>
    <p style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:16px;font-weight:600;letter-spacing:.06em;">${input.watch.originCode} → ${input.watch.destinationCode}</p>
    <p style="color:#5f6862;">Your current booking · ${formatDisplayDate(input.watch.desiredTravelDate)} · ${formatUsdCompact(input.watch.currentBookedPriceCents)}${input.watch.bookedTrainNumber ? ` · train ${input.watch.bookedTrainNumber}` : ""}</p>
    ${partial}
    <div class="rd-card" style="background:#ffffff;border:1px solid #e2e3dd;border-radius:16px;padding:20px;margin:24px 0;">
      <p style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#5f6862;">Cheapest option</p>
      <p style="font-size:42px;font-weight:500;letter-spacing:-.03em;margin:8px 0 0;">${formatUsdCompact(best.totalPartyPriceCents)}</p>
      <p style="color:#1f6b4a;font-size:16px;margin:4px 0 16px;">Save ${formatUsdCompact(best.savingsCents)}</p>
      <p>${formatDisplayDate(best.journey.searchedTravelDate)}<br/>
      ${best.journey.serviceName ?? "Amtrak"} ${best.journey.trainNumber ?? ""}<br/>
      ${formatClock(best.journey.departureAt)} → ${formatClock(best.journey.arrivalAt)}<br/>
      ${fareFamilyLabel(best.fare.fareFamily)} ${travelClassLabel(best.fare.travelClass)}<br/>
      ${dateBadge(best.dateOffsetDays)}</p>
      <p><a href="${boardLink}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#1c3326;color:#ffffff;font-weight:600;text-decoration:none;">Open board · confirm on Amtrak</a></p>
      <p style="margin-top:12px;font-size:13px;color:#5f6862;white-space:pre-line;">Paste into Amtrak:
${input.watch.originCode} → ${input.watch.destinationCode}
${formatDisplayDate(best.journey.searchedTravelDate)}
${best.journey.serviceName ?? "Amtrak"} ${best.journey.trainNumber ?? ""}
${formatClock(best.journey.departureAt)} → ${formatClock(best.journey.arrivalAt)}</p>
    </div>
    <h2 style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:12px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:#5f6862;">Other cheap options</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${others}</table>
    <p style="margin-top:28px;color:#5f6862;font-size:13px;">Listed fares can change. Confirm on Amtrak before you change a ticket. RailDrop does not modify your reservation.</p>
    <p class="rd-muted" style="color:#5f6862;font-size:12px;">Checked ${formatInWatchZone(input.checkedAt, input.watch.timezone)}</p>
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
    `Open board: ${alertBoardUrl(input.appUrl, best.journey.searchedTravelDate)}`,
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
    `Checked ${formatInWatchZone(input.checkedAt, input.watch.timezone)}`,
  ].join("\n");
}

/**
 * "The fare we told you about is gone."
 *
 * Its own email because there is no better option to show — that is the whole
 * message. Sending the fare-drop template with an empty body, or saying
 * nothing at all, both leave the traveler holding a price that no longer
 * exists. Nothing here states a fare we have not observed: the lost price is
 * the one we previously sent them, and the current cheapest is included only
 * when there is one.
 */
export async function sendOpportunityLostEmail(input: {
  mailer: Mailer;
  to: string;
  watch: WatchRecord;
  lostPriceCents: number;
  /** The cheapest listed fare now, if anything is listed at all. */
  currentCheapestCents: number | null;
  appUrl: string;
  checkedAt: Date;
}): Promise<MailerResult> {
  const { originCode: from, destinationCode: to } = input.watch;
  const lost = formatUsdCompact(input.lostPriceCents);
  const now =
    input.currentCheapestCents === null
      ? "Nothing cheaper than your booking is listed right now."
      : `The cheapest listed fare now is ${formatUsdCompact(input.currentCheapestCents)}.`;

  const subject = `Sold out: the ${lost} on ${from} → ${to} is gone`;
  const html = `<!doctype html>
<html><body style="margin:0;background:#f8f6f1;color:#0f1712;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${lost} is no longer listed. ${now}</div>
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <p style="letter-spacing:.18em;text-transform:uppercase;font-size:11px;color:#8c2f39;margin:0;">RailDrop</p>
    <h1 style="font-size:24px;line-height:1.2;margin:10px 0 14px;">The ${lost} option is no longer listed.</h1>
    <p style="font-size:15px;line-height:1.55;margin:0 0 12px;">
      We told you about a ${lost} fare on ${from} → ${to}. It is not showing any more. ${now}
    </p>
    <p style="font-size:15px;line-height:1.55;margin:0 0 20px;">
      Your booking is untouched and we are still watching. We will write again if something
      qualifies.
    </p>
    <p style="margin:0 0 24px;">
      <a href="${input.appUrl}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#1c3326;color:#ffffff;font-weight:600;text-decoration:none;">Open board · confirm on Amtrak</a>
    </p>
    <p style="font-size:12px;color:#5f6862;margin:0;">
      Checked ${formatInWatchZone(input.checkedAt, input.watch.timezone)}. Fares and availability
      change constantly — always confirm on Amtrak.
    </p>
  </div>
</body></html>`;

  const text = [
    `The ${lost} option on ${from} → ${to} is no longer listed.`,
    now,
    "Your booking is untouched and we are still watching.",
    `Open board: ${input.appUrl}`,
    `Checked ${formatInWatchZone(input.checkedAt, input.watch.timezone)}.`,
  ].join("\n");

  const origin = originOf(input.appUrl);
  const stop = unsubscribeUrl(origin, input.watch.id);
  return input.mailer.send({
    to: input.to,
    subject,
    html: `${html}${unsubscribeFooterHtml(stop)}`,
    text: `${text}${stop ? `\nStop these emails: ${stop}` : ""}`,
    headers: unsubscribeHeaders(origin, input.watch.id),
  });
}

/** The site origin, recovered from the per-watch board link. */
function originOf(appUrl: string): string {
  try {
    return new URL(appUrl).origin;
  } catch {
    return appUrl.replace(/\/watches\/.*$/, "");
  }
}

/**
 * A visible way out, not only a header.
 *
 * The headers cover clients that render their own control; this covers
 * everyone else. Someone who never had an account still gets a link they can
 * click without proving who they are.
 */
function unsubscribeFooterHtml(url: string | null): string {
  if (!url) return "";
  return `<div style="max-width:560px;margin:0 auto;padding:0 20px 28px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
    <p style="font-size:12px;line-height:1.5;color:#5f6862;margin:0;border-top:1px solid #e2e3dd;padding-top:14px;">
      You are receiving this because an alert email was added to this trip on RailDrop.
      <a href="${url}" style="color:#1c3326;">Stop emails for this trip</a>.
      RailDrop is an independent fare watch and is not affiliated with Amtrak.
    </p>
  </div>`;
}

/**
 * A timestamp a person can read, in the timezone of their trip.
 *
 * The fare-drop template rendered a raw UTC ISO string into a consumer email.
 */
export function formatInWatchZone(at: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(at);
  } catch {
    // An unusable zone must not cost the traveler their email.
    return at.toISOString();
  }
}
