"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { PageFrame } from "@/components/page-frame";
import { RouteRibbon } from "@/components/route-ribbon";
import { Flap } from "@/components/flap";

export function LoginForm({
  supabaseUrl,
  supabaseAnonKey,
  localMode,
}: {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  localMode: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"status" | "alert">("status");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const remembered = window.localStorage.getItem("raildrop.email");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- remember email without hydrating from localStorage on the server
    if (remembered) setEmail(remembered);
  }, []);

  useEffect(() => {
    const err = searchParams.get("error");
    if (err) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- surface callback failures
      setMessageTone("alert");
      setMessage(err === "missing_code" ? "Sign-in link was incomplete. Request a new one." : err);
    }
  }, [searchParams]);

  useEffect(() => {
    if (sent && showCode) codeRef.current?.focus();
  }, [sent, showCode]);

  function client() {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Supabase is not configured");
    }
    return createBrowserClient(supabaseUrl, supabaseAnonKey);
  }

  async function sendLink(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setMessage(null);
    setMessageTone("status");
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
      const supabase = client();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/api/auth/callback` },
      });
      if (error) throw error;
      setSent(true);
      setShowCode(false);
      setMessageTone("status");
      setMessage("Check your email and open the sign-in link. Most people won’t get a separate code.");
    } catch (error) {
      setMessageTone("alert");
      setMessage(error instanceof Error ? error.message : "Could not start sign-in");
    } finally {
      setSending(false);
    }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    setVerifying(true);
    setMessage(null);
    setMessageTone("status");
    try {
      const supabase = client();
      const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
      if (error) throw error;
      router.push("/dashboard");
    } catch (error) {
      setMessageTone("alert");
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
          {localMode
            ? "Local mode: enter any email to continue, or skip."
            : "Optional. Sign in for an account — or skip and watch prices without one."}
        </p>
        {!supabaseUrl || !supabaseAnonKey ? (
          <p className="mt-4 text-sm text-danger" role="alert">
            Supabase keys are missing on this deploy. You can still{" "}
            <a href="/api/auth/guest?next=%2Fwatches%2Fnew" className="underline">
              watch a trip as a guest
            </a>
            .
          </p>
        ) : null}
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
            {sending ? "Continuing…" : localMode ? "Continue" : "Send magic link"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm">
          <a href="/api/auth/guest?next=%2Fwatches%2Fnew" className="text-ink underline">
            Skip — watch a trip without signing in
          </a>
        </p>
        {sent ? (
          <div className="ticket mt-6 space-y-3 p-5">
            <p className="text-sm text-ink-soft">
              Link sent. Open it from your inbox to finish signing in.
            </p>
            {!showCode ? (
              <button
                type="button"
                className="btn btn-ghost w-full py-3"
                onClick={() => setShowCode(true)}
              >
                Have a one-time code?
              </button>
            ) : (
              <form onSubmit={verifyCode} className="space-y-3">
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
            )}
          </div>
        ) : null}
        {message ? (
          <p
            className={`mt-4 text-sm ${messageTone === "alert" ? "text-danger" : "text-ink-soft"}`}
            role={messageTone === "alert" ? "alert" : "status"}
          >
            {message}
          </p>
        ) : null}
      </main>
    </PageFrame>
  );
}
