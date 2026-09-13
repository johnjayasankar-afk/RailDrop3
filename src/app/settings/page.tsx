import { redirect } from "next/navigation";
import { PageFrame } from "@/components/page-frame";
import { getSessionUser, guestEntryHref } from "@/lib/auth/session";
import { getConfig } from "@/lib/config";
import { getRepository } from "@/lib/services";
import { fareProviderStatus } from "@/lib/providers/create-provider";
import { ConnectLiveFares } from "@/components/connect-live-fares";
import { Flap } from "@/components/flap";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect(guestEntryHref("/settings"));
  const config = getConfig();
  const usage = await getRepository().getUsage(new Date().toISOString().slice(0, 10));
  const provider = fareProviderStatus();
  const projected = (usage?.credits ?? 0) * 30;
  const overBudget = projected > config.providerMonthlyCreditBudget;

  return (
    <PageFrame email={user.email} isGuest={Boolean(user.isGuest)}>
      <main id="main" className="mx-auto max-w-2xl px-4 py-8">
        <div className="depart-strip">
          <Flap>SET</Flap>
          <span className="depart-strip-rule" aria-hidden />
          <Flap>FARES</Flap>
        </div>
        <h1 className="serif mt-6 text-4xl">Settings</h1>
        <p className="mt-2 text-ink-soft">
          {user.isGuest
            ? "Guest session — sign in only if you want an account. Alerts use the email on each watch."
            : user.email}
        </p>
        {user.isGuest ? (
          <p className="mt-4 text-sm">
            <Link href="/login" className="text-ink underline">
              Sign in with email
            </Link>{" "}
            (optional)
          </p>
        ) : null}
        {config.isLocal ? <ConnectLiveFares live={Boolean(config.parseApiKey)} /> : null}
        <section className="panel mt-8 p-5 text-sm">
          <h2 className="text-xs uppercase tracking-[0.16em] text-ink-soft">Provider usage</h2>
          <dl className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-ink-soft">Credits today</dt>
              <dd className="serif text-2xl">
                <Flap>{String(usage?.credits ?? 0)}</Flap>
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-ink-soft">
                Successful searches
              </dt>
              <dd className="serif text-2xl">
                <Flap>{String(usage?.successes ?? 0)}</Flap>
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-ink-soft">Failed searches</dt>
              <dd className="serif text-2xl">
                <Flap>{String(usage?.failures ?? 0)}</Flap>
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-ink-soft">Monthly budget</dt>
              <dd className="serif text-2xl">
                <Flap>{String(config.providerMonthlyCreditBudget)}</Flap>
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-ink-soft">
            Credits per search: {config.providerCreditsPerSearch}
          </p>
          {overBudget ? (
            <p className="mt-3 text-drop">
              Projected monthly usage may exceed the configured budget.
            </p>
          ) : (
            <p className="mt-3 text-ink-soft">Projected usage is inside the configured budget.</p>
          )}
          <p className="mt-2 text-ink-soft">{provider.message}</p>
        </section>
        <section className="panel mt-6 p-5 text-sm">
          <h2 className="text-xs uppercase tracking-[0.16em] text-ink-soft">Keyboard</h2>
          <ul className="mt-3 space-y-2 text-ink-soft">
            <li>
              <kbd>C</kbd> recheck live fares
            </li>
            <li>
              <kbd>J</kbd> / <kbd>K</kbd> walk trains · <kbd>Enter</kbd> open Amtrak
            </li>
            <li>
              <kbd>H</kbd> hide a train this visit · <kbd>U</kbd> undo
            </li>
            <li>
              <kbd>Y</kbd> copy you vs this · <kbd>W</kbd> copy the window · <kbd>F</kbd> copy
              Amtrak fields
            </li>
            <li>
              <kbd>R</kbd> jump to I rebooked
            </li>
            <li>
              <kbd>Z</kbd> zen · <kbd>G</kbd> jump to timetable · <kbd>Esc</kbd> clear filters
            </li>
          </ul>
        </section>
        <section className="panel mt-6 p-5 text-sm text-ink-soft">
          <h2 className="text-xs uppercase tracking-[0.16em] text-ink">Honest limits</h2>
          <p className="mt-3">
            Listed fares come from live inventory. Confirm on Amtrak before you change a ticket. We
            never invent a fare or change fee.
          </p>
        </section>
      </main>
    </PageFrame>
  );
}
