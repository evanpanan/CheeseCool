declare const chrome:{runtime:{sendMessage:(message:unknown)=>void}};
import {Readability} from '@mozilla/readability';
const clone=document.cloneNode(true) as Document;
clone.querySelectorAll('script,style,noscript,form,input,textarea,nav,header,footer,[hidden],[aria-hidden="true"]').forEach(node=>node.remove());
const fallback=clone.querySelector('article,main')||clone.body;
const text=fallback?.textContent||'';const raw=fallback?.outerHTML||'';
let article:ReturnType<Readability['parse']>=null;try{article=new Readability(clone,{charThreshold:80}).parse();}catch{}
const content=(article?.textContent||text).trim();
if(content.length>=8&&content.length<=500000){
 const html=article?.content||raw;
 // The extension never reads cookies, local storage, password fields or account tokens.
 chrome.runtime.sendMessage({type:'cheesecool:captured',payload:{url:location.href,title:document.title.slice(0,240),content,html:new TextEncoder().encode(html).length+new TextEncoder().encode(content).length<=1800000?html:'',capture_scope:'browser-readable-document'}});
}
