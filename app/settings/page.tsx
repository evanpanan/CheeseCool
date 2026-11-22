import { notFound, redirect } from 'next/navigation';
import { database, serviceDatabase, supabaseConfig } from '@/lib/supabase';
import { defaultAiProvider, encryptionKey, providerIds, providers } from '@/lib/ai-settings';
import { WorkspaceHeader } from '../workspace-header';
import { isAiAdmin } from '@/lib/ai-admin';
import { readSiteAiSettings } from '@/lib/site-ai';
import { SettingsForm } from './settings-form';

export const metadata = { title: '站点管理' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  if (!supabaseConfig()) redirect('/login');
  const db = await database();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect('/login');
  if (!isAiAdmin(user.id)) notFound();
  const service = serviceDatabase();
  const { settings, error } = service ? await readSiteAiSettings(service) : {
    settings: null, error: null,
  };
  return <>
    <WorkspaceHeader account={{ email: user.email, showAdmin: true, adminPage: true }}/>
    <main className="frame network-page">
      <header className="network-heading"><h1>站点管理</h1><p>配置对所有登录用户生效。</p></header>
      {!service ? <p>要在这里管理站点配置，请先设置服务端 Supabase 密钥。现有部署环境中的 模型配置会继续生效。</p> :
        error ? <p className="error" role="alert">暂时无法读取站点 模型配置。请确认数据库已执行 003 迁移。</p> :
        <SettingsForm initialProvider={settings?.provider ?? defaultAiProvider()} initialModel={settings?.model ?? ''}
          canEncrypt={Boolean(encryptionKey())} options={providerIds.map(id => ({
            id, name: providers[id].name, model: process.env[providers[id].modelEnv] || providers[id].model,
            saved: Boolean(settings?.[`${id}_key`]), deploymentKey: Boolean(process.env[providers[id].keyEnv]),
          }))}/>}
    </main>
  </>;
}
