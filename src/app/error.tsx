"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { RouteRibbon } from "@/components/route-ribbon";
import { Flap } from "@/components/flap";
import { errorSubject } from "@/lib/domain/error-subject";

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  /* Safe to read during render here: usePathname only risks a hydration
     mismatch when a rewrite makes the browser URL differ from the prerendered
     one, and this app rewrites nowhere — proxy.ts only redirects, and
     next.config declares no rewrites. See the note in the Next 16 docs for
     usePathname. */
  const pathname = usePathname();
  const subject = errorSubject(pathname);

  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-24">
      <div className="depart-strip">
        <Flap>DELAY</Flap>
        <span className="depart-strip-rule" aria-hidden />
        <Flap>HOLD</Flap>
      </div>
      <p className="kicker mt-8">Service interruption</p>
      <h1 className="serif mt-3 text-4xl">{subject.heading}</h1>
      <div className="mt-4 max-w-xs">
        <RouteRibbon origin="BOS" destination="NYP" compact />
      </div>
      <p className="mt-3 text-ink-soft">{subject.body}</p>
      <button type="button" className="btn btn-primary mt-8" onClick={() => retry()}>
        Try again
      </button>
      {/* The only thing that identifies this failure in a log. React redacts
          the message in production and leaves the digest, so without it a
          report is "it broke" and nothing is findable. */}
      {error.digest ? (
        <p className="mt-8 text-xs text-ink-soft">
          Reference <code className="font-mono">{error.digest}</code>
        </p>
      ) : null}
    </main>
  );
}
