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

export default async function NewWatchPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect(guestEntryHref("/watches/new"));
  const query = await searchParams;
  const initial = watchFormInitialFromQuery(query, localIsoDate(new Date(), "America/New_York"));
  return (
    <PageFrame>
      <NewWatchForm email={user.email} isGuest={Boolean(user.isGuest)} initial={initial} />
    </PageFrame>
  );
}
