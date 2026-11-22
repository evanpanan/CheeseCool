import { serviceDatabase } from './supabase';
import { resolveAi, type AiSettings } from './ai-settings';

export async function readSiteAiSettings(db: NonNullable<ReturnType<typeof serviceDatabase>>) {
  const { data, error } = await db.from('site_ai_settings')
    .select('provider,model,openai_key,kimi_key,deepseek_key').eq('id', true).maybeSingle();
  return { settings: data as AiSettings | null, error };
}

export async function siteAiConfig() {
  const db = serviceDatabase();
  if (!db) return resolveAi(null);
  const { settings, error } = await readSiteAiSettings(db);
  if (error && !['PGRST205', '42P01'].includes(error.code)) throw error;
  return resolveAi(settings);
}
