/** Shared, self-contained engine source embedded in the sandboxed canvas and exercised by tests. */
export const orbitElasticSource = String.raw`
function createOrbitElastic(){
 const states=new Map(),adjacency=new Map();let active=null,targetX=0,targetY=0,weights=new Map(),lastMove=0,moving=false;
 const finite=v=>Number.isFinite(v)?v:0;
 function influence(id){
  const result=new Map([[id,1]]),queue=[[id,0]],levels=[1,.28,.075,.018];
  for(let i=0;i<queue.length;i++){const [current,depth]=queue[i];if(depth>=3)continue;for(const next of adjacency.get(current)||[]){if(result.has(next))continue;result.set(next,levels[depth+1]);queue.push([next,depth+1]);}}
  return result;
 }
 return {
  sync(ids,edges){const keep=new Set(ids);for(const id of states.keys())if(!keep.has(id))states.delete(id);adjacency.clear();for(const id of ids){if(!states.has(id))states.set(id,{x:0,y:0,vx:0,vy:0});adjacency.set(id,[]);}for(const edge of edges){if(adjacency.has(edge.a)&&adjacency.has(edge.b)){adjacency.get(edge.a).push(edge.b);adjacency.get(edge.b).push(edge.a);}}if(active&&!keep.has(active))this.release(0,true);else if(active)weights=influence(active);},
  begin(id,now){if(!states.has(id))return false;active=id;const s=states.get(id);targetX=s.x;targetY=s.y;lastMove=now;weights=influence(id);moving=true;return true;},
  move(x,y,now){if(!active)return;const s=states.get(active),dt=Math.max(.008,Math.min(.06,(now-lastMove)/1000));x=Math.max(-50000,Math.min(50000,finite(x)));y=Math.max(-50000,Math.min(50000,finite(y)));s.vx=Math.max(-1800,Math.min(1800,(x-s.x)/dt));s.vy=Math.max(-1800,Math.min(1800,(y-s.y)/dt));s.x=targetX=x;s.y=targetY=y;lastMove=now;moving=true;},
  release(now,cancelled=false){if(active){const s=states.get(active);if(s){const factor=cancelled||now-lastMove>100?0:.18;s.vx=Math.max(-160,Math.min(160,s.vx*factor));s.vy=Math.max(-160,Math.min(160,s.vy*factor));}}active=null;weights.clear();targetX=targetY=0;},
  reset(id){const s=states.get(id);if(s){s.x=s.y=s.vx=s.vy=0;}if(active===id)this.release(0,true);},
  offset(id){return states.get(id)||{x:0,y:0,vx:0,vy:0};},
  step(seconds,paused=false){if(paused||!moving)return;const dt=Math.max(0,Math.min(.05,finite(seconds))),steps=Math.max(1,Math.ceil(dt*120)),h=dt/steps;
   for(let pass=0;pass<steps;pass++)for(const [id,s]of states){if(id===active)continue;const weight=weights.get(id)||0;let x=targetX*weight,y=targetY*weight;const length=Math.hypot(x,y);if(length>110){x*=110/length;y*=110/length;}s.vx+=(125*(x-s.x)-18*s.vx)*h;s.vy+=(125*(y-s.y)-18*s.vy)*h;s.x+=s.vx*h;s.y+=s.vy*h;if(!active&&Math.hypot(s.x,s.y)<.015&&Math.hypot(s.vx,s.vy)<.08)s.x=s.y=s.vx=s.vy=0;}
   moving=active!==null||[...states.values()].some(s=>s.x||s.y||s.vx||s.vy);
  },
  weight(id){return weights.get(id)||0;},
  active(){return active;},
  moving(){return moving;}
 };
}
`;
