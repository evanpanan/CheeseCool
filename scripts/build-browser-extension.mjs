import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import JSZip from 'jszip';
await build({entryPoints:['browser-extension/capture-entry.ts'],outfile:'browser-extension/capture.js',bundle:true,minify:true,platform:'browser',target:'chrome118'});
const zip=new JSZip();for(const name of ['manifest.json','background.js','capture.js','handoff.js'])zip.file(name,await readFile('browser-extension/'+name));
zip.file('安装说明.txt','解压后，在 Chrome 打开 chrome://extensions，开启开发者模式，点击“加载已解压的扩展程序”，选择本目录。打开要收藏的网页并点击扩展图标，在 CheeseCool 确认采集内容。扩展只在你主动点击时读取当前页，不读取 Cookie 或密码。仅支持 Chrome 等 Chromium 桌面浏览器。');
await writeFile('public/cheesecool-capture-extension.zip',await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
