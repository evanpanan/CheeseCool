import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createOrbitForce} from '../lib/orbit-force-engine';
import {orbitElasticSource} from '../lib/orbit-elastic';
import {orbitForceSourceHash} from '../lib/orbit-force-source';
const homes=[{id:'root',x:-200,y:0,radius:12},{id:'first',x:0,y:0,radius:8},{id:'second',x:200,y:0,radius:8},{id:'remote',x:350,y:200,radius:8},{id:'other',x:-350,y:200,radius:8}],edges=[{a:'root',b:'first'},{a:'first',b:'second'}];
function field(){const f=createOrbitForce();f.sync(homes.map(n=>n.id),edges,homes);return f;}
const steps=(f:ReturnType<typeof field>,frames:number,hz=60)=>{for(let i=0;i<frames;i++)f.step(1/hz);};
test('drag only gently deforms nearby nodes and release slowly restores the original layout',()=>{
 const f=field();assert.equal(f.moving(),false);f.begin('root',0);f.move(160,60,10);steps(f,180);
 assert.equal(f.offset('root').x,160);assert(f.offset('first').x>10&&f.offset('first').x<18);assert(f.offset('second').x>2&&f.offset('second').x<5);
 assert.deepEqual(f.offset('remote'),{x:0,y:0,vx:0,vy:0});assert.deepEqual(f.offset('other'),{x:0,y:0,vx:0,vy:0});
 f.move(4000,3000,3010);steps(f,180);assert(Math.hypot(f.offset('first').x,f.offset('first').y)<=22.01);assert(Math.hypot(f.offset('second').x,f.offset('second').y)<=6.01);
 f.move(160,60,6010);steps(f,120);f.release(8010);steps(f,60);const afterSecond=Math.hypot(f.offset('root').x,f.offset('root').y);assert(afterSecond>5&&afterSecond<80,'gentle return, no instant snap');steps(f,660);assert.equal(f.moving(),false);for(const n of homes)assert.deepEqual(f.offset(n.id),{x:0,y:0,vx:0,vy:0});
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
