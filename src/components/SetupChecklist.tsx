'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

import { dismissSetupAction } from '@/app/settings-actions';
import type { SetupProgress } from '@/lib/queries';

interface Step {
  key: keyof Pick<SetupProgress, 'hasTrip' | 'hasPush' | 'hasTarget'>;
  title: string;
  body: string;
  href: string;
  cta: string;
}

const STEPS: Step[] = [
  {
    key: 'hasTrip',
    title: 'Watch a trip you have already booked',
    body: 'Two stations, your date, and the amount on your receipt. That number is the benchmark — nothing is estimated from it.',
    href: '/watches/new',
    cta: 'Add a trip',
  },
  {
    key: 'hasPush',
    title: 'Turn on push notifications',
    body: 'Fares move in minutes. An email eight hours later is often too late; a push arrives while the fare still exists.',
    href: '/settings',
    cta: 'Open settings',
  },
  {
    key: 'hasTarget',
    title: 'Set a target price',
    body: 'Name the number you would rebook at. RailDrop tells you the moment it is reached, even on a quiet week.',
    href: '/dashboard',
    cta: 'Open a trip',
  },
];

/**
 * First-run checklist.
 *
 * Push and target prices are the two settings that most change how well
 * RailDrop works, and both are invisible unless you go looking for them. This
 * disappears for good once every step is done or the user dismisses it — it is
 * a way in, not furniture.
 */
export function SetupChecklist({ progress }: { progress: SetupProgress }) {
  const [hidden, setHidden] = useState(false);
  const [pending, startTransition] = useTransition();

  if (hidden || progress.dismissed || progress.complete) return null;

  // A step nobody can complete would keep the checklist on screen forever.
  const steps = STEPS.filter((step) => step.key !== 'hasPush' || progress.pushAvailable);
  const done = steps.filter((step) => progress[step.key]).length;

  return (
    <section
      data-testid="setup-checklist"
      aria-labelledby="setup-heading"
      className="rd-card overflow-hidden"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-5 py-3.5">
        <div className="flex items-center gap-3">
          <h2 id="setup-heading" className="text-[14px] font-semibold tracking-tight text-ink">
            Get the most out of RailDrop
          </h2>
          <span className="tnum text-[11.5px] font-semibold text-faint">
            {done} of {steps.length}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div
            className="h-1 w-24 overflow-hidden rounded-full bg-line"
            role="progressbar"
            aria-valuenow={done}
            aria-valuemin={0}
            aria-valuemax={steps.length}
            aria-label="Setup progress"
          >
            <div
              className="h-full rounded-full bg-rust transition-[width] duration-500"
              style={{ width: `${(done / steps.length) * 100}%` }}
            />
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              // Hide immediately; persistence is not worth a spinner over.
              setHidden(true);
              startTransition(() => {
                void dismissSetupAction();
              });
            }}
            className="inline-flex min-h-8 items-center text-[12px] font-semibold text-faint transition-colors hover:text-ink"
          >
            Dismiss
          </button>
        </div>
      </div>

      <ol role="list" className="m-0 list-none divide-y divide-line">
        {steps.map((step) => {
          const complete = progress[step.key];
          return (
            <li key={step.key} className="flex items-start gap-3.5 px-5 py-3.5">
              <span
                aria-hidden="true"
                className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border transition-colors ${
                  complete
                    ? 'border-save bg-save text-white'
                    : 'border-line-strong text-transparent'
                }`}
              >
                <svg
                  viewBox="0 0 12 12"
                  className="size-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                >
                  <path d="M2.5 6.4L4.8 8.7L9.5 3.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>

              <div className="min-w-0 flex-1">
                <p
                  className={`text-[13.5px] font-semibold leading-snug ${
                    complete ? 'text-faint line-through decoration-line-strong' : 'text-ink'
                  }`}
                >
                  {step.title}
                  <span className="sr-only">{complete ? ' — done' : ' — not done yet'}</span>
                </p>
                {!complete ? (
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{step.body}</p>
                ) : null}
              </div>

              {!complete ? (
                <Link
                  href={step.href}
                  className="rd-btn rd-btn-secondary shrink-0 !min-h-11 !px-3 !text-[13px]"
                >
                  {step.cta}
                </Link>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
