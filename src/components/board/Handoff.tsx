"use client";

import { useState } from "react";
import type { BookingLinkResolver } from "@/lib/booking/booking-link-resolver";
import type { RankedCandidate } from "@/lib/domain/types";

export function Handoff({
  candidate,
  resolver,
  compact = false,
}: {
  candidate: RankedCandidate;
  resolver: BookingLinkResolver;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const handoff = resolver.resolve({ journey: candidate.journey, fare: candidate.fare });
  return (
    <div className={`space-y-2 text-sm ${compact ? "max-w-full" : ""}`}>
      <a href={handoff.url} target="_blank" rel="noreferrer" className="btn btn-primary">
        {handoff.label}
      </a>
      {compact ? null : <p className="max-w-xs text-xs text-ink-soft">{handoff.copyText}</p>}
      <button
        type="button"
        className="underline"
        onClick={async () => {
          await navigator.clipboard.writeText(handoff.copyText);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        }}
      >
        {copied ? "Copied" : "Copy trip details"}
      </button>
    </div>
  );
}
