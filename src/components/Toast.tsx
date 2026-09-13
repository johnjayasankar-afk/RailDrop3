'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export type ToastTone = 'neutral' | 'save' | 'warn' | 'danger';

export interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}

export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  action?: ToastAction;
  /** Milliseconds before auto-dismiss. Toasts with an action get longer by default. */
  durationMs?: number;
}

interface ToastRecord extends ToastInput {
  id: number;
  leaving: boolean;
}

interface ToastApi {
  toast: (input: ToastInput) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Transient feedback that does not move the page.
 *
 * Announced politely rather than assertively: these confirm an action the user
 * just took, so interrupting a screen reader mid-sentence would be rude. The
 * one thing that must not be transient is an error that loses work, which is
 * why destructive actions carry an Undo action rather than a warning.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    // Let the exit transition finish before unmounting.
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 180);
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const id = nextId.current;
      nextId.current += 1;
      const duration = input.durationMs ?? (input.action ? 9000 : 4500);
      setToasts((current) => [...current.slice(-3), { ...input, id, leaving: false }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), duration),
      );
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) clearTimeout(timer);
      map.clear();
    };
  }, []);

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-4 pb-4 sm:items-end sm:px-6 sm:pb-6"
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const TONE_STYLES: Record<ToastTone, string> = {
  neutral: 'border-line-strong',
  save: 'border-save-line',
  warn: 'border-warn-line',
  danger: 'border-danger-line',
};

const TONE_DOT: Record<ToastTone, string> = {
  neutral: 'bg-faint',
  save: 'bg-save',
  warn: 'bg-warn',
  danger: 'bg-danger',
};

function ToastCard({ toast, onDismiss }: { toast: ToastRecord; onDismiss: () => void }) {
  const tone = toast.tone ?? 'neutral';
  const [busy, setBusy] = useState(false);

  return (
    <div
      role="status"
      data-testid="toast"
      className={`rd-card-raised pointer-events-auto flex w-full max-w-sm items-start gap-3 px-4 py-3 transition-all duration-150 ${
        TONE_STYLES[tone]
      } ${toast.leaving ? 'translate-y-1 opacity-0' : 'translate-y-0 opacity-100'}`}
    >
      <span
        aria-hidden="true"
        className={`mt-1.5 size-1.5 shrink-0 rounded-full ${TONE_DOT[tone]}`}
      />

      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold leading-snug text-ink">{toast.title}</p>
        {toast.description ? (
          <p className="mt-0.5 text-[13px] leading-snug text-muted">{toast.description}</p>
        ) : null}
      </div>

      {toast.action ? (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await toast.action?.onClick();
            } finally {
              setBusy(false);
              onDismiss();
            }
          }}
          className="shrink-0 rounded-lg px-2 py-1 text-[13px] font-bold text-rust underline decoration-rust/30 underline-offset-4 transition-colors hover:decoration-rust disabled:opacity-50"
        >
          {busy ? '…' : toast.action.label}
        </button>
      ) : null}

      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mr-1 -mt-1 shrink-0 rounded-lg p-1 text-faint transition-colors hover:text-ink"
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
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) {
    // A no-op keeps a component usable outside the provider (e.g. in isolation
    // tests) instead of crashing the tree.
    return { toast: () => 0, dismiss: () => {} };
  }
  return context;
}
