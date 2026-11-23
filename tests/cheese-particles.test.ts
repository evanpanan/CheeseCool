import test from 'node:test';
import assert from 'node:assert/strict';
import {cheeseParticles,particleTarget,particleStory} from '../lib/cheese-particles';
test('particle cheese preserves its open holes and silhouette through a static morph',()=>{
  const particles=cheeseParticles();
  assert.ok(particles.length>300 && particles.length<700);
  for(const [index,point] of particles.entries()) {
    const target=particleTarget('cheese',index,particles.length,0,point);
    assert.equal(target.x,point.x);assert.equal(target.y,point.y);
    const x=point.x/1.12+49,y=point.y/1.12+49;
    for(const [cx,cy,r] of [[30,64,6.8],[52,51,5.3],[72,63,7.3]])assert.ok(Math.hypot(x-cx,y-cy)>=r);
  }
});
test('sphere and thinking targets preserve particle identities and stay inside the drawing surface',()=>{
  const particles=cheeseParticles();
  for(const shape of ['orb','thinking','connected','done'] as const)for(const time of [0,650,100000]) {
    const positions=particles.map((point,index)=>particleTarget(shape,index,particles.length,time,point));
    assert.equal(positions.length,particles.length);
    assert.ok(positions.every(p=>Number.isFinite(p.x+p.y+p.z) && Math.abs(p.x)<70 && Math.abs(p.y)<70));
    if(shape!=='done')assert.ok(positions.some(p=>p.z<0) && positions.some(p=>p.z>0));
  }
});

test('the demonstration cycle has four paired product shapes and never claims success',()=>{
  assert.deepEqual(particleStory.map(step=>step.shape),['orb','cheese','thinking','connected']);
  assert.ok(particleStory.every(step=>step.copy.length>0));
});
