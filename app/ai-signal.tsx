import { cheeseParticles, particleTarget, type ParticleShape } from '@/lib/cheese-particles';
export type AiSignalState='idle'|'thinking'|'connected'|'done'|'error';
const seeds=cheeseParticles();
const points=Array.from({length:54},(_,index)=>seeds[Math.floor(index/54*seeds.length)]);
export function AiSignal({state='idle',size=24}:{state?:AiSignalState;size?:number}) {
  const shape:ParticleShape=state==='idle'?'orb':state==='error'?'cheese':state;
  return <span className="ai-signal" data-state={state} aria-hidden="true" style={{width:size,height:size}}>
    <svg viewBox="0 0 120 120" fill="currentColor">{points.map((point,index)=>{
      const target=particleTarget(shape,index,points.length,0,point);
      return <circle key={index} cx={60+target.x} cy={60+target.y} r={2.1+Math.max(0,target.z)*.7} opacity={.5+(target.z+1)*.24}/>;
    })}</svg>
  </span>;
}
