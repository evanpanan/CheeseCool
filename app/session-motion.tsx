'use client';
import { useEffect, useState } from 'react';
import { BrandLoader } from './brand-loader';

const eventName = 'cheesecool:session-motion';
const arrivalKey = 'cheesecool:session-arrival';
type Journey = 'login' | 'logout' | 'google' | 'github';

/** Call only after the server confirms authentication or sign-out succeeded. */
export async function finishAuthNavigation(destination: string, journey: Journey) {
  window.dispatchEvent(new CustomEvent(eventName, {detail: journey}));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  await new Promise(resolve => window.setTimeout(resolve, reduced ? 0 : 520));
  try { sessionStorage.setItem(arrivalKey, journey); } catch { /* Navigation still works without storage. */ }
  window.location.assign(destination);
}

export function SessionMotion() {
  const [motion, setMotion] = useState<{journey: Journey; arriving: boolean; confirmed: boolean} | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const play = (event: Event) => setMotion({journey:(event as CustomEvent<Journey>).detail, arriving:false,confirmed:false});
    window.addEventListener(eventName, play);
    try {
      const callbackArrival=document.cookie.split('; ').some(value=>value==='cheesecool-auth-arrival=login');
      if(callbackArrival) document.cookie='cheesecool-auth-arrival=; Max-Age=0; Path=/; SameSite=Lax';
      const arrival = callbackArrival?'login':sessionStorage.getItem(arrivalKey);
      sessionStorage.removeItem(arrivalKey);
      if ((arrival === 'login' || arrival === 'logout' || arrival === 'google' || arrival === 'github') && !new URLSearchParams(location.search).has('error')) {
        setMotion({journey:arrival, arriving:true,confirmed:callbackArrival});
        timer=setTimeout(()=>setMotion(null),callbackArrival?1800:650);
      }
    } catch { /* No animation is required to use the account. */ }
    return () => { window.removeEventListener(eventName,play); clearTimeout(timer); };
  },[]);
  return motion && <div className={`session-motion ${motion.arriving?'is-arriving':'is-leaving'} ${motion.confirmed?'is-confirmed':''}`} role="status" aria-live="polite">
    <div className="session-motion-symbol" aria-hidden="true"><BrandLoader complete={motion.confirmed}/></div>
    <span>{motion.journey==='logout'?'下次灵感见。':(motion.journey==='google' || motion.journey==='github') && !motion.arriving?`正在前往 ${motion.journey==='google'?'Google':'GitHub'}`:'灵感，已就位。'}</span>
  </div>;
}
