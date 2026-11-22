import { redirect } from 'next/navigation';
import { database, supabaseConfig } from '@/lib/supabase';
import { isAiAdmin } from '@/lib/ai-admin';
import { CaptureShell } from './capture-shell';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function Home({ searchParams }: {
  searchParams: Promise<{ q?: string | string[]; page?: string | string[] }>;
}) {
  if (!supabaseConfig()) redirect('/login');
  const db = await database();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect('/login');

  const { q, page } = await searchParams;
  const legacy = new URLSearchParams();
  if (typeof q === 'string' && q.trim()) legacy.set('q', q.trim().slice(0, 240));
  if (typeof page === 'string' && /^[1-9]d{0,4}$/.test(page)) legacy.set('page', page);
  if (legacy.size) redirect('/network?' + legacy.toString());
  return <CaptureShell account={{ email: user.email, showAdmin: isAiAdmin(user.id) }}/>;
}
