import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";
import { LoadingChrome } from "@/components/loading-chrome";

export default function LoginPage() {
  // Read on the server at request time (works with Vercel Production env vars).
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || null;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || null;
  const localMode =
    process.env.RAILDROP_LOCAL === "1" || process.env.NEXT_PUBLIC_RAILDROP_LOCAL === "1";

  return (
    <Suspense
      fallback={
        <LoadingChrome>
          <main id="main" className="mx-auto max-w-md px-4 py-16">
            <div className="skeleton h-8 w-40" />
            <div className="skeleton mt-6 h-10 w-48" />
            <div className="skeleton mt-8 h-40" />
          </main>
        </LoadingChrome>
      }
    >
      <LoginForm
        supabaseUrl={supabaseUrl}
        supabaseAnonKey={supabaseAnonKey}
        localMode={localMode}
      />
    </Suspense>
  );
}
