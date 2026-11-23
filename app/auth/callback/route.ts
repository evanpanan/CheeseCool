import { NextResponse, type NextRequest } from 'next/server';
import { database, supabaseConfig } from '@/lib/supabase';
import { safeAuthNext } from '@/lib/auth-redirect';
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const origin = process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin;
  if (code && supabaseConfig()) {
    try {
      const db = await database();
      const {error} = await db.auth.exchangeCodeForSession(code);
      if (!error) {
        const response=NextResponse.redirect(new URL(safeAuthNext(request.nextUrl.searchParams.get('next')), origin));
        response.cookies.set('cheesecool-auth-arrival','login',{path:'/',maxAge:30,sameSite:'lax',secure:new URL(origin).protocol==='https:'});
        return response;
      }
    } catch { /* Show a recoverable error without exposing provider details. */ }
  }
  return NextResponse.redirect(new URL('/login?error=callback',origin));
}
