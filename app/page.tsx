import type { Metadata } from 'next';
import { WelcomePage } from './welcome';
import { database, supabaseConfig } from '@/lib/supabase';
import { isAiAdmin } from '@/lib/ai-admin';
import { CaptureShell } from './capture-shell';
import { GraphView } from './network/graph-view';

export const metadata:Metadata={alternates:{canonical:'/'}};

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function Home() {
  if (!supabaseConfig()) return <WelcomePage/>;
  const db = await database();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return <WelcomePage/>;

  return <CaptureShell account={{ email: user.email, avatarUrl: user.user_metadata?.avatar_url || user.user_metadata?.picture, displayName: user.user_metadata?.full_name || user.user_metadata?.name, showAdmin: isAiAdmin(user.id) }}>
    <GraphView db={db} userId={user.id}/>
  </CaptureShell>;
}
