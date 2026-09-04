import type { ReactNode } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { AppFooter } from "@/components/app-footer";

export function PageFrame({
  email,
  isGuest = false,
  children,
}: {
  email?: string | null;
  isGuest?: boolean;
  children: ReactNode;
}) {
  const active = Boolean(email) || isGuest;
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <AppHeader email={email} isGuest={isGuest} />
      <div className="flex-1">{children}</div>
      <AppFooter signedIn={active} isGuest={isGuest} />
    </div>
  );
}

export function BackLink({ children }: { children: ReactNode }) {
  return (
    <Link href="/dashboard" className="text-sm text-ink-soft hover:text-ink">
      ← {children}
    </Link>
  );
}
