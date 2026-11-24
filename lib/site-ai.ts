import { serviceDatabase } from './supabase';
import { resolveAi, type AiSettings } from './ai-settings';
import {resolveCapabilities,type CapabilitySettings} from './capability-services';

export async function readSiteAiSettings(db: NonNullable<ReturnType<typeof serviceDatabase>>) {
  const { data, error } = await db.from('site_ai_settings')
    .select('provider,model,openai_key,kimi_key,deepseek_key').eq('id', true).maybeSingle();
  return { settings: data as AiSettings | null, error };
}

export async function siteAiConfig() {
  const db = serviceDatabase();
  if (!db) {const ai=resolveAi(null);return {...ai,...resolveCapabilities(null,ai)};}
  const { settings, error } = await readSiteAiSettings(db);
  if (error && !['PGRST205', '42P01'].includes(error.code)) throw error;
  const {data:capabilities,error:capError}=await db.from('site_capability_settings').select('*').eq('id',true).maybeSingle();
  if(capError&&!['PGRST205','42P01'].includes(capError.code))throw capError;
  const ai=resolveAi(settings);return {...ai,...resolveCapabilities(capabilities as CapabilitySettings|null,ai)};
}
