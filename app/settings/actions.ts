'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { database, supabaseConfig } from '@/lib/supabase';
import { encryptionKey, encryptKey, providerId, providerIds, type AiSettings } from '@/lib/ai-settings';

type SettingsState = { message?: string; error?: boolean };

export async function saveAiSettings(_state: SettingsState, form: FormData): Promise<SettingsState> {
  if (!supabaseConfig()) redirect('/login');
  const db = await database();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect('/login');
  const provider = form.get('provider');
  const model = String(form.get('model') ?? '').trim();
  if (!providerId(provider) || (model && !/^[\w.:/-]{1,100}$/.test(model))) {
    return { error: true, message: '请选择服务商并检查模型名称。' };
  }
  const encryption = encryptionKey();
  const values: AiSettings & { user_id: string } = { user_id: user.id, provider, model: model || null };
  for (const id of providerIds) {
    const secret = String(form.get(id + '_key') ?? '').trim();
    if (secret) {
      if (!encryption || secret.length > 512 || /\s/.test(secret)) {
        return { error: true, message: '密钥无效，或服务端还未配置密钥加密。' };
      }
      values[`${id}_key`] = encryptKey(secret, encryption, user.id, id);
    } else if (form.get(id + '_remove') === 'on') {
      values[`${id}_key`] = null;
    }
  }
  const { error } = await db.from('ai_settings').upsert(values, { onConflict: 'user_id' });
  if (error) return { error: true, message: '保存失败，请确认已执行 AI 设置数据库迁移。' };
  revalidatePath('/settings');
  revalidatePath('/');
  return { message: 'AI 设置已保存。' };
}
