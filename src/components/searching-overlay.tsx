"use client";

import { useEffect, useRef } from "react";
import { Flap } from "@/components/flap";

export function SearchingOverlay({
  origin,
  destination,
  date,
  elapsedSeconds,
  flexibility = 0,
  mode = "recheck",
  onCancel,
}: {
  origin: string;
  destination: string;
  date: string;
  elapsedSeconds: number;
  flexibility?: number;
  /** create = abort cancels; recheck = dismiss leaves request finishing if already sent */
  mode?: "create" | "recheck";
  onCancel?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  const windowLabel = flexibility > 0 ? `${date} ±${flexibility}` : date;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = rootRef.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    root?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelRef.current?.();
        return;
      }
      if (event.key !== "Tab" || !root) return;
      const focusable = [
        ...root.querySelectorAll<HTMLElement>("a[href], button, [tabindex]:not([tabindex='-1'])"),
      ];
      if (focusable.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);

  const waitCopy =
    elapsedSeconds >= 40
      ? mode === "create"
        ? "Still reading the live board — this can take a minute on slow days. Stay here, or dismiss to cancel this search."
        : "Still reading the live board — this can take a minute on slow days. Stay here for results, or dismiss this overlay."
      : flexibility > 0
        ? "Live board for your date window. Stay here — this can take about 20–40 seconds."
        : "This usually takes 15–30 seconds. Stay on this page — we open a live fare board, never invent prices.";

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="no-print fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--paper)_72%,black)] px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scan-title"
      aria-busy="true"
    >
      <div className="ticket w-full max-w-lg p-6 md:p-8">
        <div className="depart-strip -mx-6 -mt-6 mb-6 md:-mx-8 md:-mt-8">
          <Flap>{origin}</Flap>
          <span className="text-[10px] uppercase tracking-[0.18em] opacity-70">to</span>
          <Flap>{destination}</Flap>
          <span className="depart-strip-rule" aria-hidden />
          <Flap>{date}</Flap>
        </div>
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-ink-soft">
          <span className="scan-dot" />
          Scanning live fares
        </div>
        <p className="station-code mt-5 text-sm">
          {origin} → {destination}
        </p>
        <h2 id="scan-title" className="serif mt-2 text-3xl md:text-4xl">
          Checking every train on {windowLabel}
        </h2>
        <p className="mt-3 text-sm text-ink-soft">{waitCopy}</p>
        <div className="scan-line mt-6" aria-hidden>
          <span />
        </div>
        <div className="progress progress-indeterminate mt-3" role="status" aria-label="Scan in progress">
          <span />
        </div>
        <p className="mt-4 font-mono text-sm text-ink-soft" aria-live="polite">
          <Flap quiet>{`${elapsedSeconds}s`}</Flap> elapsed · not a fare estimate
        </p>
        {onCancel ? (
          <button type="button" className="btn btn-ghost mt-5 w-full py-3" onClick={onCancel}>
            {mode === "create" ? "Cancel search" : "Dismiss"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
