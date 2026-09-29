import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSessionUser, guestEntryHref } from "@/lib/auth/session";
import { NewWatchForm } from "@/components/new-watch-form";
import { PageFrame } from "@/components/page-frame";
import { watchFormInitialFromQuery } from "@/lib/domain/watch-query";
import { localIsoDate } from "@/lib/domain/timezone";

export const metadata: Metadata = {
  title: "Watch a trip",
};

/* A static shell with the form behind a boundary.
 *
 * The heading lived inside the client form, so the only part of this route
 * that could ever be prerendered was the header and the footer. Two runtime
 * reads kept it there and both are real: the session, because the form starts
 * with your email in it, and the clock, because "today" decides which dates
 * the picker will accept. Neither decides what the page looks like. */
export default function NewWatchPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return (
    <PageFrame>
      <main id="main" className="mx-auto max-w-5xl px-4 py-8">
        <p className="kicker">New watch</p>
        <h1 className="serif mt-2 text-4xl">Watch a trip</h1>
        <p className="mt-2 max-w-2xl text-ink-soft">
          Live Amtrak inventory across your date window. Stay while the board loads.
        </p>
        <Suspense fallback={<FormSkeleton />}>
          <Form searchParams={searchParams} />
        </Suspense>
      </main>
    </PageFrame>
  );
}

async function Form({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  /* The clock is a request-time read the same way cookies() is: it produces
     different output per request, so prerendering it would bake one day's
     answer into the shell. connection() is how you say that about a value the
     framework cannot detect on its own. */
  await connection();
  const user = await getSessionUser();
  if (!user) redirect(guestEntryHref("/watches/new"));
  const query = await searchParams;
  const initial = watchFormInitialFromQuery(query, localIsoDate(new Date(), "America/New_York"));
  return <NewWatchForm email={user.email} isGuest={Boolean(user.isGuest)} initial={initial} />;
}

/** The form's own footprint, so the page does not jump when it arrives. */
function FormSkeleton() {
  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_16rem]" aria-hidden>
      <div className="space-y-8">
        <div className="panel space-y-4 p-5">
          <div className="skeleton h-4 max-w-[7rem]" />
          <div className="skeleton h-10" />
          <div className="skeleton h-10" />
        </div>
        <div className="panel space-y-4 p-5">
          <div className="skeleton h-4 max-w-[7rem]" />
          <div className="skeleton h-10 max-w-xs" />
          <div className="skeleton h-10 max-w-xs" />
        </div>
      </div>
      <div className="panel space-y-3 p-5">
        <div className="skeleton h-4 max-w-[6rem]" />
        <div className="skeleton h-4 max-w-[9rem]" />
        <div className="skeleton h-8 max-w-[7rem]" />
      </div>
    </div>
  );
}
