'use client';

import { useState } from 'react';

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState('sending');
    setMessage(null);
    try {
      // Imported here rather than at module scope: the Supabase client is
      // ~70 kB and is needed only once somebody actually submits. Statically
      // importing it made /login the heaviest route in the app — 175 kB on the
      // first page an unauthenticated visitor ever loads. By the time this
      // resolves the user has already typed an email address.
      const { getBrowserSupabase } = await import('@/lib/db/browser');
      const supabase = getBrowserSupabase();
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      });
      if (error) throw error;
      setState('sent');
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'Could not send the sign-in link.');
    }
  }

  if (state === 'sent') {
    return (
      <div role="status" className="rounded-xl border border-save-line bg-save-soft px-4 py-4">
        <p className="text-[15px] font-semibold text-save">Check your email</p>
        <p className="mt-1 text-[14px] leading-relaxed text-save/90">
          We sent a sign-in link to <strong>{email}</strong>. It expires in an hour.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <div>
        <label htmlFor="email" className="rd-label">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          aria-invalid={state === 'error'}
          aria-describedby={message ? 'login-error' : undefined}
          className="rd-input mt-1.5"
        />
      </div>

      {message ? (
        <p id="login-error" role="alert" className="text-[13px] text-danger">
          {message}
        </p>
      ) : null}

      <button type="submit" disabled={state === 'sending'} className="rd-btn rd-btn-primary w-full">
        {state === 'sending' ? 'Sending link…' : 'Email me a sign-in link'}
      </button>

      <p className="text-[12px] leading-relaxed text-faint">
        We use a passwordless link — there is no password to create or remember.
      </p>
    </form>
  );
}
