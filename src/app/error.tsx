"use client";

import { useEffect } from "react";
import { PageFrame } from "@/components/page-frame";
import { RouteRibbon } from "@/components/route-ribbon";
import { Flap } from "@/components/flap";

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

  return (
    <PageFrame>
      <main id="main" className="mx-auto max-w-xl px-4 py-24">
        <div className="depart-strip">
          <Flap>DELAY</Flap>
          <span className="depart-strip-rule" aria-hidden />
          <Flap>HOLD</Flap>
        </div>
        <p className="kicker mt-8">Service interruption</p>
        <h1 className="serif mt-3 text-4xl">The board could not load.</h1>
        <div className="mt-4 max-w-xs">
          <RouteRibbon origin="BOS" destination="NYP" compact />
        </div>
        <p className="mt-3 text-ink-soft">
          Live fares are still out there. Try again — this is usually a brief hitch, not a lost
          watch.
        </p>
        <button type="button" className="btn btn-primary mt-8" onClick={() => retry()}>
          Try again
        </button>
      </main>
    </PageFrame>
  );
}
