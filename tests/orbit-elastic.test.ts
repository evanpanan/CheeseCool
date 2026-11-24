import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {forceSimulation,forceLink,forceManyBody,forceCenter,forceCollide} from 'd3-force';
import {createOrbitForce} from '../lib/orbit-force-engine';
import {orbitElasticSource} from '../lib/orbit-elastic';
import {orbitForceSourceHash} from '../lib/orbit-force-source';
const homes=[{id:'root',x:-200,y:0,radius:12},{id:'first',x:0,y:0,radius:8},{id:'second',x:200,y:0,radius:8},{id:'remote',x:350,y:200,radius:8},{id:'other',x:-350,y:200,radius:8}],edges=[{a:'root',b:'first'},{a:'first',b:'second'}];
function field(){const f=createOrbitForce();f.sync(homes.map(n=>n.id),edges,homes);return f;}
const steps=(f:ReturnType<typeof field>,frames:number,hz=60)=>{for(let i=0;i<frames;i++)f.step(1/hz);};
test('drag and release use the actual WorkBuddy force model rather than fixed neighbor offsets or home springs',()=>{
 const f=field(),nodes=homes.map(n=>({...n,vx:0,vy:0,fx:null as number|null,fy:null as number|null}));
 const ref=forceSimulation(nodes).stop().alpha(0).alphaTarget(0).velocityDecay(.4)
  .force('link',forceLink<typeof nodes[number],any>(edges.map(e=>({source:e.a,target:e.b}))).id(n=>n.id).distance(145))
  .force('charge',forceManyBody<typeof nodes[number]>().strength(-480)).force('center',forceCenter(0,0))
  .force('collide',forceCollide<typeof nodes[number]>().radius(n=>n.radius+26).iterations(2));
 try{assert.equal(f.moving(),false);f.begin('root',0);f.move(160,60,10);ref.alpha(.3).alphaTarget(.3);nodes[0].fx=-40;nodes[0].fy=60;steps(f,60);ref.tick(60);
  for(const n of nodes){const home=homes.find(h=>h.id===n.id)!;assert(Math.abs(f.offset(n.id).x-(n.x-home.x))<1e-8);assert(Math.abs(f.offset(n.id).y-(n.y-home.y))<1e-8);}
  assert(Math.hypot(f.offset('remote').x,f.offset('remote').y)>0,'repulsion/centering can influence other nodes');
  f.release(1010);nodes[0].fx=nodes[0].fy=null;ref.alphaTarget(0);steps(f,180);ref.tick(180);
  for(const n of nodes){const home=homes.find(h=>h.id===n.id)!;assert(Math.abs(f.offset(n.id).x-(n.x-home.x))<1e-8);assert(Math.abs(f.offset(n.id).y-(n.y-home.y))<1e-8);}
  assert(homes.some(n=>Math.hypot(f.offset(n.id).x,f.offset(n.id).y)>1),'settle to force balance, not mandatory return to original coordinates');steps(f,240);assert.equal(f.moving(),false);
 }finally{ref.stop();}
});
test('pause freezes the force field, frame rates are consistent, updates preserve a grab and removed endpoints release safely',()=>{
 const frames=[];for(const hz of [30,60,120]){const f=field();f.begin('root',0);f.move(150,40,10);steps(f,hz,hz);const before=JSON.stringify(f.offset('first'));f.step(10,true);assert.equal(JSON.stringify(f.offset('first')),before);f.release(1100);steps(f,hz*3,hz);frames.push(f.offset('first').x);}
 assert(Math.max(...frames)-Math.min(...frames)<1e-8);
 const f=field();f.begin('root',0);f.move(90,20,10);steps(f,20);const before=f.offset('root').x;f.sync(homes.map(n=>n.id),edges,homes);assert.equal(f.active(),'root');assert.equal(f.offset('root').x,before);f.sync(['first','remote'],[],homes.filter(n=>n.id==='first'||n.id==='remote'));assert.equal(f.active(),null);steps(f,300);for(const n of ['first','remote'])assert(Number.isFinite(f.offset(n).x));
 f.place('first',60,70);assert.equal(f.offset('first').x,0);assert.equal(f.offset('first').y,0);
});
test('the iframe bundle is current, self-contained and initializes the same physics without a CDN',()=>{
 assert.equal(orbitForceSourceHash,createHash('sha256').update(readFileSync('lib/orbit-force-engine.ts')).digest('hex'));
 const factory=runInNewContext(orbitElasticSource+';createOrbitElastic',{setTimeout,clearTimeout,setInterval,clearInterval,performance});
 const f=factory();f.sync(homes.map(n=>n.id),edges,homes);f.begin('root',0);f.move(100,40,10);for(let i=0;i<30;i++)f.step(1/60);assert.equal(f.offset('root').x,100);assert(Number.isFinite(f.offset('first').x));f.release(1000);for(let i=0;i<400;i++)f.step(1/60);assert.equal(f.moving(),false);
});
