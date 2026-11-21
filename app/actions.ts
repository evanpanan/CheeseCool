'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { database } from '@/lib/supabase';
import { canonical, identify, pastedUrl, webUrl } from '@/lib/urls';
import { extract } from '@/lib/extract';
import { embed, understand } from '@/lib/ai';
import { readAiSettings, resolveAi } from '@/lib/ai-settings';

type State = { error?: string; ok?: boolean };
type Client = Awaited<ReturnType<typeof database>>;

async function authenticated() {
  const db = await database();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect('/login');
  return { db, user };
}

export async function signIn(_state: State, form: FormData): Promise<State> {
  const db = await database();
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) return { error: '登录失败。请检查邮箱和密码。' };
  redirect('/');
}

export async function signOut() {
  const db = await database();
  await db.auth.signOut();
  redirect('/login');
}

async function processBookmark(db: Client, userId: string, id: string) {
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
        return processBookmark(db, userId, existing.id);
      }
    }
    if (updateError) throw updateError;
    if (!updated) return;
    source = updated;
  }
  if (!source.content || !source.source_hash) return;
  const { settings, error: settingsError } = await readAiSettings(db, userId);
  if (settingsError && !['PGRST205', '42P01'].includes(settingsError.code)) throw settingsError;
  const { chat, embeddingKey } = resolveAi(settings, userId);
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

export async function saveBookmark(_state: State, form: FormData): Promise<State> {
  const { db, user } = await authenticated();
  let url: URL;
  try { url = pastedUrl(String(form.get('url') ?? '').slice(0, 8000)); }
  catch { return { error: '请粘贴有效的 http 或 https 链接。' }; }
  const key = canonical(url);
  const { error } = await db.from('bookmarks').upsert({
    original_url: url.href, canonical_url: key, platform: identify(url), title: url.hostname,
  }, { onConflict: 'user_id,canonical_url', ignoreDuplicates: true });
  if (error) return { error: '保存失败，请稍后重试。' };
  const { data } = await db.from('bookmarks').select('id').eq('canonical_url', key).maybeSingle();
  if (data) await processBookmark(db, user.id, data.id).catch(() => undefined);
  revalidatePath('/');
  return { ok: true };
}

export async function retryBookmark(_state: State, form: FormData): Promise<State> {
  const { db, user } = await authenticated();
  try {
    await processBookmark(db, user.id, String(form.get('id') ?? ''));
    revalidatePath('/');
    return { ok: true };
  } catch {
    return { error: '处理失败，请稍后重试。' };
  }
}
