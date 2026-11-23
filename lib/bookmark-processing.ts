import type { database } from './supabase';
import { canonical, webUrl } from './urls';
import { embed, understand } from './ai';
import { siteAiConfig } from './site-ai';
type Client = Awaited<ReturnType<typeof database>>;

export async function processBookmark(db: Client, id: string) {
  const { data: row, error } = await db.from('bookmarks')
    .select('id,original_url,canonical_url,title,status,content,source_hash,ai_summary,tags')
    .eq('id', id).single();
  if (!row || error) throw new Error('无法读取收藏。');
  if (row.status === 'indexed') return;
  let source = row;
  if (!source.content || !source.source_hash) {
    const url = webUrl(row.original_url);
    const { extract } = await import('@/lib/extract');
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

