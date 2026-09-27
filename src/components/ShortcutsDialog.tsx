'use client';

import { useEffect, useRef, useState } from 'react';

const SHORTCUTS: Array<{ keys: string[]; description: string }> = [
  { keys: ['⌘', 'K'], description: 'Open the command palette' },
  { keys: ['/'], description: 'Search trips' },
  { keys: ['G', 'T'], description: 'Go to your trips' },
  { keys: ['G', 'A'], description: 'Go to alert history' },
  { keys: ['G', 'S'], description: 'Go to settings' },
  { keys: ['N'], description: 'Watch a new trip' },
  { keys: ['J'], description: 'Next item in a list' },
  { keys: ['K'], description: 'Previous item in a list' },
  { keys: ['↵'], description: 'Open the focused item' },
  { keys: ['?'], description: 'Show this list' },
  { keys: ['Esc'], description: 'Close any dialog' },
];

/** Press ? to see every shortcut. Discoverability is the point. */
export function ShortcutsDialog() {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restore = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (typing) return;

      if (event.key === '?') {
        event.preventDefault();
        restore.current = document.activeElement as HTMLElement;
        setOpen((v) => !v);
      } else if (event.key === 'Escape' && open) {
        setOpen(false);
        restore.current?.focus?.();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 px-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="rd-card-raised w-full max-w-sm p-5"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="shortcuts-title" className="text-[17px] font-bold tracking-tight text-ink">
            Keyboard shortcuts
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-lg p-1.5 text-faint transition-colors hover:text-ink"
          >
            <svg
              viewBox="0 0 12 12"
              className="size-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
            </svg>
          </button>
        </div>

        <dl className="mt-4 space-y-2.5">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.description} className="flex items-center justify-between gap-4">
              <dt className="text-[13.5px] text-muted">{shortcut.description}</dt>
              <dd className="flex shrink-0 items-center gap-1">
                {shortcut.keys.map((key) => (
                  <kbd
                    key={key}
                    className="ticket min-w-6 rounded border border-line bg-raised px-1.5 py-0.5 text-center text-[11px] text-ink-2"
                  >
                    {key}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
