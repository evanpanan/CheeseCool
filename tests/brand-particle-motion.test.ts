import test from 'node:test';
import assert from 'node:assert/strict';
import {brandParticleSpread} from '../lib/brand-particle-motion';
test('brand particles repeatedly assemble, hold and disperse without a jump at the loop seam',()=>{
  assert.equal(brandParticleSpread(0),1);
  assert.equal(brandParticleSpread(1100),0);
  assert.equal(brandParticleSpread(1800),0);
  assert.equal(brandParticleSpread(3100),1);
  assert.equal(brandParticleSpread(4000),1);
  assert.ok(brandParticleSpread(500)<1 && brandParticleSpread(500)>0);
  assert.ok(brandParticleSpread(2500)>0 && brandParticleSpread(2500)<1);
  for(let time=-4000;time<8000;time+=37){
    const spread=brandParticleSpread(time);
    assert.ok(spread>=0 && spread<=1);
    assert.ok(Math.abs(spread-brandParticleSpread(time+4000))<1e-10);
  }
});
