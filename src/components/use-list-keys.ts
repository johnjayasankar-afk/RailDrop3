'use client';

import { useEffect, type RefObject } from 'react';

/**
 * j/k (and the arrow keys) walk a list; Enter opens what is focused.
 *
 * Deliberately implemented by **moving real DOM focus** between the list's own
 * links rather than tracking a parallel "active index". Focus rings, Enter to
 * activate, scroll-into-view and screen-reader announcement all then come from
 * the platform and stay correct; a shadow index would have had to reimplement
 * each of them and would drift from what is actually focused the moment the
 * user reached for Tab.
 *
 * Items are found at keypress time, so a list that filters or regroups under
 * the user needs no re-registration.
 */
export function useListKeys(container: RefObject<HTMLElement | null>, itemSelector: string): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      // Never hijack a keystroke meant for text.
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      // Nor one meant for a dialog on top of the list.
      if (document.querySelector('[role="dialog"]')) return;

      const root = container.current;
      if (!root) return;

      const items = Array.from(root.querySelectorAll<HTMLElement>(itemSelector)).filter(
        (item) => item.offsetParent !== null,
      );
      if (items.length === 0) return;

      const key = event.key;
      const forward = key === 'j' || key === 'ArrowDown';
      const backward = key === 'k' || key === 'ArrowUp';
      if (!forward && !backward) return;

      const active = document.activeElement as HTMLElement | null;
      const current = items.findIndex((item) => item === active || item.contains(active));

      // Arrow keys only take over once the list already has focus, so they
      // still scroll the page normally everywhere else. `j`/`k` are ours.
      const isArrow = key === 'ArrowDown' || key === 'ArrowUp';
      if (isArrow && current === -1) return;

      event.preventDefault();
      const next =
        current === -1
          ? forward
            ? 0
            : items.length - 1
          : Math.min(items.length - 1, Math.max(0, current + (forward ? 1 : -1)));

      items[next]?.focus();
      items[next]?.scrollIntoView({ block: 'nearest' });
    }

    window.addEventListener('keydown', onKeyDown);

    // Marks the list as actually keyboard-live. Before hydration the listener
    // does not exist and a keystroke is silently lost, so "the list is on
    // screen" is not the same claim as "the list responds to keys" — and only
    // the second one is safe to act on.
    const root = container.current;
    root?.setAttribute('data-list-keys', 'ready');

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      root?.removeAttribute('data-list-keys');
    };
  }, [container, itemSelector]);
}
