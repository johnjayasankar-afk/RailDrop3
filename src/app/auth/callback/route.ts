import { NextResponse } from 'next/server';
import { requestOrigin, safeNextPath } from '@/lib/api';
import { getServerSupabase } from '@/lib/db/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const origin = requestOrigin(request);
  const code = url.searchParams.get('code');

  const next = safeNextPath(url.searchParams.get('next'), origin);

  if (code) {
    const supabase = await getServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
  }

  return NextResponse.redirect(new URL('/login?error=link', origin));
}
