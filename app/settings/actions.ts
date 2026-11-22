'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { database, serviceDatabase, supabaseConfig } from '@/lib/supabase';
import { encryptionKey, encryptKey, providerId, providerIds, type AiSettings } from '@/lib/ai-settings';

import { isAiAdmin } from '@/lib/ai-admin';

type SettingsState = { message?: string; error?: boolean };

export async function saveAiSettings(_state: SettingsState, form: FormData): Promise<SettingsState> {
  if (!supabaseConfig()) redirect('/login');
  const db = await database();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect('/login');
  if (!isAiAdmin(user.id)) return { error: true, message: '仅站点管理员可以保存 模型配置。' };
  const service = serviceDatabase();
  if (!service) return { error: true, message: '请先设置服务端 Supabase 密钥。' };
  const provider = form.get('provider');
  const model = String(form.get('model') ?? '').trim();
  if (!providerId(provider) || (model && !/^[\w.:/-]{1,100}$/.test(model))) {
    return { error: true, message: '请选择服务商并检查模型名称。' };
  }
  const encryption = encryptionKey();
  const values: AiSettings & { id: true } = { id: true, provider, model: model || null };
  for (const id of providerIds) {
    const secret = String(form.get(id + '_key') ?? '').trim();
    if (secret) {
      if (!encryption || secret.length > 512 || /\s/.test(secret)) {
        return { error: true, message: '密钥无效，或服务端还未配置密钥加密。' };
      }
      values[`${id}_key`] = encryptKey(secret, encryption, id);
    } else if (form.get(id + '_remove') === 'on') {
      values[`${id}_key`] = null;
    }
  }
  const { error } = await service.from('site_ai_settings').upsert(values, { onConflict: 'id', defaultToNull: false });
  if (error) return { error: true, message: '保存失败，请确认已执行 站点配置数据库迁移。' };
  revalidatePath('/settings');
  revalidatePath('/network');
  return { message: '站点 模型配置已保存。' };
}
