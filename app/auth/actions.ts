'use server';
import { headers } from 'next/headers';
import { database, supabaseConfig } from '@/lib/supabase';
export type AuthState = { error?: string; ok?: boolean; redirectTo?: string };
export async function oauthSignIn(_: AuthState, form: FormData): Promise<AuthState> {
  const provider=form.get('provider');
  if(provider!=='google' && provider!=='github') return {error:'请选择 Google 或 GitHub 登录。'};
  const name=provider==='google'?'Google':'GitHub';
  if(!supabaseConfig()) return {error:`${name} 登录服务尚未配置，请稍后再试。`};
  try {
    const origin=process.env.NEXT_PUBLIC_SITE_URL || (await headers()).get('origin');
    if(!origin) return {error:'登录服务地址尚未配置。'};
    const {data,error}=await (await database()).auth.signInWithOAuth({provider,options:{
      redirectTo:new URL('/auth/callback',origin).href,
      ...(provider==='google'?{queryParams:{prompt:'select_account'}}:{}),
    }});
    if(error || !data.url) return {error:`暂时无法使用 ${name} 登录，请稍后重试。`};
    return {redirectTo:data.url};
  } catch {return {error:`暂时无法连接 ${name} 登录服务，请稍后重试。`};}
}
