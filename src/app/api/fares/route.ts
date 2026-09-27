import { NextResponse } from "next/server";
import { getFareProvider } from "@/lib/services";
import { previewFares } from "@/lib/watches/preview-fares";
import { ProviderNotConfiguredError } from "@/lib/providers/fare-provider";
import { errorDetail, errorMessage, isTransportFailure } from "@/lib/errors";
import { logger } from "@/lib/logger";

export const maxDuration = 300;

/**
 * Live fares, with no database in the path.
 *
 * Every route to a price went through creating a watch first, so when the
 * Supabase project behind a deployment stopped existing, the app could not show
 * anybody a single fare. The scraper was healthy throughout. We were refusing
 * to look until we had somewhere to write the answer down.
 *
 * Deliberately unauthenticated. A session here would be a guest cookie anyone
 * can mint, so it would cost a round trip and buy nothing; the real protection
 * against burning provider credit is the small date window and the provider's
 * own budget, neither of which needs to know who is asking. Nothing is written
 * and nothing about any user is read, so there is nothing here to protect.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const preview = await previewFares({ body, provider: getFareProvider() });
    return NextResponse.json({ preview });
  } catch (error) {
    const message = errorMessage(error);
    logger.error("fares.preview_failed", {
      transport: isTransportFailure(error),
      message,
      detail: errorDetail(error),
    });
    if (error instanceof ProviderNotConfiguredError) {
      return NextResponse.json({ error: message }, { status: 503 });
    }
    /* A transport failure here is the fare provider, not our database — there
     * is no database in this path. Either way it is not the caller's request
     * that was wrong. */
    return NextResponse.json({ error: message }, { status: isTransportFailure(error) ? 503 : 400 });
  }
}
