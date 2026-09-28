"use client";

import { useId, useState } from "react";
import { fareProvenance } from "@/lib/domain/provenance";
import type { SanityContext } from "@/lib/domain/fare-sanity";
import type { RankedCandidate } from "@/lib/domain/types";

/* Where this number came from, on demand.
 *
 * Collapsed by default: most people want the fare, and a derivation printed
 * under every row would bury it. But the claim this product makes is unusual
 * enough to be worth being able to check, and a promise you can audit is a
 * different kind of promise from one you cannot.
 *
 * It is drawn as a log rather than as prose because that is what it is — the
 * chain from what the source literally reported to the figure on screen, with
 * the arithmetic shown at each step and the checks it survived at the end.
 *
 * The clock is read once, when the panel opens, and passed in. Reading it
 * during render would make the component impure and put a different "14
 * minutes ago" on the server and the client.
 */
export function FareProvenance({
  candidate,
  context,
}: {
  candidate: RankedCandidate;
  context: SanityContext;
}) {
  const [openedAt, setOpenedAt] = useState<Date | null>(null);
  const id = useId();

  return (
    <div className="prov-wrap">
      <button
        type="button"
        className="prov-toggle"
        aria-expanded={openedAt !== null}
        aria-controls={id}
        onClick={() => setOpenedAt(openedAt ? null : new Date())}
      >
        {openedAt ? "Hide source" : "Where from?"}
      </button>

      {openedAt ? <Receipt id={id} candidate={candidate} context={context} now={openedAt} /> : null}
    </div>
  );
}

function Receipt({
  id,
  candidate,
  context,
  now,
}: {
  id: string;
  candidate: RankedCandidate;
  context: SanityContext;
  now: Date;
}) {
  const trail = fareProvenance(candidate, context, now);

  return (
    <div className="prov" id={id}>
      {trail.steps.map((step) => (
        <div className="prov-step" key={step.label}>
          <span className="prov-label">{step.label}</span>
          <span className="prov-value">{step.value}</span>
          {step.note ? <span className="prov-note">{step.note}</span> : null}
        </div>
      ))}

      <div className="prov-foot">
        <span>
          Seen <strong>{trail.age}</strong> by {trail.source}
        </span>
        {trail.failures.length === 0 ? (
          <span className="prov-ok">✓ passed {trail.checksRun} plausibility checks</span>
        ) : (
          <span className="prov-bad">
            {trail.failures.length} of {trail.checksRun} checks failed
          </span>
        )}
        {/* The request id is the only thing here that ties a number on a screen
            to a line in a server log, which is what makes a complaint about a
            fare answerable rather than a matter of opinion. */}
        <span className="prov-id">req {trail.requestId.slice(0, 8)}</span>
      </div>
    </div>
  );
}
