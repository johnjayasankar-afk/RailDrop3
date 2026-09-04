import type { ReactNode } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { AppFooter } from "@/components/app-footer";

export function PageFrame({ email, children }: { email?: string | null; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <AppHeader email={email} />
      <div className="flex-1">{children}</div>
      <AppFooter signedIn={Boolean(email)} />
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
