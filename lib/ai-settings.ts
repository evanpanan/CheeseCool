import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { database } from './supabase';

export const providers = {
  openai: { name: 'OpenAI', endpoint: 'https://api.openai.com/v1/', model: 'gpt-4o-mini', keyEnv: 'OPENAI_API_KEY', modelEnv: 'OPENAI_CHAT_MODEL' },
  kimi: { name: 'Kimi', endpoint: 'https://api.moonshot.cn/v1/', model: 'kimi-k2.5', keyEnv: 'KIMI_API_KEY', modelEnv: 'KIMI_CHAT_MODEL' },
  deepseek: { name: 'DeepSeek', endpoint: 'https://api.deepseek.com/', model: 'deepseek-flash', keyEnv: 'DEEPSEEK_API_KEY', modelEnv: 'DEEPSEEK_CHAT_MODEL' },
} as const;
export type Provider = keyof typeof providers;
export const providerIds = Object.keys(providers) as Provider[];
export type AiSettings = { provider: Provider; model: string | null } & Partial<Record<`${Provider}_key`, string | null>>;
export type Client = Awaited<ReturnType<typeof database>>;

export function providerId(value: unknown): value is Provider {
  return typeof value === 'string' && Object.hasOwn(providers, value);
}

export function encryptionKey() {
  const hex = process.env.AI_SETTINGS_ENCRYPTION_KEY ?? '';
  return /^[a-f\d]{64}$/i.test(hex) ? Buffer.from(hex, 'hex') : null;
}

export function encryptKey(secret: string, key: Buffer, userId: string, provider: Provider) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(userId + ':' + provider));
  const payload = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), payload]).toString('base64url');
}

function keyFor(settings: AiSettings | null, userId: string, provider: Provider) {
  const stored = settings?.[`${provider}_key`];
  if (!stored) return process.env[providers[provider].keyEnv] || null;
  const key = encryptionKey();
  if (!key) throw new Error('服务端未配置密钥加密。');
  const buffer = Buffer.from(stored, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, buffer.subarray(0, 12));
  decipher.setAAD(Buffer.from(userId + ':' + provider));
  decipher.setAuthTag(buffer.subarray(12, 28));
  return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8');
}

export async function readAiSettings(db: Client, userId: string) {
  const { data, error } = await db.from('ai_settings')
    .select('provider,model,openai_key,kimi_key,deepseek_key').eq('user_id', userId).maybeSingle();
  return { settings: data as AiSettings | null, error };
}

export function resolveAi(settings: AiSettings | null, userId: string) {
  const provider = settings?.provider ?? 'openai';
  const definition = providers[provider];
  const chatKey = keyFor(settings, userId, provider);
  return {
    chat: chatKey ? { provider, key: chatKey, model: settings?.model || process.env[definition.modelEnv] || definition.model } : null,
    embeddingKey: provider === 'openai' ? chatKey : keyFor(settings, userId, 'openai'),
  };
}
