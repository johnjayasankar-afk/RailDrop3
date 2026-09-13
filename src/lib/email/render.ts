/**
 * Email rendering. Pure and unit-testable: no transport, no secrets.
 *
 * Everything interpolated is HTML-escaped, and header values are stripped of
 * CR/LF, so no user- or provider-supplied string can inject markup or headers.
 */

import { formatCents, formatCentsCompact } from '@/lib/domain/money';
import {
  describeDisplacement,
  formatClock,
  formatDurationMinutes,
  formatMediumDate,
  minutesOfDayFromLocalIso,
} from '@/lib/domain/dates';
import type { AlertReason, CycleStatus, Opportunity, Watch } from '@/lib/domain/types';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Header values must never carry CR/LF. */
export function sanitizeHeaderValue(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 300);
}

function clock(iso: string): string {
  try {
    return formatClock(minutesOfDayFromLocalIso(iso));
  } catch {
    return '';
  }
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

export interface AlertEmailInput {
  watch: Watch;
  reason: AlertReason;
  best: Opportunity;
  others: Opportunity[];
  benchmarkCents: number;
  cycleStatus: CycleStatus;
  uncheckedDates: string[];
  watchUrl: string;
}

export function buildAlertSubject(input: AlertEmailInput): string {
  const { watch, best, reason } = input;
  const savings = formatCentsCompact(best.savingsCents);
  const route = `${watch.originCode} to ${watch.destinationCode}`;
  // A target the user set themselves is a different message from a generic
  // drop, and the subject line is the only part many people read.
  const lead = reason === 'TARGET_REACHED' ? 'Target reached' : 'Fare drop';
  return sanitizeHeaderValue(
    `${lead}: ${route} from ${formatCentsCompact(best.totalCents)} - save ${savings}`,
  );
}

const FOOTER =
  'Fares and availability may change. RailDrop does not automatically modify your Amtrak reservation.';

export function renderAlertEmail(input: AlertEmailInput): RenderedEmail {
  const { watch, best, others, benchmarkCents, watchUrl, uncheckedDates, cycleStatus } = input;
  const j = best.candidate.journey;
  const f = best.candidate.fare;

  const service = [j.serviceName, j.trainNumber].filter(Boolean).join(' ');
  const partial =
    cycleStatus === 'PARTIAL_SUCCESS' && uncheckedDates.length > 0
      ? `We could not check ${uncheckedDates.map((d) => formatMediumDate(d)).join(', ')} on this run.`
      : null;

  const text = [
    'RailDrop found cheaper options in your travel window.',
    '',
    'CURRENT TICKET',
    `${formatMediumDate(watch.desiredDate)}  ${formatCents(benchmarkCents)}`,
    '',
    'CHEAPEST',
    `${formatMediumDate(j.travelDate)}  ${formatCents(best.totalCents)}   Save ${formatCents(best.savingsCents)}`,
    service,
    `${clock(j.departureLocal)} - ${clock(j.arrivalLocal)}`,
    `${titleCase(f.family)} ${titleCase(f.travelClass)}`,
    describeDisplacement(best.displacementDays),
    '',
    ...(others.length > 0
      ? [
          'OTHER OPTIONS',
          ...others.map(
            (o) =>
              `${formatMediumDate(o.candidate.journey.travelDate)}  ${formatCents(o.totalCents)}   Save ${formatCents(o.savingsCents)}`,
          ),
          '',
        ]
      : []),
    ...(partial ? [partial, ''] : []),
    `View options: ${watchUrl}`,
    '',
    FOOTER,
  ].join('\n');

  const optionRow = (o: Opportunity): string => {
    const oj = o.candidate.journey;
    return `
      <tr>
        <td style="padding:12px 0;border-top:1px solid #e7e3dc;">
          <div style="font:600 15px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#16130f;">
            ${escapeHtml(formatMediumDate(oj.travelDate))}
            <span style="color:#6b635a;font-weight:400;">&middot; ${escapeHtml(describeDisplacement(o.displacementDays))}</span>
          </div>
          <div style="font:400 13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#6b635a;margin-top:2px;">
            ${escapeHtml([oj.serviceName, oj.trainNumber].filter(Boolean).join(' '))} &middot; ${escapeHtml(clock(oj.departureLocal))}
          </div>
        </td>
        <td align="right" style="padding:12px 0;border-top:1px solid #e7e3dc;white-space:nowrap;">
          <div style="font:700 17px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#16130f;">${escapeHtml(formatCents(o.totalCents))}</div>
          <div style="font:600 12px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a7f56;">Save ${escapeHtml(formatCents(o.savingsCents))}</div>
        </td>
      </tr>`;
  };

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(buildAlertSubject(input))}</title></head>
<body style="margin:0;padding:0;background:#faf8f5;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(
    `${formatCents(best.totalCents)} on ${formatMediumDate(j.travelDate)} - save ${formatCents(best.savingsCents)}`,
  )}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e7e3dc;border-radius:14px;">
  <tr><td style="padding:24px 24px 8px;">
    <div style="font:700 13px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#b44a1e;">RailDrop</div>
    <h1 style="margin:12px 0 4px;font:700 22px/1.25 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#16130f;">
      ${escapeHtml(watch.originCode)} &rarr; ${escapeHtml(watch.destinationCode)} got cheaper
    </h1>
    <p style="margin:0;font:400 15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#6b635a;">
      RailDrop found cheaper options in your travel window.
    </p>
  </td></tr>

  <tr><td style="padding:16px 24px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="font:600 11px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#8b8178;padding-bottom:6px;">Current ticket</td>
        <td align="right" style="font:600 11px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#8b8178;padding-bottom:6px;">Cheapest now</td>
      </tr>
      <tr>
        <td style="font:400 15px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#16130f;">
          ${escapeHtml(formatMediumDate(watch.desiredDate))}<br>
          <strong style="font-size:20px;">${escapeHtml(formatCents(benchmarkCents))}</strong>
        </td>
        <td align="right" style="font:400 15px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#16130f;">
          ${escapeHtml(formatMediumDate(j.travelDate))}<br>
          <strong style="font-size:26px;color:#1a7f56;">${escapeHtml(formatCents(best.totalCents))}</strong>
        </td>
      </tr>
    </table>
    <div style="margin-top:14px;background:#eaf6ef;border:1px solid #c9e6d6;border-radius:10px;padding:10px 14px;font:700 15px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#12603f;">
      Save ${escapeHtml(formatCents(best.savingsCents))}
    </div>
  </td></tr>

  <tr><td style="padding:18px 24px 0;">
    <div style="font:600 15px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#16130f;">${escapeHtml(service)}</div>
    <div style="font:400 14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#6b635a;">
      ${escapeHtml(clock(j.departureLocal))} &rarr; ${escapeHtml(clock(j.arrivalLocal))}
      &middot; ${escapeHtml(formatDurationMinutes(j.durationMinutes))}
      &middot; ${escapeHtml(j.transfers === 0 ? 'Direct' : `${j.transfers} transfer${j.transfers > 1 ? 's' : ''}`)}<br>
      ${escapeHtml(titleCase(f.family))} ${escapeHtml(titleCase(f.travelClass))}
      &middot; ${escapeHtml(describeDisplacement(best.displacementDays))}
    </div>
  </td></tr>

  ${
    others.length > 0
      ? `<tr><td style="padding:20px 24px 0;">
    <div style="font:600 11px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#8b8178;">Other options</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;">${others.map(optionRow).join('')}</table>
  </td></tr>`
      : ''
  }

  ${
    partial
      ? `<tr><td style="padding:16px 24px 0;">
    <div style="background:#fdf4e7;border:1px solid #f0dcc0;border-radius:10px;padding:10px 14px;font:400 13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#7a5626;">
      ${escapeHtml(partial)}
    </div></td></tr>`
      : ''
  }

  <tr><td style="padding:22px 24px 24px;">
    <a href="${escapeHtml(watchUrl)}" style="display:block;text-align:center;background:#16130f;color:#ffffff;text-decoration:none;padding:14px 20px;border-radius:10px;font:600 15px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">View options</a>
  </td></tr>

  <tr><td style="padding:0 24px 24px;">
    <p style="margin:0;font:400 12px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#8b8178;">${escapeHtml(FOOTER)}</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  return { subject: buildAlertSubject(input), html, text };
}

export function renderReadyEmail(appUrl: string): RenderedEmail {
  const subject = sanitizeHeaderValue('RailDrop is ready');
  const text = [
    'RailDrop is ready.',
    '',
    'Email delivery is configured and working.',
    `Open RailDrop: ${appUrl}`,
    '',
    FOOTER,
  ].join('\n');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;background:#faf8f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border:1px solid #e7e3dc;border-radius:14px;">
<tr><td style="padding:28px 24px;">
<div style="font:700 13px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#b44a1e;">RailDrop</div>
<h1 style="margin:12px 0 8px;font:700 22px/1.25 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#16130f;">RailDrop is ready</h1>
<p style="margin:0 0 20px;font:400 15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#6b635a;">Email delivery is configured and working. You will get an alert when a watched route gets cheaper.</p>
<a href="${escapeHtml(appUrl)}" style="display:block;text-align:center;background:#16130f;color:#fff;text-decoration:none;padding:14px 20px;border-radius:10px;font:600 15px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">Open RailDrop</a>
<p style="margin:20px 0 0;font:400 12px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#8b8178;">${escapeHtml(FOOTER)}</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, html, text };
}
