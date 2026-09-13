'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { searchTripsAction, type PaletteTrip } from '@/app/palette-actions';

interface Command {
  id: string;
  group: 'Actions' | 'Trips' | 'Go to' | 'Appearance';
  label: string;
  hint?: string;
  keywords?: string;
  run: () => void;
}

/**
 * ⌘K palette.
 *
 * Trips are loaded lazily the first time it opens rather than on every page
 * render, so a keyboard shortcut nobody presses costs nothing.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [trips, setTrips] = useState<PaletteTrip[]>([]);
  const [loaded, setLoaded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActive(0);
    // Return focus to whatever the user was on before, as a dialog must.
    restoreFocus.current?.focus?.();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        restoreFocus.current = document.activeElement as HTMLElement;
        setOpen((v) => !v);
        return;
      }
      // Bare "/" is a search convention, but must never hijack typing.
      if (event.key === '/' && !typing && !open) {
        event.preventDefault();
        restoreFocus.current = document.activeElement as HTMLElement;
        setOpen(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    if (loaded) return;
    void searchTripsAction().then((result) => {
      setTrips(result);
      setLoaded(true);
    });
  }, [open, loaded]);

  const setTheme = useCallback((theme: 'light' | 'dark' | 'system') => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try {
      if (theme === 'system') localStorage.removeItem('rd-theme');
      else localStorage.setItem('rd-theme', theme);
    } catch {
      /* storage may be blocked; the theme still applies for this page view */
    }
  }, []);

  const commands = useMemo<Command[]>(() => {
    const go = (path: string) => () => {
      close();
      router.push(path);
    };
    return [
      {
        id: 'new',
        group: 'Actions',
        label: 'Watch a trip',
        hint: 'Create',
        keywords: 'add create new watch trip',
        run: go('/watches/new'),
      },
      {
        id: 'trips',
        group: 'Go to',
        label: 'Your trips',
        keywords: 'dashboard home',
        run: go('/dashboard'),
      },
      {
        id: 'alerts',
        group: 'Go to',
        label: 'Alert history',
        keywords: 'notifications emails drops',
        run: go('/alerts'),
      },
      {
        id: 'settings',
        group: 'Go to',
        label: 'Settings',
        keywords: 'preferences notifications quiet hours push',
        run: go('/settings'),
      },
      {
        id: 'usage',
        group: 'Go to',
        label: 'Provider usage',
        keywords: 'credits budget spend ops',
        run: go('/usage'),
      },
      ...trips.map((trip) => ({
        id: `trip-${trip.id}`,
        group: 'Trips' as const,
        label: `${trip.originCode} → ${trip.destinationCode}`,
        hint: trip.hint,
        keywords: `${trip.originCode} ${trip.destinationCode} ${trip.originCity} ${trip.destinationCity} ${trip.dateLabel}`,
        run: go(`/watches/${trip.id}`),
      })),
      {
        id: 'light',
        group: 'Appearance',
        label: 'Light theme',
        keywords: 'theme colour color',
        run: () => {
          setTheme('light');
          close();
        },
      },
      {
        id: 'dark',
        group: 'Appearance',
        label: 'Dark theme',
        keywords: 'theme colour color',
        run: () => {
          setTheme('dark');
          close();
        },
      },
      {
        id: 'system',
        group: 'Appearance',
        label: 'Match system theme',
        keywords: 'theme auto',
        run: () => {
          setTheme('system');
          close();
        },
      },
    ];
  }, [trips, router, close, setTheme]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return commands;

    // Ranked, not just filtered. A subsequence match is a useful last resort
    // ("bosnyp" finds "BOS → NYP") but it must never outrank a literal hit —
    // typing "BOS" once put "Provider usage" first, because its keywords happen
    // to contain b…o…s in order.
    const score = (command: Command): number => {
      const label = command.label.toLowerCase();
      const keywords = `${command.hint ?? ''} ${command.keywords ?? ''}`.toLowerCase();
      if (label.startsWith(q)) return 0;
      if (label.includes(q)) return 1;
      if (keywords.includes(q)) return 2;
      let i = 0;
      for (const char of `${label} ${keywords}`) {
        if (char === q[i]) i += 1;
        if (i === q.length) return 3;
      }
      return Infinity;
    };

    return commands
      .map((command) => [score(command), command] as const)
      .filter(([rank]) => rank !== Infinity)
      .sort((a, b) => a[0] - b[0])
      .map(([, command]) => command);
  }, [commands, query]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const grouped = matches.reduce<Record<string, Command[]>>((acc, command) => {
    (acc[command.group] ??= []).push(command);
    return acc;
  }, {});
  let index = -1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/25 px-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-testid="command-palette"
        className="rd-card-raised w-full max-w-lg overflow-hidden"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <svg
            viewBox="0 0 16 16"
            className="size-4 shrink-0 text-faint"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <circle cx="7" cy="7" r="4.5" />
            <path strokeLinecap="round" d="M10.5 10.5L14 14" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-autocomplete="list"
            aria-label="Search trips and commands"
            placeholder="Search trips, jump to a page, run a command…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                close();
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((a) => Math.min(a + 1, matches.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                matches[active]?.run();
              }
            }}
            className="w-full bg-transparent py-3.5 text-[15px] text-ink outline-none placeholder:text-faint"
          />
          <kbd className="ticket hidden shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-faint sm:block">
            esc
          </kbd>
        </div>

        <div
          id="palette-list"
          role="listbox"
          ref={listRef}
          className="max-h-[52vh] overflow-y-auto p-1.5"
        >
          {matches.length === 0 ? (
            <p className="px-3 py-8 text-center text-[13.5px] text-muted">
              Nothing matches “{query}”.
            </p>
          ) : (
            Object.entries(grouped).map(([group, items]) => (
              <div key={group} className="mb-1 last:mb-0">
                <p className="rd-label px-2.5 pb-1 pt-2">{group}</p>
                {items.map((command) => {
                  index += 1;
                  const isActive = index === active;
                  const myIndex = index;
                  return (
                    <button
                      key={command.id}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      data-active={isActive}
                      onMouseMove={() => setActive(myIndex)}
                      onClick={command.run}
                      className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                        isActive ? 'bg-raised' : ''
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">
                        {command.label}
                      </span>
                      {command.hint ? (
                        <span className="shrink-0 text-[12px] text-faint">{command.hint}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[11px] text-faint">
          <span className="flex items-center gap-2.5">
            <Key>↑</Key>
            <Key>↓</Key>
            <span>navigate</span>
            <Key>↵</Key>
            <span>open</span>
          </span>
          <span className="hidden sm:block">
            Press <Key>?</Key> anywhere for shortcuts
          </span>
        </div>
      </div>
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="ticket rounded border border-line px-1 py-0.5 text-[10px] text-faint">
      {children}
    </kbd>
  );
}
