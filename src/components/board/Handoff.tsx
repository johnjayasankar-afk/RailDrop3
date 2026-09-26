"use client";

import { useState } from "react";
import { copyText } from "@/lib/clipboard";
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
  const [failedText, setFailedText] = useState<string | null>(null);
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
          // "Copied" only if it actually was. The failure path shows the text
          // instead of claiming success.
          const outcome = await copyText(handoff.copyText);
          if (outcome === "failed") {
            setFailedText(handoff.copyText);
            return;
          }
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        }}
      >
        {copied ? "Copied" : "Copy trip details"}
      </button>
      {failedText ? (
        <div className="copy-fallback">
          <p>This browser blocked the clipboard. Select and copy:</p>
          <textarea
            readOnly
            value={failedText}
            rows={3}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button type="button" className="underline" onClick={() => setFailedText(null)}>
            Done
          </button>
        </div>
      ) : null}
    </div>
  );
}
