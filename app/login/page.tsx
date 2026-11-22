import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { WorkspaceHeader } from '../workspace-header';
import { LoginForm } from '../controls';
import { database, supabaseConfig } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '登录' };

export default async function LoginPage() {
  const configured = Boolean(supabaseConfig());
  if (configured) {
    const { data } = await (await database()).auth.getUser();
    if (data.user) redirect('/');
  }
  return <>
    <WorkspaceHeader/>
    <main className="frame login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <h1 id="login-title">登录</h1>
        {configured ? <LoginForm/> : <p>请先按照 README 配置 Supabase，再使用创建的私人账号登录。</p>}
      </section>
    </main>
  </>;
}
