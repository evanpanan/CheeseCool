'use client';
import Link from 'next/link';
import { useTransition } from 'react';
import { AiSignal } from './ai-signal';
import { BrandLoader } from './brand-loader';
export default function ErrorPage({reset}:{error:Error & {digest?:string};reset:()=>void}) {
  const [pending,startTransition]=useTransition();
  return <main className="app-state">{pending?<BrandLoader/>:<AiSignal state="error" size={64}/>}<h1>这次，没能顺利加载。</h1><p>可以重新加载，或返回首页继续。</p><div className="app-state-actions"><button className="primary" disabled={pending} onClick={()=>startTransition(reset)}>{pending?'正在重试…':'重新加载'}</button><Link href="/">返回首页</Link></div></main>;
}
