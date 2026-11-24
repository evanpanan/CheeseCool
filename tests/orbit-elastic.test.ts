import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {orbitElasticSource} from '../lib/orbit-elastic';
function field(){const f=runInNewContext(orbitElasticSource+';createOrbitElastic()');f.sync(['root','first','second','remote'],[{a:'root',b:'first'},{a:'first',b:'second'}]);return f;}
const settle=(f:any,frames:number,hz=60)=>{for(let i=0;i<frames;i++)f.step(1/hz);};
test('dragging follows actual graph distance without disturbing disconnected nodes and returns home',()=>{
 const f=field();f.begin('root',0);f.move(160,60,50);settle(f,60);
 assert.equal(f.offset('root').x,160);assert(Math.abs(f.offset('first').x-44.8)<.1);assert(Math.abs(f.offset('second').x-12)<.1);assert.equal(f.offset('remote').x,0);assert.equal(f.offset('remote').y,0);
 f.release(1100);let min=0;for(let i=0;i<75;i++){f.step(1/60);min=Math.min(min,f.offset('root').x);}assert(min<0&&min>-8,'small damped overshoot');for(const id of ['root','first','second','remote'])assert.equal(f.offset(id).x,0);assert.equal(f.moving(),false);
});
test('spring motion is stable across frame rates, pause, and extreme pointer inputs',()=>{
 for(const hz of [30,60,120]){const f=field();f.begin('root',0);f.move(150,40,20);settle(f,hz/2,hz);const before=JSON.stringify(f.offset('first'));f.step(10,true);assert.equal(JSON.stringify(f.offset('first')),before);f.release(600);settle(f,hz*1.5,hz);assert.equal(f.offset('root').x,0);assert.equal(f.offset('first').x,0);}
 const f=field();f.begin('root',0);f.move(1e308,NaN,10);settle(f,20);assert(Math.hypot(f.offset('first').x,f.offset('first').y)<=112);f.release(50);settle(f,180);for(const id of ['root','first','second'])for(const v of Object.values(f.offset(id)))assert(Number.isFinite(v as number));
});
test('graph refresh preserves an active grab, cancelled gestures release cleanly and removed nodes do not stick',()=>{
 const f=field();f.begin('root',0);f.move(90,20,10);settle(f,10);const before=f.offset('root').x;f.sync(['root','first','second','remote','new'],[{a:'root',b:'first'},{a:'first',b:'second'}]);assert.equal(f.active(),'root');assert.equal(f.offset('root').x,before);assert.equal(f.offset('new').x,0);
 f.release(20,true);settle(f,90);assert.equal(f.active(),null);assert.equal(f.offset('root').x,0);f.begin('root',100);f.move(80,0,120);f.sync(['first','remote'],[]);assert.equal(f.active(),null);settle(f,90);assert.equal(f.moving(),false);
});
