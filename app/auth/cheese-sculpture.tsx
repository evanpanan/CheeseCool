'use client';
import { useEffect, useRef } from 'react';
import { cheeseParticles, particleTarget, clusterCenters, type ParticleShape } from '@/lib/cheese-particles';

type Status='idle'|'thinking'|'error'|'done';
export function CheeseSculpture({state='idle',shape:storyShape='cheese',onActivate}:{state?:Status;shape?:ParticleShape;onActivate?:()=>void}) {
  const canvas=useRef<HTMLCanvasElement>(null);
  const status=useRef({state,shape:storyShape});
  const redraw=useRef<(()=>void)|null>(null);
  const pointer=useRef<{x:number;y:number}|null>(null);
  useEffect(()=>{status.current={state,shape:storyShape};if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)redraw.current?.();},[state,storyShape]);
  useEffect(()=>{
    const surface=canvas.current,context=surface?.getContext('2d');
    if(!surface || !context)return;
    const seeds=cheeseParticles();
    const positions=seeds.map(seed=>({...seed,ox:0,oy:0,vx:0,vy:0}));
    let frame=0,last=0,clock=0,shape:ParticleShape='cheese',changedAt=-10000,observed:Status='idle',errorAt:number|null=null,networkWeight=0;
    let from=positions.map(point=>({...point}));
    let dark=document.documentElement.dataset.theme==='dark';
    const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
    const size=()=>{
      const ratio=Math.min(window.devicePixelRatio||1,2);
      surface.width=320*ratio;surface.height=140*ratio;context.setTransform(ratio,0,0,ratio,0,0);
    };
    size();
    const draw=(now:number)=>{
      const reduced=preference.matches,step=last?Math.min((now-last)/16.667,2):1;last=now;
      if(!reduced)clock+=step*16.667;
      if(status.current.state!==observed){observed=status.current.state;errorAt=observed==='error'?clock:null;}
      const next:ParticleShape=observed==='done'?'done':observed==='thinking'?'thinking':observed==='error'?'cheese':status.current.shape;
      if(next!==shape){from=positions.map(point=>({...point}));shape=next;changedAt=clock;}
      context.clearRect(0,0,320,140);
      const falling=!reduced && errorAt!==null && clock-errorAt<900;
      const dt=step/60;
      networkWeight+=(Number(shape==='connected')-networkWeight)*(reduced?1:Math.min(1,.07*step));
      if(networkWeight>.005){
        context.globalAlpha=networkWeight*(dark?.24:.22);context.strokeStyle=dark?'#f9c846':'#b78329';context.lineWidth=.65;
        clusterCenters.slice(1).forEach(([x,y],index)=>{
          context.beginPath();context.moveTo(160,70);context.lineTo(160+x,70+y+(reduced?0:Math.sin(clock*.0009+index+1)*1.3));context.stroke();
        });
      }
      positions.forEach((point,index)=>{
        const target=particleTarget(shape,index,seeds.length,reduced?0:clock,seeds[index]);
        const progress=reduced?1:Math.max(0,Math.min(1,(clock-changedAt-index*.55)/620));
        const ease=1-Math.pow(1-progress,3);
        point.x=from[index].x+(target.x-from[index].x)*ease;
        point.y=from[index].y+(target.y-from[index].y)*ease;
        point.z=from[index].z+(target.z-from[index].z)*ease;
        const fallProgress=falling?Math.sin((clock-errorAt!)/900*Math.PI):0;
        const fall=fallProgress*(10+(index%11)*2),scatter=fallProgress*Math.sin(index*2.4)*10;
        let gx=0,gy=0;
        if(pointer.current && !reduced){
          const dx=160+point.x-pointer.current.x,dy=70+point.y-pointer.current.y,distance=Math.hypot(dx,dy);
          if(distance<29){const safe=Math.max(distance,.1);gx=dx/safe*(29-distance)*.7;gy=dy/safe*(29-distance)*.7;}
        }
        point.vx+=(250*(gx-point.ox)-23*point.vx)*dt;point.vy+=(250*(gy-point.oy)-23*point.vy)*dt;
        point.ox+=point.vx*dt;point.oy+=point.vy*dt;
        if(reduced)point.ox=point.oy=point.vx=point.vy=0;
        const depth=Math.max(0,Math.min(1,(point.z+1)/2));
        context.globalAlpha=(dark?.48:.52)+depth*.45;
        context.fillStyle=shape==='done'?(dark?'#a3d5b6':'#347a54'):falling?(dark?'#dfad79':'#ba8d46'):dark?(seeds[index].tone?'#f9c846':'#ffe6a1'):(seeds[index].tone?'#cc921e':'#e4b74f');
        context.beginPath();context.arc(160+point.x+point.ox+scatter,70+point.y+point.oy+fall,(shape==='cheese'?1.05:.95)+depth*.28,0,Math.PI*2);context.fill();
      });
      context.globalAlpha=1;
      if(!reduced && !document.hidden)frame=requestAnimationFrame(draw);
    };
    const restart=()=>{cancelAnimationFrame(frame);last=0;if(!document.hidden)draw(performance.now());};
    const theme=new MutationObserver(()=>{dark=document.documentElement.dataset.theme==='dark';if(preference.matches)restart();});
    theme.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    const resize=()=>{size();restart();};
    redraw.current=restart;restart();preference.addEventListener('change',restart);document.addEventListener('visibilitychange',restart);window.addEventListener('resize',resize);
    return ()=>{redraw.current=null;cancelAnimationFrame(frame);theme.disconnect();preference.removeEventListener('change',restart);document.removeEventListener('visibilitychange',restart);window.removeEventListener('resize',resize);};
  },[]);
  return <button type="button" className="auth-sculpture auth-particle-sculpture" aria-label={state==='done'?'登录成功':'切换粒子形态'} data-shape={state==='thinking'?'thinking':state==='done'?'done':state==='error'?'cheese':storyShape} disabled={state==='thinking' || state==='done'}
    onPointerMove={event=>{const box=canvas.current!.getBoundingClientRect();pointer.current={x:(event.clientX-box.left)/box.width*320,y:(event.clientY-box.top)/box.height*140};}}
    onPointerLeave={()=>{pointer.current=null;}} onPointerUp={event=>{if(event.pointerType!=='mouse')pointer.current=null;}} onPointerCancel={()=>{pointer.current=null;}} onBlur={()=>{pointer.current=null;}}
    onClick={onActivate}>
    <canvas ref={canvas} width="320" height="140" aria-hidden="true"/>
  </button>;
}
