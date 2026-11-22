import Link from 'next/link';
import type { database } from '@/lib/supabase';
import type { NetworkBookmark, NetworkEdge } from '@/lib/knowledge-network';
import { CheeseMark } from '../icons';
import { NetworkExplorer } from './network-explorer';

const graphLimit = 500;
const edgeBatchSize = 50;
const edgePageSize = 500;

export async function GraphView({ db, userId }: {
  db: Awaited<ReturnType<typeof database>>;
  userId: string;
}) {
  const { data, error } = await db.from('bookmarks')
    .select('id,title,original_url,final_url,platform,summary,ai_summary,tags,status')
    .eq('user_id', userId)
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .limit(graphLimit + 1);
  const bookmarks = ((data ?? []) as NetworkBookmark[]).slice(0, graphLimit);
  const batches = Array.from({ length: Math.ceil(bookmarks.length / edgeBatchSize) }, (_, index) => {
    return bookmarks.slice(index * edgeBatchSize, (index + 1) * edgeBatchSize).map(item => item.id);
  });
  const results = await Promise.all(batches.map(async ids => {
    const edges: NetworkEdge[] = [];
    for (let offset = 0; ; offset += edgePageSize) {
      const { data, error } = await db.from('bookmark_edges')
        .select('source_id,target_id,score').eq('user_id', userId).in('source_id', ids)
        .order('source_id').order('target_id').range(offset, offset + edgePageSize - 1);
      if (error) return { edges, error };
      edges.push(...((data ?? []) as NetworkEdge[]));
      if (!data || data.length < edgePageSize) return { edges, error: null };
    }
  }));
  const edges = results.flatMap(result => result.edges);

  return <>
    {error ? <p className="error" role="alert">暂时无法读取收藏，请刷新后重试。</p> :
      bookmarks.length ? <>
        {results.some(result => result.error) && <p className="error" role="alert">部分关联暂时无法加载。</p>}
        {(data?.length ?? 0) > graphLimit && <p className="network-note">当前显示最近 {graphLimit} 条收藏及它们之间的关联。</p>}
        <NetworkExplorer bookmarks={bookmarks} edges={edges}/>
      </> : <section className="empty">
        <span className="empty-icon"><CheeseMark size={34}/></span>
        <h2>你的芝士库还没有收藏</h2>
        <Link className="primary network-empty-link" href="/">去收藏链接</Link>
      </section>}
  </>;
}
