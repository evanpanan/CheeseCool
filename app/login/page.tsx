import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Brand, CheeseMark } from '../icons';
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
  return <main className="login-page">
    <Brand/>
    <div className="login-hero">
      <div className="hero-mark"><CheeseMark size={70}/></div>
      <h1 lang="en">Save the <em>cool</em> stuff.</h1>
      <p>把好东西都存起来。</p>
    </div>
    <section className="login-panel" aria-labelledby="login-title">
      <h2 id="login-title">登录私人收藏库</h2>
      {configured ? <LoginForm/> : <p>请先按照 README 配置 Supabase，再使用创建的私人账号登录。</p>}
    </section>
  </main>;
}
