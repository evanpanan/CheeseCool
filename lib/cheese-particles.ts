/** Particle morph geometry adapted from dissolve ThinkingOrb by Rayan Selmi (MIT).
 * Attribution and license: docs/licenses/dissolve.txt.
 * Cheese silhouette, face shading and reduced-motion behavior are CheeseCool adaptations.
 */
export type ParticleShape = 'cheese' | 'orb' | 'thinking' | 'connected' | 'done';
export type CheeseParticle = {x:number;y:number;z:number;tone:number};
const outline=[[10,52],[16,42],[59,22],[68,22],[81,28],[88,39],[88,71],[77,82],[21,82],[10,71]];
function inside(x:number,y:number) {
  let yes=false;
  for(let i=0,j=outline.length-1;i<outline.length;j=i++) {
    const [ax,ay]=outline[i], [bx,by]=outline[j];
    if((ay>y)!==(by>y) && x<(bx-ax)*(y-ay)/(by-ay)+ax)yes=!yes;
  }
  return yes;
}
export function cheeseParticles():CheeseParticle[] {
  const particles:CheeseParticle[]=[];
  for(let y=22;y<=82;y+=3.1)for(let x=10;x<=88;x+=3.1) {
    if(!inside(x,y))continue;
    if([[30,64,6.8],[52,51,5.3],[72,63,7.3],[49,83,7.5]].some(([cx,cy,r])=>Math.hypot(x-cx,y-cy)<r))continue;
    const top=y<45-(x-18)*.21;
    if(top && ((x-64)/6)**2+((y-27.5)/2.6)**2<1)continue;
    particles.push({x:(x-49)*1.12,y:(y-49)*1.12,z:top?.55:.1+(x-10)/160,tone:top?0:1});
  }
  for(const [ax,ay,bx,by] of [[34,17,30,10],[48,14,49,5],[62,18,68,12]]) {
    for(let i=0;i<4;i++){const t=i/3;particles.push({x:(ax+(bx-ax)*t-49)*1.12,y:(ay+(by-ay)*t-49)*1.12,z:.6,tone:0});}
  }
  return particles;
}
const TAU=Math.PI*2, GA=Math.PI*(3-Math.sqrt(5));
export const particleStory = [
  {shape:'orb',copy:'每个灵感，都有新的可能。'},
  {shape:'cheese',copy:'把好东西，都存起来。'},
  {shape:'thinking',copy:'让 AI，理清每一次收藏。'},
  {shape:'connected',copy:'把灵感，连成自己的世界。'},
] as const;
export const clusterCenters=[[0,0],[-48,-27],[45,-28],[49,28],[-44,29]] as const;
export function particleTarget(shape:ParticleShape,index:number,count:number,time:number,seed:CheeseParticle) {
  if(shape==='connected') {
    const group=index%5,local=Math.floor(index/5),total=Math.ceil(count/5);
    const [cx,cy]=clusterCenters[group];
    const y=1-(local+.5)/total*2,r=Math.sqrt(Math.max(0,1-y*y)),angle=local*GA+time*.00018;
    if(group===0)return {x:seed.x*.3,y:seed.y*.3,z:seed.z};
    return {x:cx+Math.cos(angle)*r*9,y:cy+y*9+Math.sin(time*.0009+group)*1.3,z:Math.sin(angle)*r};
  }
  if(shape==='done') {
    const t=(index+.5)/count,first=.42,ax=-28,ay=0,bx=-8,by=20,cx=32,cy=-23;
    const u=t<first?t/first:(t-first)/(1-first),x=t<first?ax+(bx-ax)*u:bx+(cx-bx)*u,y=t<first?ay+(by-ay)*u:by+(cy-by)*u;
    return {x:x+Math.sin(index*GA)*1.9,y:y+Math.cos(index*GA)*1.9,z:(index%9)/9};
  }
  if(shape==='thinking') {
    const ring=index%3,angle=Math.floor(index/3)/(count/3)*TAU+time*[.0021,-.0016,.0012][ring];
    const x=Math.cos(angle)*47,z=Math.sin(angle)*47,y=-z*Math.sin(.45),turn=[0,1.05,-1.05][ring];
    return {x:x*Math.cos(turn)-y*Math.sin(turn),y:x*Math.sin(turn)+y*Math.cos(turn),z:z*Math.cos(.45)/48};
  }
  if(shape==='orb') {
    const y=1-(index+.5)/count*2,r=Math.sqrt(1-y*y),angle=index*GA+time*.0004;
    return {x:Math.cos(angle)*r*43,y:y*43,z:Math.sin(angle)*r};
  }
  const breath=1+.018*Math.sin(time*.0016),tilt=.035*Math.sin(time*.00065);
  return {x:(seed.x*Math.cos(tilt)-seed.y*Math.sin(tilt))*breath,y:(seed.x*Math.sin(tilt)+seed.y*Math.cos(tilt))*breath+Math.sin(time*.0012)*2,z:seed.z};
}
