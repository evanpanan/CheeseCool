'use client';
import { useEffect, useRef, useState } from 'react';
import { CheeseMark } from './icons';
import { brandParticleSpread } from '@/lib/brand-particle-motion';

type Grain={x:number;y:number;sx:number;sy:number;color:string};
export function BrandLoader({complete=false}:{complete?:boolean}) {
  const canvas=useRef<HTMLCanvasElement>(null);
  const [ready,setReady]=useState(false);
  useEffect(()=>{
    const surface=canvas.current,context=surface?.getContext('2d');
    if(!surface || !context)return;
    const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
    let disposed=false,frame=0,last=0,elapsed=0,grains:Grain[]=[];
    const image=new Image();
    const size=()=>{
      const ratio=Math.min(window.devicePixelRatio||1,2);
      surface.width=120*ratio;surface.height=120*ratio;context.setTransform(ratio,0,0,ratio,0,0);
    };
    const draw=(time:number)=>{
      frame=0;
      if(disposed || document.hidden || preference.matches || !grains.length)return;
      if(last)elapsed+=Math.min(50,time-last);last=time;
      context.clearRect(0,0,120,120);
      grains.forEach((grain,index)=>{
        const spread=complete?0:brandParticleSpread(elapsed-index*.4);
        const wobble=spread*Math.sin(elapsed*.0018+index)*1.1;
        context.globalAlpha=.42+.58*(1-spread);
        context.fillStyle=grain.color;
        context.beginPath();context.arc(grain.x+(grain.sx-grain.x)*spread+wobble,grain.y+(grain.sy-grain.y)*spread,.85+.22*(1-spread),0,Math.PI*2);context.fill();
      });
      context.globalAlpha=1;
      surface.dataset.assembly=(complete?1:1-brandParticleSpread(elapsed)).toFixed(2);
      if(!complete)frame=requestAnimationFrame(draw);
    };
    const sync=()=>{
      cancelAnimationFrame(frame);frame=0;last=0;
      const usable=!preference.matches && Boolean(grains.length);
      setReady(usable);
      if(usable && !document.hidden)frame=requestAnimationFrame(draw);
    };
    size();
    image.onload=()=>{
      if(disposed)return;
      try {
        const sample=document.createElement('canvas');sample.width=96;sample.height=88;
        const sampleContext=sample.getContext('2d');if(!sampleContext)return;
        sampleContext.drawImage(image,0,0,96,88);
        const pixels=sampleContext.getImageData(0,0,96,88).data;
        for(let y=0;y<88;y+=3)for(let x=0;x<96;x+=3){
          const offset=(y*96+x)*4;if(pixels[offset+3]<100)continue;
          const index=grains.length,angle=index*Math.PI*(3-Math.sqrt(5)),radius=27+21*((index*.61803398875)%1);
          grains.push({x:22+x/96*76,y:25+y/88*70,sx:60+Math.cos(angle)*radius,sy:60+Math.sin(angle)*radius*.92,color:`rgb(${pixels[offset]},${pixels[offset+1]},${pixels[offset+2]})`});
        }
        sync();
      } catch { /* Keep the original brand mark if pixel sampling is unavailable. */ }
    };
    image.src='/cheesecool-logo.svg';
    const resize=()=>{size();sync();};
    preference.addEventListener('change',sync);document.addEventListener('visibilitychange',sync);window.addEventListener('resize',resize);
    return ()=>{disposed=true;image.onload=null;cancelAnimationFrame(frame);preference.removeEventListener('change',sync);document.removeEventListener('visibilitychange',sync);window.removeEventListener('resize',resize);};
  },[complete]);
  return <span className="brand-loader" data-ready={ready} data-complete={complete || undefined} aria-hidden="true">
    <CheeseMark size={72}/><canvas ref={canvas} width="120" height="120"/>
    {complete && <span className="brand-loader-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m5 12 4 4L19 6"/></svg></span>}
  </span>;
}
