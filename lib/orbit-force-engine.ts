type Edge={a:string;b:string};
type Offset={x:number;y:number;vx:number;vy:number};
/** Temporary local deformation around the saved layout; never relayout the graph. */
export function createOrbitForce(){
 const points=new Map<string,Offset>(),adjacency=new Map<string,string[]>();
 let active:string|null=null,weights=new Map<string,number>(),targetX=0,targetY=0,accumulator=0,lastMove=0;
 const finite=(n:number)=>Number.isFinite(n)?n:0;
 function influence(id:string){const result=new Map([[id,1]]),queue:[string,number][]=[[id,0]],levels=[1,.10,.025];for(let i=0;i<queue.length;i++){const [current,depth]=queue[i];if(depth>=2)continue;for(const next of adjacency.get(current)||[])if(!result.has(next)){result.set(next,levels[depth+1]);queue.push([next,depth+1]);}}return result;}
 const api={
  sync(ids:string[],edges:Edge[],_homes:{id:string;x:number;y:number;radius:number}[]=[]){const keep=new Set(ids);for(const id of points.keys())if(!keep.has(id))points.delete(id);adjacency.clear();for(const id of ids){if(!points.has(id))points.set(id,{x:0,y:0,vx:0,vy:0});adjacency.set(id,[]);}for(const e of edges)if(e.a!==e.b&&keep.has(e.a)&&keep.has(e.b)){adjacency.get(e.a)!.push(e.b);adjacency.get(e.b)!.push(e.a);}if(active&&!keep.has(active))api.release(0,true);else if(active)weights=influence(active);},
  begin(id:string,now:number){const p=points.get(id);if(!p)return false;active=id;targetX=p.x;targetY=p.y;lastMove=now;weights=influence(id);return true;},
  move(x:number,y:number,now:number){const p=active?points.get(active):null;if(!p)return;const dt=Math.max(.008,Math.min(.06,(now-lastMove)/1000));x=Math.max(-50000,Math.min(50000,finite(x)));y=Math.max(-50000,Math.min(50000,finite(y)));p.vx=Math.max(-500,Math.min(500,(x-p.x)/dt));p.vy=Math.max(-500,Math.min(500,(y-p.y)/dt));p.x=targetX=x;p.y=targetY=y;lastMove=now;},
  release(now:number,cancelled=false){const p=active?points.get(active):null;if(p){const factor=cancelled||now-lastMove>100?0:.05;p.vx=Math.max(-25,Math.min(25,p.vx*factor));p.vy=Math.max(-25,Math.min(25,p.vy*factor));}active=null;weights.clear();targetX=targetY=0;},
  reset(id:string){const p=points.get(id);if(p)p.x=p.y=p.vx=p.vy=0;if(active===id)api.release(0,true);},
  place(id:string,_x:number,_y:number){api.reset(id);},
  offset(id:string){return points.get(id)||{x:0,y:0,vx:0,vy:0};},
  step(seconds:number,paused=false){if(paused||!api.moving())return;accumulator+=Math.max(0,Math.min(.05,finite(seconds)))*120;const ticks=Math.floor(accumulator+1e-7);accumulator-=ticks;for(let i=0;i<ticks;i++)for(const [id,p]of points){if(id===active)continue;const w=weights.get(id)||0;let x=targetX*w,y=targetY*w;const cap=w>=.1?22:6,length=Math.hypot(x,y);if(length>cap){x*=cap/length;y*=cap/length;}const stiffness=active?22:10,damping=active?9:5.5;p.vx+=(stiffness*(x-p.x)-damping*p.vx)/120;p.vy+=(stiffness*(y-p.y)-damping*p.vy)/120;p.x+=p.vx/120;p.y+=p.vy/120;if(!active&&Math.hypot(p.x,p.y)<.02&&Math.hypot(p.vx,p.vy)<.08)p.x=p.y=p.vx=p.vy=0;}},
  weight(id:string){return weights.get(id)||0;},
  active(){return active;},
  moving(){return active!==null||[...points.values()].some(p=>p.x!==0||p.y!==0||p.vx!==0||p.vy!==0);}
 };
 return api;
}
