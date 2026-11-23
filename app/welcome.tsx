'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Brand, CheeseMark } from './icons';
import { AiSignal } from './ai-signal';
import { ThemeSwitch } from './theme-switch';
import { AuthForm } from './auth/auth-form';
import './welcome.css';
export function WelcomeHeader({login=false}:{login?:boolean}) {
  return <header className="welcome-header"><Link href="/" aria-label="CheeseCool 首页"><Brand/></Link><nav><ThemeSwitch/><Link className="welcome-nav-link" href={login?'/':'/login'}>{login?'返回首页':'登录'}</Link></nav></header>;
}
const stages=[{title:'存下心动的瞬间',desc:'文章、视频、工具。一个链接，就能收藏。'},{title:'让 AI 帮你理清思路',desc:'提取摘要与主题，让每份收藏都有迹可循。'},{title:'看见灵感之间的联系',desc:'从一个想法出发，在芝士库里遇见更多可能。'}];
export function ProductDemo({compact=false}:{compact?:boolean}) {
  const [stage,setStage]=useState(0); const [playing,setPlaying]=useState(true);
  const [selected,setSelected]=useState('AI Agent');
  useEffect(()=>{
    if(!playing || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer=setInterval(()=>setStage(value=>(value+1)%3),4200); return ()=>clearInterval(timer);
  },[playing]);
  return <section className={`product-demo ${compact?'compact':''}`} aria-label="CheeseCool 产品演示">
    <div className="demo-chrome"><span><AiSignal size={18} state={stage===0?'idle':stage===1?'thinking':'connected'}/>我的芝士库</span><button onClick={()=>setPlaying(!playing)} aria-label={playing?'暂停产品演示':'播放产品演示'}>{playing?'Ⅱ':'▷'}</button></div>
    <div className="demo-scene" data-stage={stage}>
      <div className="demo-grid"/>
      <div className="demo-capture"><span className="demo-source"><CheeseMark size={28}/></span><div><small>刚发现一个好东西</small><strong>让 AI 成为你的第二大脑</strong><span>article.design / ideas</span></div><b>＋</b></div>
      <div className="demo-summary"><span className="demo-ai-caption"><AiSignal state="thinking" size={17}/>AI 整理</span><strong>把收藏，变成自己的知识。</strong><p>用智能体连接信息、记忆与行动，让每次阅读都有新的收获。</p><div><i>人工智能</i><i>知识管理</i></div></div>
      <svg className="demo-edges" viewBox="0 0 600 420" aria-hidden="true"><path d="M300 200 120 120 180 310 300 200 455 100 490 290 300 200 320 345 490 290M120 120 455 100M180 310 320 345"/></svg>
      <div className="demo-network">{['AI Agent','灵感捕捉','第二大脑','知识管理','设计思维','自动化'].map((name,index)=><button key={name} className={`demo-node node-${index} ${selected===name?'selected':''}`} onClick={()=>{setSelected(name);setPlaying(false);setStage(2);}}><span><CheeseMark size={index===0?40:25}/></span><b>{name}</b></button>)}</div>
      <div className="demo-selected">↳ {selected} <span>发现新的关联</span></div>
    </div>
    <div className="demo-timeline">{stages.map((item,index)=><button key={item.title} onClick={()=>{setStage(index);setPlaying(false);}} aria-pressed={stage===index}><span>0{index+1}</span>{['收藏','整理','连接'][index]}<i/></button>)}</div>
    <div className="demo-caption" aria-live="off"><strong>{stages[stage].title}</strong><p>{stages[stage].desc}</p></div>
  </section>;
}
export function WelcomePage({demoHref='/login'}:{demoHref?:string}) {
  return <div className="welcome-page"><WelcomeHeader/><main className="welcome-main">
    <section className="welcome-copy"><div className="welcome-eyebrow"><span/> 给每一个灵感，一个去处</div><h1>把好东西<br/>都<span>存起来。</span><svg viewBox="0 0 280 18" aria-hidden="true"><path d="M3 12Q140-4 276 9"/></svg></h1><p>别让喜欢，只停留在收藏。<br/>存下链接，让 AI 整理，让灵感彼此相连。</p><div className="welcome-cta"><Link className="welcome-primary" href="/login">开始我的芝士库</Link><a href="#how-it-works" onClick={e=>{e.preventDefault();document.getElementById('how-it-works')?.scrollIntoView({behavior:'smooth',block:'center'});}}>看看它如何工作 <span>↓</span></a></div><div className="welcome-benefits"><span>随手收藏</span><span>✦ 智能整理</span><span>⌘ 发现关联</span></div></section>
    <div id="how-it-works" className="welcome-showcase"><div className="showcase-label">从一个链接，到一整个灵感世界 <span>INTERACTIVE DEMO</span></div><ProductDemo/>{demoHref!='/login' && <Link className="demo-enter" href={demoHref}>直接探索演示芝士库</Link>}</div>
    </main><footer className="welcome-footer"><span>为好奇心留一点空间。</span><span>CheeseCool · 把好东西都存起来</span></footer></div>;
}
export function AuthPage({callbackError=false}:{callbackError?:boolean}) {
  return <div className="welcome-page auth-page"><WelcomeHeader login/><main className="auth-layout"><section className="auth-card" aria-label="登录芝士库"><AuthForm callbackError={callbackError}/></section></main></div>;
}
