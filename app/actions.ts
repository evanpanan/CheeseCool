'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { database } from '@/lib/supabase';
import { canonical, identify, pastedUrl } from '@/lib/urls';
import { embed } from '@/lib/ai';
import { siteAiConfig } from '@/lib/site-ai';

type State = { error?: string; ok?: boolean };
type CaptureState = State & { duplicate?: boolean; id?: string };
import { processBookmark } from '@/lib/bookmark-processing';

async function authenticated() {
  const db = await database();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect('/login');
  return db;
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
