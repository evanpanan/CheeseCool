import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthPage } from '../welcome';
import { database, supabaseConfig } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '登录', robots:{index:false,follow:false} };

export default async function LoginPage({searchParams}: {searchParams: Promise<{error?:string}>}) {
  if (supabaseConfig()) {
    const {data} = await (await database()).auth.getUser();
    if (data.user) redirect('/');
  }
  return <AuthPage callbackError={(await searchParams).error === 'callback'}/>;
}
