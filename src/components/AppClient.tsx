'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { CommandPalette } from './CommandPalette';
import { ShortcutsDialog } from './ShortcutsDialog';
import { ToastProvider } from './Toast';

/**
 * Client-side app bootstrap: toasts, the command palette, the shortcuts sheet,
 * and service worker registration.
 *
 * Registration is deliberately quiet — a browser that refuses (private mode,
 * insecure origin, no support) must not surface an error to someone who never
 * asked for notifications.
 */
export function AppClient({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pendingG = useRef(false);

  // Vim-style "go to" chords plus single-key actions, ignored whenever the user
  // is typing so they can never eat input.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable))
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (pendingG.current) {
        pendingG.current = false;
        const destination = { t: '/dashboard', a: '/alerts', s: '/settings', u: '/usage' }[key];
        if (destination) {
          event.preventDefault();
          router.push(destination);
        }
        return;
      }
      if (key === 'g') {
        pendingG.current = true;
        window.setTimeout(() => {
          pendingG.current = false;
        }, 1200);
        return;
      }
      if (key === 'n') {
        event.preventDefault();
        router.push('/watches/new');
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [router]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return (
    <ToastProvider>
      {children}
      <CommandPalette />
      <ShortcutsDialog />
    </ToastProvider>
  );
}
