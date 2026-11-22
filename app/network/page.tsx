import Link from 'next/link';
import { redirect } from 'next/navigation';
import { database, supabaseConfig } from '@/lib/supabase';
import { isAiAdmin } from '@/lib/ai-admin';
import { WorkspaceHeader } from '../workspace-header';
import { NetworkHeading } from './network-heading';
import { BookmarkCollection } from './bookmark-collection';
import { GraphView } from './graph-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: '芝士库' };
export const maxDuration = 60;

export default async function NetworkPage({ searchParams }: {
  searchParams: Promise<{ view?: string | string[]; q?: string | string[]; page?: string | string[] }>;
}) {
  if (!supabaseConfig()) redirect('/login');
  const db = await database();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect('/login');
  const params = await searchParams;
  const showGraph = params.view === 'graph';
  return <>
    <WorkspaceHeader active="library" account={{ email: user.email, showAdmin: isAiAdmin(user.id) }}/>
    <main>
      <div className={showGraph ? 'network-page constellation-page library-view' : 'frame library-view'}>
        <div className="library-view-header">
          <NetworkHeading/>
          <nav className="library-views" aria-label="芝士库视图">
            <Link href="/network" aria-current={!showGraph ? 'page' : undefined}>列表</Link>
            <Link href="/network?view=graph" aria-current={showGraph ? 'page' : undefined}>图谱</Link>
          </nav>
        </div>
        {showGraph ? <GraphView db={db} userId={user.id}/> : <BookmarkCollection db={db} params={params}/>}

      </div>
    </main>
  </>;
}
