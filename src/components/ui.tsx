import Link from 'next/link';
import type { ReactNode } from 'react';

// ─── Badge ───────────────────────────────────────────────────────────────────

export type BadgeTone = 'neutral' | 'save' | 'warn' | 'danger' | 'rust' | 'bus';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-raised text-muted border-line',
  save: 'bg-save-soft text-save border-save-line',
  warn: 'bg-warn-soft text-warn border-warn-line',
  danger: 'bg-danger-soft text-danger border-danger-line',
  rust: 'bg-rust-soft text-rust border-rust-line',
  bus: 'bg-raised text-ink-2 border-line-strong',
};

export function Badge({
  children,
  tone = 'neutral',
  title,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  title?: string;
}) {
  return (
    <span className={`rd-badge ${BADGE_TONES[tone]}`} title={title}>
      {children}
    </span>
  );
}

// ─── Stat ────────────────────────────────────────────────────────────────────

export function Stat({
  label,
  value,
  sub,
  tone = 'ink',
  size = 'md',
  testId,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'ink' | 'save' | 'muted';
  size?: 'md' | 'lg';
  testId?: string;
}) {
  const valueColor = tone === 'save' ? 'text-save' : tone === 'muted' ? 'text-muted' : 'text-ink';
  const valueSize = size === 'lg' ? 'text-[32px] sm:text-[38px]' : 'text-[22px] sm:text-[26px]';
  return (
    <div data-testid={testId}>
      <div className="rd-label">{label}</div>
      <div className={`tnum mt-1 font-bold leading-none tracking-tight ${valueSize} ${valueColor}`}>
        {value}
      </div>
      {sub ? <div className="mt-1.5 text-[13px] leading-snug text-muted">{sub}</div> : null}
    </div>
  );
}

// ─── Buttons / links ─────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost';
const VARIANT: Record<ButtonVariant, string> = {
  primary: 'rd-btn-primary',
  secondary: 'rd-btn-secondary',
  ghost: 'rd-btn-ghost',
};

export function ButtonLink({
  href,
  children,
  variant = 'primary',
  className = '',
  external = false,
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  className?: string;
  external?: boolean;
}) {
  const cls = `rd-btn ${VARIANT[variant]} ${className}`;
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

// ─── Layout ──────────────────────────────────────────────────────────────────

export function Section({
  title,
  action,
  children,
  className = '',
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      {title ? (
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="rd-label">{title}</h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="rd-card px-6 py-12 text-center">
      <p className="text-[17px] font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-2 max-w-sm text-[14px] leading-relaxed text-muted">{body}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Notice({
  tone = 'warn',
  title,
  children,
}: {
  tone?: 'warn' | 'danger' | 'save' | 'neutral';
  title?: string;
  children: ReactNode;
}) {
  const tones = {
    warn: 'bg-warn-soft border-warn-line text-warn',
    danger: 'bg-danger-soft border-danger-line text-danger',
    save: 'bg-save-soft border-save-line text-save',
    neutral: 'bg-raised border-line text-muted',
  } as const;
  return (
    <div className={`rounded-xl border px-4 py-3 text-[13px] leading-relaxed ${tones[tone]}`}>
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className={title ? 'mt-1' : ''}>{children}</div>
    </div>
  );
}
