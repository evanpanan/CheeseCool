'use client';
import { useActionState, useEffect, useState } from 'react';
import { oauthSignIn } from './client';
import { finishAuthNavigation } from '../session-motion';
import { CheeseSculpture } from './cheese-sculpture';
import { particleStory } from '@/lib/cheese-particles';
import { GenerativeText } from '../generative-text';

function GenerativeHeading({index,paused}:{index:number;paused:boolean}) {
  return <header className="auth-heading auth-generative-heading">
    <h1 aria-label="登录你的芝士库"><GenerativeText text={particleStory[index].copy} paused={paused}/></h1>
  </header>;
}
export function AuthForm({callbackError=false}:{callbackError?:boolean}) {
  const [state,action,pending]=useActionState(oauthSignIn,{});
  const [provider,setProvider]=useState<'google'|'github'>('google');
  const leaving=Boolean(state.redirectTo);
  const [story,setStory]=useState(0);
  const [recovering,setRecovering]=useState(callbackError);
  const blocked=pending || leaving || recovering;
  useEffect(()=>{if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)setStory(1);},[]);
  useEffect(()=>{
    if(pending){setRecovering(false);return;}
    if(!state.error && !callbackError)return;
    setRecovering(true);
    const timer=setTimeout(()=>setRecovering(false),1450);
    return ()=>clearTimeout(timer);
  },[state,callbackError,pending]);
  useEffect(()=>{
    const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer:ReturnType<typeof setTimeout>;
    const schedule=()=>{
      clearTimeout(timer);
      if(blocked || document.hidden || preference.matches)return;
      timer=setTimeout(()=>setStory(current=>(current+1)%particleStory.length),4200);
    };
    const motion=()=>{if(preference.matches)setStory(1);schedule();};
    schedule();document.addEventListener('visibilitychange',schedule);preference.addEventListener('change',motion);
    return ()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',schedule);preference.removeEventListener('change',motion);};
  },[story,blocked]);
  useEffect(()=>{if(state.redirectTo)void finishAuthNavigation(state.redirectTo,provider);},[state,provider]);
  return <div className="auth-fields auth-oauth-fields">
    <CheeseSculpture state={pending || leaving?'thinking':recovering?'error':'idle'} shape={particleStory[story].shape} onActivate={()=>setStory(current=>(current+1)%particleStory.length)}/>
    <GenerativeHeading index={story} paused={blocked}/>
    <div className="oauth-options">
      {(['google','github'] as const).map(value=><form key={value} action={action} onSubmit={()=>setProvider(value)}>
        <input type="hidden" name="provider" value={value}/>
        <button className={`oauth-button oauth-${value}`} disabled={pending || leaving} aria-busy={pending && provider===value}>
          <span className="oauth-provider-icon" aria-hidden="true">{pending && provider===value?<span className="capture-progress"/>:<ProviderIcon provider={value}/>}</span>
          <span>{(pending || leaving) && provider===value?'正在连接…':`使用 ${value==='google'?'Google':'GitHub'} 继续`}</span>
        </button>
      </form>)}
    </div>
    {state.error && <p className="auth-notice error" role="alert">{state.error}</p>}
    {callbackError && !state.error && <p className="auth-notice error" role="alert">登录未完成，请重新选择账号登录。</p>}
  </div>;
}
function ProviderIcon({provider}:{provider:'google'|'github'}) {
  return provider==='google'?<svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.6a4.8 4.8 0 0 1-2.1 3.2v2.6h3.4C20.8 18.1 22 15.4 22 12.2Z"/><path fill="#34A853" d="M12 22c2.8 0 5.2-.9 6.9-2.5l-3.4-2.6c-.9.6-2.1 1-3.5 1-2.7 0-5-1.8-5.8-4.2H2.7v2.7A10.4 10.4 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.2 13.7a6.3 6.3 0 0 1 0-3.4V7.6H2.7a10.4 10.4 0 0 0 0 8.8Z"/><path fill="#EA4335" d="M12 6.1c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 12 2a10.4 10.4 0 0 0-9.3 5.6l3.5 2.7C7 7.9 9.3 6.1 12 6.1Z"/></svg>:<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .8a11.2 11.2 0 0 0-3.54 21.83c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.68.08-.68 1.13.08 1.73 1.16 1.73 1.16 1 1.72 2.63 1.22 3.27.93.1-.73.39-1.22.71-1.5-2.5-.28-5.13-1.25-5.13-5.57 0-1.23.44-2.23 1.15-3.01-.12-.29-.5-1.43.11-2.97 0 0 .94-.3 3.08 1.15A10.7 10.7 0 0 1 12 6.14c.95 0 1.9.13 2.8.38 2.14-1.45 3.08-1.15 3.08-1.15.61 1.54.23 2.68.11 2.97.72.78 1.15 1.78 1.15 3.01 0 4.33-2.63 5.29-5.14 5.57.4.35.76 1.03.76 2.08v3.09c0 .3.2.65.78.54A11.2 11.2 0 0 0 12 .8Z"/></svg>;
}
