import Link from 'next/link';
import { redirect } from 'next/navigation';
import { database, supabaseConfig } from '@/lib/supabase';
import { embed } from '@/lib/ai';
import { readAiSettings, resolveAi } from '@/lib/ai-settings';
import { platformNames, type Platform } from '@/lib/urls';
import { Retry } from './controls';
import { Icon } from './icons';
import { LibraryEmpty, LibraryShell } from './library-shell';

export const dynamic = 'force-dynamic';

export const maxDuration = 60;

const columns = 'id,original_url,final_url,title,platform,cover_url,summary,ai_summary,tags,status';
type Bookmark = {
  id: string; original_url: string; final_url: string | null; title: string;
  platform: Platform; cover_url: string | null; summary: string;
  ai_summary: string | null; tags: string[]; status: string;
};

function BookmarkCard({ item, related, ai, canIndex }: { item: Bookmark; related: Bookmark[]; ai: boolean; canIndex: boolean }) {
  return <article id={item.id} className="bookmark">
    {item.cover_url && <div className="cover" style={{ backgroundImage: `url(${JSON.stringify(item.cover_url)})` }}/>}
    <div className="bookmark-body">
      <span className="platform"><Icon name="link" size={14}/> {platformNames[item.platform]}</span>
      <h3><a href={item.final_url || item.original_url} target="_blank" rel="noopener noreferrer">{item.title}<Icon name="arrow" size={17}/></a></h3>
      {(item.ai_summary || item.summary) && <p>{item.ai_summary || item.summary}</p>}
      {!!item.tags.length && <ul aria-label="标签" className="tags">{item.tags.map(tag => <li key={tag}><Link href={'/?q=' + encodeURIComponent(tag)}>{tag}</Link></li>)}</ul>}
      {item.status !== 'indexed' && <div className="status-row">
        <span>{item.status === 'limited' ? '已保存链接，来源内容暂不可读' : item.status === 'extracted' ? (item.ai_summary ? (canIndex ? '待完成语义索引' : 'AI 已整理') : ai ? '待完成 AI 整理' : '已提取内容') : '已保存链接，待提取内容'}</span>
        {(item.status !== 'extracted' || (item.ai_summary ? canIndex : ai)) && <Retry id={item.id}/>}
      </div>}
      {!!related.length && <details>
        <summary>相关收藏 · {related.length}</summary>
        <ul>{related.map(other => <li key={other.id}>
          <a href={other.final_url || other.original_url} target="_blank" rel="noopener noreferrer">{other.title}</a>
        </li>)}</ul>
      </details>}
    </div>
  </article>;
}

export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string | string[]; page?: string }> }) {
  if (!supabaseConfig()) redirect('/login');
  const db = await database();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect('/login');
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q.trim().slice(0, 240) : '';
  const page = Math.max(1, Math.min(10000, Number.parseInt(params.page || '1', 10) || 1));
  const start = (page - 1) * 24;
  const { settings, error: settingsError } = await readAiSettings(db, user.id);
  let aiConfig: ReturnType<typeof resolveAi> | null = null;
  try {
    if (!settingsError || ['PGRST205', '42P01'].includes(settingsError.code)) aiConfig = resolveAi(settings, user.id);
  } catch { /* Basic collection remains available. */ }
  const ai = Boolean(aiConfig?.chat);
  const embeddingKey = aiConfig?.embeddingKey;
  let ids: string[] | undefined;
  let searchError = false;
  let vector: number[] | null = null;
  if (q) {
    vector = embeddingKey ? await embed(q, embeddingKey).catch(() => null) : null;
    const { data, error } = await db.rpc('search_bookmarks', {
      query_text: q, query_embedding: vector ? JSON.stringify(vector) : null,
    });
    searchError = !!error;
    ids = (data ?? []).map((row: { id: string }) => row.id);
  }
  const result = ids
    ? ids.length ? await db.from('bookmarks').select(columns).in('id', ids) : { data: [], error: null }
    : await db.from('bookmarks').select(columns).order('created_at', { ascending: false })
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

  return <LibraryShell query={q}>
      {q && <div className="results-heading">
        <span>{visible.length} 条搜索结果{!vector && ' · 关键词检索'}</span>
        <Link href="/">清除搜索</Link>
      </div>}
      {searchError || result.error ? <p className="error" role="alert">暂时无法读取收藏，请刷新后重试。</p> :
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
        <LibraryEmpty query={q} page={page}/>}
      {!q && (page > 1 || rows.length > 24) && <nav className="pagination" aria-label="收藏分页">
        {page > 1 && <Link href={'/?page=' + (page - 1)}>上一页</Link>}
        <span>第 {page} 页</span>
        {rows.length > 24 && page < 10000 && <Link href={'/?page=' + (page + 1)}>下一页</Link>}
      </nav>}
  </LibraryShell>;
}
