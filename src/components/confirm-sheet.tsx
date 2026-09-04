"use client";

import { useEffect, useId, useRef } from "react";
import { Flap } from "@/components/flap";

export function ConfirmSheet({
  open,
  title,
  body,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  busy = false,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  busy?: boolean;
}) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const root = document.getElementById("confirm-sheet");
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cancelRef.current?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab" || !root) return;
      const focusable = [
        ...root.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"),
      ];
      if (focusable.length === 0) return;
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
  }, [open]);

  if (!open) return null;

  return (
    <div
      id="confirm-sheet"
      className="help-sheet no-print"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onCancel}
    >
      <div className="help-card ticket p-6" onClick={(event) => event.stopPropagation()}>
        <div className="depart-strip -mx-6 -mt-6 mb-5">
          <Flap>DEL</Flap>
          <span className="depart-strip-rule" aria-hidden />
          <Flap>WATCH</Flap>
        </div>
        <h2 id={titleId} className="serif text-2xl">
          {title}
        </h2>
        <p className="mt-2 text-sm opacity-80">{body}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            ref={cancelRef}
            type="button"
            className="btn btn-ghost"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn btn-ghost dock-danger"
            onClick={() => void onConfirm()}
            disabled={busy}
          >
            {busy ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
