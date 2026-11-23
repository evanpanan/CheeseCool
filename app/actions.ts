'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { database } from '@/lib/supabase';
import { canonical, identify, pastedUrl, webUrl } from '@/lib/urls';
import { extract } from '@/lib/extract';
import { embed, understand } from '@/lib/ai';
import { siteAiConfig } from '@/lib/site-ai';

type State = { error?: string; ok?: boolean };
type CaptureState = State & { duplicate?: boolean; id?: string };
type Client = Awaited<ReturnType<typeof database>>;

async function authenticated() {
  const db = await database();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect('/login');
  return db;
}

async function processBookmark(db: Client, id: string) {
  const { data: row, error } = await db.from('bookmarks')
    .select('id,original_url,canonical_url,title,status,content,source_hash,ai_summary,tags')
    .eq('id', id).single();
  if (!row || error) throw new Error('无法读取收藏。');
  if (row.status === 'indexed') return;
  let source = row;
  if (!source.content || !source.source_hash) {
    const url = webUrl(row.original_url);
    const { data, final_url, platform } = await extract(url);
    const key = data ? canonical(webUrl(final_url)) : row.canonical_url;
    const { data: updated, error: updateError } = await db.from('bookmarks')
      .update({ ...data, final_url, platform, canonical_url: key, status: data ? 'extracted' : 'limited' })
      .eq('id', id).in('status', ['saved', 'limited'])
      .select('id,original_url,canonical_url,title,status,content,source_hash,ai_summary,tags').maybeSingle();
    if (updateError?.code === '23505') {
      const { data: existing } = await db.from('bookmarks').select('id')
        .eq('canonical_url', key).single();
      if (existing && existing.id !== id) {
        const { error: deleteError } = await db.from('bookmarks').delete()
          .eq('id', id).in('status', ['saved', 'limited']);
        if (deleteError) throw deleteError;
        return processBookmark(db, existing.id);
      }
    }
    if (updateError) throw updateError;
    if (!updated) return;
    source = updated;
  }
  if (!source.content || !source.source_hash) return;
  const { chat, embeddingKey } = await siteAiConfig();
  let ai = source.ai_summary ? { summary: source.ai_summary, tags: source.tags as string[] } : null;
  if (!ai && chat) {
    ai = await understand(source.title, source.content, chat);
    const { data: saved, error: summaryError } = await db.from('bookmarks')
      .update({ ai_summary: ai.summary, tags: ai.tags }).eq('id', id)
      .eq('source_hash', source.source_hash).is('ai_summary', null).select('id').maybeSingle();
    if (summaryError) throw summaryError;
    if (!saved) return;
  }
  if (!ai || !embeddingKey) return;
  const embedding = await embed([source.title, ai.summary, ai.tags.join(' '), source.content.slice(0, 4500)].join('\n'), embeddingKey);
  const { error: indexError } = await db.rpc('index_bookmark', {
    bookmark_id: id,
    expected_hash: source.source_hash,
    new_summary: ai.summary,
    new_tags: ai.tags,
    new_embedding: JSON.stringify(embedding),
  });
  if (indexError) throw indexError;
}

export async function saveBookmark(_state: CaptureState, form: FormData): Promise<CaptureState> {
  const db = await authenticated();
  let url: URL;
  try { url = pastedUrl(String(form.get('url') ?? '').slice(0, 8000)); }
  catch { return { error: '这段文字里还没找到链接，请检查后再试。' }; }
  const key = canonical(url);
  const { data: inserted, error } = await db.from('bookmarks').upsert({
    original_url: url.href, canonical_url: key, platform: identify(url), title: url.hostname,
  }, { onConflict: 'user_id,canonical_url', ignoreDuplicates: true }).select('id').maybeSingle();
  if (error) return { error: '暂时无法保存，请重试。' };

  let id = inserted?.id;
  if (!id) {
    const { data: existing } = await db.from('bookmarks').select('id').eq('canonical_url', key).maybeSingle();
    if (!existing) return { error: '暂时无法确认收藏，请重试。' };
    id = existing.id;
  }
  const bookmarkId = id;
  after(async () => {
    try {
      await processBookmark(db, bookmarkId);
    } catch {
      // The saved bookmark stays in the library and can be retried there.
    }
  });
  revalidatePath('/');
  revalidatePath('/network');
  return { ok: true, duplicate: !inserted, id: bookmarkId };
}

export async function retryBookmark(_state: State, form: FormData): Promise<State> {
  const db = await authenticated();
  try {
    await processBookmark(db, String(form.get('id') ?? ''));
    revalidatePath('/');
    revalidatePath('/network');
    return { ok: true };
  } catch {
    return { error: '处理失败，请稍后重试。' };
  }
}

export type WorkspaceResult = {
  kind?: 'save' | 'search';
  ok?: boolean;
  id?: string;
  duplicate?: boolean;
  error?: string;
  query?: string;
  searchMode?: 'semantic' | 'keyword';
  bookmarks?: import('@/lib/knowledge-network').NetworkBookmark[];
  edges?: import('@/lib/knowledge-network').NetworkEdge[];
};

export async function submitWorkspace(_state: WorkspaceResult, form: FormData): Promise<WorkspaceResult> {
  const { workspaceIntent } = await import('@/lib/workspace-input');
  const intent = workspaceIntent(String(form.get('url') ?? '').slice(0, 8000));
  if (intent.kind === 'save') {
    const capture = new FormData();
    capture.set('url', intent.value);
    return { ...await saveBookmark({}, capture), kind: 'save' };
  }
  const query = intent.value;
  if (!query || query.length > 240) return { kind: 'search', error: '搜索内容请控制在 240 字以内。' };
  const db = await authenticated();
  const config = await siteAiConfig().catch(() => null);
  const vector = config?.embeddingKey ? await embed(query, config.embeddingKey).catch(() => null) : null;
  const { data, error } = await db.rpc('search_bookmarks', {
    query_text: query, query_embedding: vector ? JSON.stringify(vector) : null,
  });
  if (error) return { kind: 'search', error: '这次没能完成搜索，请稍后再试。' };
  const ids = (data ?? []).map((item: { id: string }) => item.id);
  if (!ids.length) return { kind: 'search', ok: true, query, searchMode: vector ? 'semantic' : 'keyword', bookmarks: [], edges: [] };
  const { data: rows, error: readError } = await db.from('bookmarks')
    .select('id,title,original_url,final_url,platform,summary,ai_summary,tags,status').in('id', ids);
  if (readError) return { kind: 'search', error: '搜索结果暂时没能加载，请再试一次。' };
  const bookmarks = ids.flatMap((id: string) => (rows ?? []).find(item => item.id === id) ?? []);
  const edges: import('@/lib/knowledge-network').NetworkEdge[] = [];
  const idList = ids.join(',');
  for (let offset = 0; ; offset += 500) {
    const { data: links, error: edgeError } = await db.from('bookmark_edges')
      .select('source_id,target_id,score')
      .or(`source_id.in.(${idList}),target_id.in.(${idList})`)
      .order('source_id').order('target_id').range(offset, offset + 499);
    if (edgeError) return { kind: 'search', error: '关联暂时没能加载，请再试一次。' };
    edges.push(...(links ?? []));
    if (!links || links.length < 500) break;
  }
  return { kind: 'search', ok: true, query, searchMode: vector ? 'semantic' : 'keyword', bookmarks, edges };
}
