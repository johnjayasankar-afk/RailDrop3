import { NextResponse } from "next/server";
import { errorDetail, errorMessage, isTransportFailure } from "@/lib/errors";
import { ProviderNotConfiguredError } from "@/lib/providers/fare-provider";
import { logger } from "@/lib/logger";

/* One place an unhandled route failure turns into a response.
 *
 * Five routes that read or write the database had no try/catch at all. When the
 * Supabase project behind the deployment stopped resolving, every one of them
 * returned a bare 500 with an empty body: the dashboard, the board, the manual
 * recheck, the rebook form and the unsubscribe link all failed with nothing for
 * the reader and nothing in the log. The one route that did catch rendered
 * `TypeError: fetch failed` under a button.
 *
 * A wrapper rather than five copies, because the next route added would have
 * been the sixth without one.
 *
 * The split is the point: the log gets the hostname and the errno, the reader
 * gets a sentence they can act on, and a transport failure answers 503 so it is
 * distinguishable from "you sent me something invalid".
 */
export async function routeGuard(
  context: { route: string } & Record<string, unknown>,
  run: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await run();
  } catch (error) {
    const detail = errorDetail(error);
    const transport = isTransportFailure(error);
    logger.error("api.route_failed", {
      ...context,
      transport,
      // The untouched text. This is the only place it appears.
      detail,
    });
    if (error instanceof ProviderNotConfiguredError) {
      return NextResponse.json({ error: errorMessage(error) }, { status: 503 });
    }
    return NextResponse.json(
      { error: errorMessage(error) },
      // 503 is the honest code for "we could not reach our own database": it is
      // not the caller's request that was wrong, and it may work in a minute.
      { status: transport ? 503 : 500 },
    );
  }
}
