import { siteAiConfig } from '@/lib/site-ai';
import type { database } from '@/lib/supabase';
import type { NetworkBookmark, NetworkEdge } from '@/lib/knowledge-network';
import { RefreshCollection } from './refresh-collection';
import { NetworkExplorer } from './network-explorer';

const graphLimit = 500;
const edgeBatchSize = 50;
const edgePageSize = 500;

export async function GraphView({ db, userId }: {
  db: Awaited<ReturnType<typeof database>>;
  userId: string;
}) {
  const { data, error } = await db.from('bookmarks')
    .select('id,title,original_url,final_url,platform,summary,ai_summary,tags,status,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .limit(graphLimit + 1);
  const bookmarks = ((data ?? []) as (NetworkBookmark & { created_at: string })[]).slice(0, graphLimit);
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
  const aiConfig = await siteAiConfig().catch(() => null);
  const relationMessage = !aiConfig?.chat
    ? '智能整理服务尚未就绪，关联分析暂不可用。'
    : !aiConfig.embeddingKey ? '当前按共同标签发现关联；语义关联服务尚未启用。' : undefined;
  const refreshUntil = Math.max(0, ...bookmarks.filter(item => item.status === 'saved' || item.status === 'extracted')
    .map(item => Date.parse(item.created_at) + 65_000));

  return <>
    {error ? <p className="error" role="alert">暂时无法读取收藏，请刷新后重试。</p> :
      <>
        {results.some(result => result.error) && <p className="error" role="alert">部分关联暂时无法加载。</p>}
        {(data?.length ?? 0) > graphLimit && <p className="network-note">当前显示最近 {graphLimit} 条收藏及它们之间的关联。</p>}
        {refreshUntil > Date.now() && <RefreshCollection until={refreshUntil}/>}
        <NetworkExplorer bookmarks={bookmarks} edges={edges} relationMessage={relationMessage}/>
      </>}
  </>;
}
