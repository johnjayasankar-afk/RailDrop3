"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PageFrame } from "@/components/page-frame";
import { RouteRibbon } from "@/components/route-ribbon";
import { Flap } from "@/components/flap";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const local = process.env.NEXT_PUBLIC_RAILDROP_LOCAL === "1";

  useEffect(() => {
    const remembered = window.localStorage.getItem("raildrop.email");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- remember email without hydrating from localStorage on the server
    if (remembered) setEmail(remembered);
  }, []);

  useEffect(() => {
    if (sent) codeRef.current?.focus();
  }, [sent]);

  async function sendLink(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setMessage(null);
    try {
      window.localStorage.setItem("raildrop.email", email);
      const e2e = await fetch("/api/test/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (e2e.ok) {
        router.push("/dashboard");
        return;
      }
      const { createBrowserSupabase } = await import("@/lib/supabase/browser");
      const supabase = createBrowserSupabase();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/api/auth/callback` },
      });
      if (error) throw error;
      setSent(true);
      setMessage("Check your email for a magic link or six-digit code.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start sign-in");
    } finally {
      setSending(false);
    }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    setVerifying(true);
    try {
      const { createBrowserSupabase } = await import("@/lib/supabase/browser");
      const supabase = createBrowserSupabase();
      const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
      if (error) throw error;
      router.push("/dashboard");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Invalid code");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <PageFrame>
      <main id="main" className="mx-auto max-w-md px-4 py-8 md:py-16">
        <div className="depart-strip">
          <Flap>SIGN</Flap>
          <span className="text-[10px] uppercase tracking-[0.18em] opacity-70">in</span>
          <Flap>RAIL</Flap>
        </div>
        <p className="kicker mt-6">Boarding pass</p>
        <h1 className="serif mt-2 text-4xl">Sign in</h1>
        <div className="mt-5">
          <RouteRibbon origin="BOS" destination="NYP" compact />
        </div>
        <p className="mt-2 text-ink-soft">
          {local
            ? "Local mode: enter any email to continue. No password."
            : "Email only. No password. No reservation number."}
        </p>
        <form onSubmit={sendLink} className="ticket mt-8 space-y-4 p-5">
          <label className="block text-sm">
            Email
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="field"
              placeholder="you@email.com"
            />
          </label>
          <button disabled={sending} className="btn btn-primary w-full py-3">
            {sending ? "Continuing…" : local ? "Continue" : "Send magic link"}
          </button>
        </form>
        {sent ? (
          <form onSubmit={verifyCode} className="ticket mt-6 space-y-3 p-5">
            <label className="block text-sm">
              One-time code
              <input
                ref={codeRef}
                value={code}
                inputMode="numeric"
                autoComplete="one-time-code"
                onChange={(event) => setCode(event.target.value)}
                className="field"
                placeholder="123456"
              />
            </label>
            <button disabled={verifying} className="btn btn-ghost w-full py-3">
              {verifying ? "Verifying…" : "Verify code"}
            </button>
          </form>
        ) : null}
        {message ? (
          <p className="mt-4 text-sm text-ink-soft" role="status">
            {message}
          </p>
        ) : null}
      </main>
    </PageFrame>
  );
}
