import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('the external parser loads in a CommonJS runtime without require(ESM) support', () => {
  const result = spawnSync(process.execPath, ['--no-experimental-require-module', '-e', `
    const { JSDOM } = require('jsdom');
    const { Readability } = require('@mozilla/readability');
    const dom = new JSDOM('<title>Runtime check</title><article><p>Saved article content.</p></article>');
    if (dom.window.document.title !== 'Runtime check') process.exit(1);
    new Readability(dom.window.document).parse();
    dom.window.close();
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
