'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'rd-theme';

function apply(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

/**
 * Light / dark / system. The choice is persisted per browser; "system" simply
 * removes the override and lets prefers-color-scheme decide.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'dark' || saved === 'light') setTheme(saved);
    } catch {
      // Private mode or blocked storage: fall back to system.
    }
  }, []);

  function choose(next: Theme) {
    setTheme(next);
    apply(next);
    try {
      if (next === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not fatal — the theme still applies for this page view.
    }
  }

  // Render a stable placeholder until mounted so the server and client agree.
  const active: Theme = mounted ? theme : 'system';

  const options: Array<{ value: Theme; label: string; icon: React.ReactNode }> = [
    { value: 'light', label: 'Light', icon: <SunIcon /> },
    { value: 'system', label: 'System', icon: <SystemIcon /> },
    { value: 'dark', label: 'Dark', icon: <MoonIcon /> },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="inline-flex items-center gap-0.5 rounded-full border border-line bg-surface p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={active === option.value}
          aria-label={option.label}
          title={option.label}
          onClick={() => choose(option.value)}
          className={`inline-flex size-8 items-center justify-center rounded-full transition-colors ${
            active === option.value ? 'bg-invert text-on-invert' : 'text-faint hover:text-ink'
          }`}
        >
          {option.icon}
        </button>
      ))}
    </div>
  );
}

function SunIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-[15px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="3.1" />
      <path
        strokeLinecap="round"
        d="M8 1v1.6M8 13.4V15M15 8h-1.6M2.6 8H1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1M12.9 12.9l-1.1-1.1M4.2 4.2L3.1 3.1"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-[15px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.5 9.6A5.9 5.9 0 0 1 6.4 2.5a5.9 5.9 0 1 0 7.1 7.1Z"
      />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-[15px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <rect x="1.8" y="2.8" width="12.4" height="8.4" rx="1.3" />
      <path strokeLinecap="round" d="M5.5 13.8h5" />
    </svg>
  );
}
