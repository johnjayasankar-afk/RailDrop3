"use client";

import { useSyncExternalStore } from "react";

/* Light, dark, or whatever the machine says.
 *
 * Three states rather than two, because "follow the system" is a real answer
 * and a two-way switch silently takes it away — someone whose phone flips at
 * sunset wants the page to flip too, and a boolean cannot express that.
 *
 * The chosen value lives in localStorage under one key and is applied to
 * <html data-theme> by a blocking script in the document head (see layout.tsx),
 * so the first paint is already correct. Doing it here instead would show a
 * white flash on every navigation for anyone who picked dark.
 *
 * useSyncExternalStore, not useState + useEffect: the stored value is a
 * client-only source, the server has no idea what it is, and reading it during
 * render would hydrate a different tree than was sent. getServerSnapshot
 * returns "system", which is what the server assumed.
 */

export type ThemePreference = "light" | "dark" | "system";

const KEY = "raildrop.theme";
const listeners = new Set<() => void>();

function read(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    // Private mode, or storage blocked. Following the system is the right
    // fallback: it is what the page is already doing.
    return "system";
  }
}

/** Cached, because getSnapshot must return a stable value between changes. */
let current: ThemePreference | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab, same browser.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    current = read();
    for (const l of listeners) l();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): ThemePreference {
  current ??= read();
  return current;
}

const getServerSnapshot = (): ThemePreference => "system";

export function applyTheme(next: ThemePreference): void {
  current = next;
  try {
    if (next === "system") window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, next);
  } catch {
    // The page still changes; only the memory of it is lost.
  }
  const root = document.documentElement;
  if (next === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", next);
  for (const listener of listeners) listener();
}

const OPTIONS: Array<{ value: ThemePreference; label: string; title: string }> = [
  { value: "light", label: "Day", title: "Always the light board" },
  { value: "system", label: "Auto", title: "Follow this device" },
  { value: "dark", label: "Night", title: "Always the dark board" },
];

export function ThemeToggle() {
  const preference = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return (
    <div className="theme-toggle no-print" role="group" aria-label="Colour scheme">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          aria-pressed={preference === option.value}
          onClick={() => applyTheme(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
