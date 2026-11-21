import { redirect } from 'next/navigation';
import { database, supabaseConfig } from '@/lib/supabase';
import { encryptionKey, providerIds, providers, readAiSettings } from '@/lib/ai-settings';
import { WorkspaceHeader } from '../workspace-header';
import { SettingsForm } from './settings-form';

export const metadata = { title: 'AI 设置' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  if (!supabaseConfig()) redirect('/login');
  const db = await database();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect('/login');
  const { settings, error } = await readAiSettings(db, user.id);
  return <>
    <WorkspaceHeader active="settings"/>
    <main className="frame network-page">
      <header className="network-heading"><h1>AI 设置</h1></header>
      {error ? <p className="error" role="alert">暂时无法读取 AI 设置。请确认数据库已执行 002 迁移。</p> :
        <SettingsForm initialProvider={settings?.provider ?? 'openai'} initialModel={settings?.model ?? ''}
          canEncrypt={Boolean(encryptionKey())} options={providerIds.map(id => ({
            id, name: providers[id].name, model: process.env[providers[id].modelEnv] || providers[id].model,
            saved: Boolean(settings?.[`${id}_key`]), deploymentKey: Boolean(process.env[providers[id].keyEnv]),
          }))}/>}
    </main>
  </>;
}
