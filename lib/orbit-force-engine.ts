import {forceSimulation,forceLink,forceManyBody,forceCenter,forceCollide,type SimulationNodeDatum} from 'd3-force';
type Point=SimulationNodeDatum&{id:string;x:number;y:number;homeX:number;homeY:number;radius:number;offset:{x:number;y:number;vx:number;vy:number}};
type Edge={a:string;b:string};
/** WorkBuddy reference force model. No spring to the original per-node coordinates. */
export function createOrbitForce(){
 const points=new Map<string,Point>(),adjacency=new Map<string,string[]>();let active:string|null=null,weights=new Map<string,number>(),signature='',accumulator=0;
 const link=forceLink<Point,{source:string|Point;target:string|Point}>().id(n=>n.id).distance(145);
 const simulation=forceSimulation<Point>([]).stop().alpha(0).alphaTarget(0).velocityDecay(.4)
  .force('link',link).force('charge',forceManyBody<Point>().strength(-480))
  .force('center',forceCenter<Point>(0,0)).force('collide',forceCollide<Point>().radius(n=>n.radius+26).iterations(2));
 const finite=(n:number)=>Number.isFinite(n)?n:0;
 function influence(id:string){const result=new Map([[id,1]]),queue:[string,number][]=[[id,0]],levels=[1,.28,.075,.018];for(let i=0;i<queue.length;i++){const [current,depth]=queue[i];if(depth>=3)continue;for(const next of adjacency.get(current)||[])if(!result.has(next)){result.set(next,levels[depth+1]);queue.push([next,depth+1]);}}return result;}
 const api={
  sync(ids:string[],edges:Edge[],homes:{id:string;x:number;y:number;radius:number}[]=[]){
   const positions=new Map(homes.map(n=>[n.id,n])),keep=new Set(ids),hadNodes=points.size>0;
   for(const id of points.keys())if(!keep.has(id))points.delete(id);
   adjacency.clear();for(const id of ids){const home=positions.get(id),x=finite(home?.x||0),y=finite(home?.y||0);let p=points.get(id);if(!p){p={id,x,y,homeX:x,homeY:y,radius:home?.radius||8,vx:0,vy:0,offset:{x:0,y:0,vx:0,vy:0}};points.set(id,p);}else if(home){p.homeX=x;p.homeY=y;p.radius=home.radius;}adjacency.set(id,[]);}
   const valid=edges.filter(e=>keep.has(e.a)&&keep.has(e.b)&&e.a!==e.b);for(const e of valid){adjacency.get(e.a)!.push(e.b);adjacency.get(e.b)!.push(e.a);}
   // Clear old links before replacing nodes, so a deleted endpoint cannot survive reinitialization.
   link.links([]);simulation.nodes([...points.values()]);link.links(valid.map(e=>({source:e.a,target:e.b})));
   const next=ids.join('|')+';'+valid.map(e=>[e.a,e.b].sort().join(':')).sort().join('|');if(hadNodes&&next!==signature)simulation.alpha(Math.max(simulation.alpha(),.12));signature=next;
   if(active&&!keep.has(active))api.release(0,true);else if(active)weights=influence(active);
  },
  begin(id:string,_now:number){const p=points.get(id);if(!p)return false;active=id;p.fx=p.x;p.fy=p.y;weights=influence(id);simulation.alpha(Math.max(simulation.alpha(),.3)).alphaTarget(.3);return true;},
  move(x:number,y:number,_now:number){const p=active?points.get(active):null;if(!p)return;p.fx=p.homeX+Math.max(-50000,Math.min(50000,finite(x)));p.fy=p.homeY+Math.max(-50000,Math.min(50000,finite(y)));},
  release(_now:number,cancelled=false){const p=active?points.get(active):null;if(p){p.x=p.fx??p.x;p.y=p.fy??p.y;p.fx=p.fy=null;if(cancelled)p.vx=p.vy=0;}active=null;weights.clear();simulation.alphaTarget(0);},
  reset(id:string){const p=points.get(id);if(!p)return;p.x=p.homeX;p.y=p.homeY;p.vx=p.vy=0;if(active===id)api.release(0,true);},
  place(id:string,x:number,y:number){const p=points.get(id);if(!p)return;p.x=p.homeX=finite(x);p.y=p.homeY=finite(y);p.vx=p.vy=0;p.fx=p.fy=null;simulation.alpha(Math.max(simulation.alpha(),.12));},
  offset(id:string){const p=points.get(id);if(!p)return {x:0,y:0,vx:0,vy:0};Object.assign(p.offset,{x:(p.fx??p.x)-p.homeX,y:(p.fy??p.y)-p.homeY,vx:p.vx||0,vy:p.vy||0});return p.offset;},
  step(seconds:number,paused=false){if(paused||!api.moving())return;accumulator+=Math.max(0,Math.min(.05,finite(seconds)))*60;const ticks=Math.floor(accumulator+1e-7);if(ticks){accumulator-=ticks;simulation.tick(ticks);}},
  weight(id:string){return weights.get(id)||0;},
  active(){return active;},
  moving(){return active!==null||simulation.alpha()>=simulation.alphaMin();}
 };
 return api;
}
