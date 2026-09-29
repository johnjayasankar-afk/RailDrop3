import { getFareProvider } from "@/lib/services";
import { previewFares, type DateProgress, type FarePreview } from "@/lib/watches/preview-fares";
import { ProviderNotConfiguredError } from "@/lib/providers/fare-provider";
import { errorDetail, errorMessage } from "@/lib/errors";
import { logger } from "@/lib/logger";

export const maxDuration = 300;

/* The same search, answered as it happens.
 *
 * /api/fares holds everything back until the slowest date returns, which on a
 * three-date window is ten to thirty seconds of a bar moving and nothing else.
 * The first date is usually done in a third of that. The information existed;
 * the shape of the response threw it away.
 *
 * NDJSON rather than Server-Sent Events. SSE brings a framing format, an
 * EventSource that cannot POST, and reconnect semantics that are wrong here —
 * a retried fare search is a second scrape, not a resumed one. One JSON object
 * per line over a plain POST needs no protocol and no client library.
 *
 * The ranking still only exists at the end. Ordering fares across a window is
 * a comparison between dates, so a progress line carries the cheapest on its
 * own date and nothing that pretends to be the final answer.
 */

type Line =
  | { type: "progress"; progress: DateProgress }
  | { type: "done"; preview: FarePreview }
  | { type: "error"; error: string };

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (line: Line) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
        } catch {
          // The reader went away mid-search. Nothing to do but stop writing.
          closed = true;
        }
      };

      try {
        const preview = await previewFares({
          body,
          provider: getFareProvider(),
          onProgress: (progress) => send({ type: "progress", progress }),
        });
        send({ type: "done", preview });
      } catch (error) {
        /* The same split as routeGuard: the hostname and the errno go to the
           log, a sentence goes to the reader. This route cannot use routeGuard
           itself, because by the time anything fails the response has already
           begun and its status is long since committed — which is exactly why
           the error is a line in the stream rather than a status code. */
        logger.error("api.fares_stream_failed", { detail: errorDetail(error) });
        send({
          type: "error",
          error:
            error instanceof ProviderNotConfiguredError ? errorMessage(error) : errorMessage(error),
        });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      // Proxies that buffer would undo the entire point of streaming.
      "X-Accel-Buffering": "no",
    },
  });
}
