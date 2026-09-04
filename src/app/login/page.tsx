import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  // Read on the server at request time (works with Vercel Production env vars).
  // Do not rely on client-bundled process.env — Next does not expose those via getConfig().
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || null;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || null;
  const localMode =
    process.env.RAILDROP_LOCAL === "1" || process.env.NEXT_PUBLIC_RAILDROP_LOCAL === "1";

  return (
    <LoginForm
      supabaseUrl={supabaseUrl}
      supabaseAnonKey={supabaseAnonKey}
      localMode={localMode}
    />
  );
}
