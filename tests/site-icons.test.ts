import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {siteOrigin,iconCandidates,sanitizeIconSvg,platformIcon,rasterizeIcon} from '../lib/site-icons';
test('site icons use owned web origins, recognize actual platform hosts and reject executable icon links',()=>{
 assert.equal(siteOrigin('https://github.com/example/repo'),'https://github.com');assert.equal(siteOrigin('record://private','note'),null);assert.equal(siteOrigin('https://user:password@example.org'),null);
 assert(platformIcon('https://github.com'));assert(platformIcon('https://twitter.com'));assert.equal(platformIcon('https://github.com.attacker.example'),null);
 assert.deepEqual(iconCandidates('<link rel="shortcut icon" href="/logo.svg"><link rel="icon" href="javascript:alert(1)"><link rel="apple-touch-icon" href="https://cdn.example.org/icon.png">',new URL('https://example.org/article')),['https://example.org/logo.svg','https://cdn.example.org/icon.png']);
});
test('untrusted SVG icons are stripped to geometry before rasterization',async()=>{
 const clean=sanitizeIconSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" onload="alert(1)"><script>alert(1)</script><image href="http://127.0.0.1/private"/><foreignObject><div>unsafe</div></foreignObject><path fill="url(https://example.org/leak)" d="M0 0h16v16H0Z"/></svg>');assert(!/onload|script|image |foreignObject|127\.0\.0|https:\/\/example/.test(clean));const png=await rasterizeIcon(Buffer.from(clean));assert.equal((await loadImage(png)).width,64);assert.throws(()=>sanitizeIconSvg('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg/>'));
});
test('GitHub and X logos and PNG-bearing favicons produce bounded PNGs and oversized images are rejected',async()=>{
 for(const origin of ['https://github.com','https://x.com']){const bytes=await rasterizeIcon(platformIcon(origin)!);assert(bytes.length<65536);const image=await loadImage(bytes);assert.equal(image.width,64);assert.equal(image.height,64);}
 const canvas=createCanvas(32,32),ctx=canvas.getContext('2d');ctx.fillStyle='#cf8b35';ctx.fillRect(0,0,32,32);const png=canvas.toBuffer('image/png'),header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header[6]=32;header[7]=32;header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);assert.equal((await loadImage(await rasterizeIcon(Buffer.concat([header,png])))).width,64);
 const bomb=Buffer.from(png);bomb.writeUInt32BE(10000,16);await assert.rejects(rasterizeIcon(bomb),/尺寸/);
});
