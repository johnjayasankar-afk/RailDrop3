"use client";

import { useEffect, useRef } from "react";
import { Flap } from "@/components/flap";

export function SearchingOverlay({
  origin,
  destination,
  date,
  elapsedSeconds,
  flexibility = 0,
  onCancel,
}: {
  origin: string;
  destination: string;
  date: string;
  elapsedSeconds: number;
  flexibility?: number;
  onCancel?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  const windowLabel = flexibility > 0 ? `${date} ±${flexibility}` : date;
  const progress = Math.min(95, Math.round((elapsedSeconds / 28) * 100));

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
        <p className="mt-3 text-sm text-ink-soft">
          {elapsedSeconds >= 40
            ? "Still reading the live board — Wanderu can take a minute on slow days. Stay here, or dismiss and leave the scan running."
            : flexibility > 0
              ? "Live board for your date window. Stay here — this can take about 20–40 seconds."
              : "This usually takes 15–30 seconds. Stay on this page — we are opening a live fare board, not inventing prices."}
        </p>
        <div className="scan-line mt-6">
          <span />
        </div>
        <div
          className="progress mt-3"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-label="Scan progress estimate"
        >
          <span style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-4 font-mono text-sm text-ink-soft" aria-live="polite">
          <Flap>{`${elapsedSeconds}s`}</Flap> elapsed
        </p>
        {onCancel ? (
          <button type="button" className="btn btn-ghost mt-5 w-full py-3" onClick={onCancel}>
            Dismiss scan
          </button>
        ) : null}
      </div>
    </div>
  );
}
