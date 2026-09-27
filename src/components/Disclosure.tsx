'use client';

import { useId, useState, type ReactNode } from 'react';

/**
 * A section that is available without being in the way.
 *
 * Used for controls a person sets once and then forgets: they have to be
 * findable, but giving each of them a permanent block of a page pushes the
 * things people came for below the fold. The whole header is the control, so
 * the target is the full width rather than a word of link text.
 */
export function Disclosure({
  title,
  hint,
  children,
  defaultOpen = false,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-line-strong"
      >
        <span className="min-w-0">
          <span className="block text-[14px] font-semibold text-ink">{title}</span>
          {hint ? (
            <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted">{hint}</span>
          ) : null}
        </span>
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className={`size-4 shrink-0 text-faint transition-transform motion-reduce:transition-none ${
            open ? 'rotate-180' : ''
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {open ? (
        <div id={panelId} className="mt-3 rounded-xl border border-line bg-surface">
          {children}
        </div>
      ) : null}
    </div>
  );
}
