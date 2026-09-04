import Link from "next/link";
import { PageFrame } from "@/components/page-frame";
import { RouteRibbon } from "@/components/route-ribbon";
import { Flap } from "@/components/flap";

export default function NotFoundPage() {
  return (
    <PageFrame>
      <main id="main" className="mx-auto max-w-xl px-4 py-24">
        <div className="depart-strip">
          <Flap>MISS</Flap>
          <span className="depart-strip-rule" aria-hidden />
          <Flap>CONN</Flap>
        </div>
        <p className="kicker mt-8">Missed connection</p>
        <h1 className="serif mt-3 text-4xl">That page is not on this timetable.</h1>
        <div className="mt-4 max-w-xs">
          <RouteRibbon origin="BOS" destination="NYP" compact />
        </div>
        <p className="mt-3 text-ink-soft">
          The watch may have been deleted, or the link is stale.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/" className="btn btn-primary">
            Back to RailDrop
          </Link>
          <Link href="/api/auth/guest?next=%2Fwatches%2Fnew" className="btn btn-ghost">
            Watch a trip
          </Link>
        </div>
      </main>
    </PageFrame>
  );
}
