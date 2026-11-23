import test from 'node:test';
import assert from 'node:assert/strict';
import {safeAuthNext} from '../lib/auth-redirect';
test('authentication return paths stay on this site',()=>{
  for(const value of [null,undefined,'','https://evil.example','//evil.example','/\\evil.example','/\nevil.example','/\t/evil.example']) assert.equal(safeAuthNext(value),'/');
  assert.equal(safeAuthNext('/network?q=ideas'),'/network?q=ideas');
});
