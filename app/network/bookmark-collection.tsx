import Link from 'next/link';
import type { database } from '@/lib/supabase';
import { retrievalQuery } from '@/lib/knowledge-content';
import { embed } from '@/lib/ai';
import { siteAiConfig } from '@/lib/site-ai';
import { BookmarkCard, type Bookmark } from './bookmark-card';
import { EmptyState } from '../empty-state';
import { CollectionSearch } from '../collection-search';
import { RefreshCollection } from './refresh-collection';

const columns = 'id,original_url,final_url,title,platform,cover_url,summary,ai_summary,tags,status,created_at';
export async function BookmarkCollection({ db, params }: {
  db: Awaited<ReturnType<typeof database>>;
  params: { q?: string | string[]; page?: string | string[] };
}) {
  const q = typeof params.q === 'string' ? params.q.trim().slice(0, 240) : '';
  const page = Math.max(1, Math.min(10000, Number.parseInt(typeof params.page === 'string' ? params.page : '1', 10) || 1));
  const start = (page - 1) * 24;
  const aiConfig = await siteAiConfig().catch(() => null);
  const ai = Boolean(aiConfig?.chat);
  const embeddingKey = aiConfig?.embeddingKey;
  let ids: string[] | undefined;
  let searchError = false;
  let vector: number[] | null = null;
  if (q) {
    vector = embeddingKey ? await embed(q, embeddingKey).catch(() => null) : null;
    const { data, error } = await db.rpc('search_bookmarks', {
      query_text: retrievalQuery(q), query_embedding: vector ? JSON.stringify(vector) : null,
    });
    searchError = !!error;
    ids = (data ?? []).map((row: { id: string }) => row.id);
  }
  const result = ids
    ? ids.length ? await db.from('bookmarks').select(columns).is('deleted_at',null).in('id', ids) : { data: [], error: null }
    : await db.from('bookmarks').select(columns).is('deleted_at',null).order('created_at', { ascending: false })
      .order('id', { ascending: false }).range(start, start + 24);

  const rows = (result.data ?? []) as Bookmark[];
  const visible = ids ? ids.flatMap(id => rows.find(row => row.id === id) ?? []) : rows.slice(0, 24);
  const visibleIds = visible.map(row => row.id);
  const idList = visibleIds.join(',');
  const { data: edges } = visibleIds.length
    ? await db.from('bookmark_edges').select('source_id,target_id,score')
      .or(`source_id.in.(${idList}),target_id.in.(${idList})`).order('score', { ascending: false })
    : { data: null };
  const relatedIds = [...new Set((edges ?? []).flatMap(edge => [edge.source_id, edge.target_id]))]
    .filter(id => !visibleIds.includes(id));
  const { data: others } = relatedIds.length
    ? await db.from('bookmarks').select(columns).in('id', relatedIds)
    : { data: null };
  const all = new Map([...visible, ...((others ?? []) as Bookmark[])].map(item => [item.id, item]));

  const now = Date.now();
  const refreshUntil = Math.max(0, ...visible.flatMap(item => {
    if (item.status !== 'saved' && (item.status !== 'extracted' || !(item.ai_summary ? embeddingKey : ai))) return [];
    const until = Date.parse(item.created_at) + 65_000;
    return until > now ? [until] : [];
  }));

  return <section className="library" aria-labelledby="library-title">
    {refreshUntil > 0 && <RefreshCollection until={refreshUntil}/>}
    <div className="library-heading">
      <h2 id="library-title">{q ? '搜索结果' : '最近收藏'}</h2>
      <CollectionSearch key={q} initialQuery={q}/>
    </div>
    {q && <div className="results-heading">
      <span>{visible.length} 条匹配收藏</span>
      <Link href="/?view=list">查看全部</Link>
    </div>}
    {searchError || result.error ? <p className="error" role="alert">收藏暂时没能加载，请刷新后重试。</p> :
      visible.length ? <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="收藏列表">
        {visible.map(item => {
          const related = (edges ?? []).flatMap(edge => {
            const other = all.get(edge.source_id === item.id ? edge.target_id :
              edge.target_id === item.id ? edge.source_id : '');
            return other ? [other] : [];
          }).slice(0, 6);
          return <BookmarkCard key={item.id} item={item} related={related} ai={ai} canIndex={Boolean(embeddingKey)}/>;
        })}
      </section> :
      <EmptyState
        title={q ? '还没找到这条芝士' : page > 1 ? '已经翻到底了' : '好东西，从第一条开始'}
        description={q ? '试试更短的关键词，或换个说法。' : page > 1 ? '回到最近收藏，继续探索。' : '存下一个链接，摘要、标签和关联会逐渐长出来。'}
        href={q || page > 1 ? '/?view=list' : '/'}
        action={q || page > 1 ? '查看全部收藏' : '收藏第一条'}/>}

    {!q && (page > 1 || rows.length > 24) && <nav className="pagination" aria-label="收藏分页">
      {page > 1 && <Link href={'/?view=list&page=' + (page - 1)}>上一页</Link>}
      <span>第 {page} 页</span>
      {rows.length > 24 && page < 10000 && <Link href={'/?view=list&page=' + (page + 1)}>下一页</Link>}
    </nav>}
  </section>;
}
