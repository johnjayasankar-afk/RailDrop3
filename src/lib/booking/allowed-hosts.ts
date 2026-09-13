const ALLOWED_HOSTS = new Set([
  "amtrak.com",
  "www.amtrak.com",
  "tickets.amtrak.com",
  "booking.amtrak.com",
]);

export function isAllowedBookingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return ALLOWED_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

export function assertAllowlistedUrl(url: string): string {
  if (!isAllowedBookingUrl(url)) {
    throw new Error(`Booking URL host not allowlisted: ${url}`);
  }
  return url;
}
