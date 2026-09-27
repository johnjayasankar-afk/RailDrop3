import { unstable_rethrow } from "next/navigation";
import { errorDetail, isTransportFailure } from "@/lib/errors";
import { logger } from "@/lib/logger";

/* The page half of what src/lib/api/respond.ts does for routes.
 *
 * Every API route that reads the database is wrapped in routeGuard, so when the
 * Supabase project behind the deployment stopped resolving they answered 503
 * with a sentence. The pages had no equivalent. /dashboard calls
 * listWatchesForUser on line one and /watches/[id] makes seven repository calls
 * in a row, none of them guarded, so a dead database threw straight past them
 * into app/error.tsx — which says "The board could not load ... Live fares are
 * still out there. Try again: this is usually a brief hitch, not a lost watch."
 *
 * Three things wrong with that, in rising order of seriousness. It blames the
 * board, which was fine. It promises a retry will help, when the host does not
 * resolve and no number of retries will change that. And it is the one screen
 * that should say "your saved trips are what we cannot reach, the live search
 * still works" — because it does: /api/fares needs no database and answers in
 * about eight seconds. A reader told "brief hitch" tries again and leaves.
 *
 * Only a transport failure degrades. A bug in our own code still throws, and
 * still reaches the error boundary, because quietly relabelling a real defect
 * as "the database is unreachable" is the same class of lie as inventing a
 * price: a confident sentence about something we did not observe.
 */
export type PageData<T> = { reachable: true; data: T } | { reachable: false };

export async function loadPageData<T>(
  context: { page: string } & Record<string, unknown>,
  load: () => Promise<T>,
): Promise<PageData<T>> {
  try {
    return { reachable: true, data: await load() };
  } catch (error) {
    /* First, and before anything reads the error. notFound() and redirect()
     * work by throwing, so catching them without this turns "this watch is not
     * yours" into "the database is down", and a 404 into a 200 with the wrong
     * page on it. unstable_rethrow also covers the dynamic-rendering and
     * postpone signals, which are likewise not ours to swallow. */
    unstable_rethrow(error);
    if (!isTransportFailure(error)) throw error;
    // The hostname and the errno go here and nowhere else.
    logger.error("page.records_unreachable", { ...context, detail: errorDetail(error) });
    return { reachable: false };
  }
}
