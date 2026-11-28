'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
type Capture={url:string;title:string;content:string;html:string};
export function CaptureImport({signedIn}:{signedIn:boolean}){
 const [manualUrl,setManualUrl]=useState(''),[manualTitle,setManualTitle]=useState(''),[manualContent,setManualContent]=useState('');
 const [capture,setCapture]=useState<Capture|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 useEffect(()=>{const params=new URL(location.href).searchParams;const id=params.get('handoff');setManualUrl((params.get('url')||'').slice(0,2048));setManualTitle((params.get('title')||'').slice(0,240));function receive(event:MessageEvent){if(event.source!==window||event.origin!==location.origin||event.data?.type!=='cheesecool:browser-capture'||event.data.id!==id)return;const value=event.data.payload;if(value&&typeof value.content==='string'&&typeof value.url==='string'&&value.content.length<=500000)setCapture({url:value.url,title:String(value.title||''),content:value.content,html:typeof value.html==='string'?value.html:''});}window.addEventListener('message',receive);window.postMessage({type:'cheesecool:request-capture',id},location.origin);return()=>window.removeEventListener('message',receive);},[]);
 async function save(){if(!capture)return;setBusy(true);setError('');try{const response=await fetch('/api/capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(capture)}),data=await response.json();if(!response.ok)throw new Error(data.error||'保存未完成');setSaved(true);}catch(e){setError(e instanceof Error?e.message:'保存未完成');}finally{setBusy(false);}}
 return <section className="km-ask"><h1>确认采集内容</h1>{!signedIn&&<p>请先在新标签页<Link href="/login" target="_blank">登录 CheeseCool</Link>，再刷新此页。</p>}{capture?<><h2>{capture.title}</h2><p style={{overflowWrap:'anywhere'}}>{capture.url}</p><textarea aria-label="采集的原文预览" readOnly value={capture.content} rows={14} style={{width:'100%'}}/><p>采集范围是此刻浏览器能读取的正文，不包含 Cookie 或密码。</p>{error&&<p className="error" role="alert">{error}</p>}{saved?<p role="status">已保存到芝士库。<Link href="/">返回芝士库</Link></p>:<div style={{display:'flex',gap:14}}><button type="button" disabled={busy} onClick={()=>{setManualUrl(capture.url);setManualTitle(capture.title);setManualContent(capture.content);setCapture(null);}}>返回修改</button><button disabled={busy||!signedIn} onClick={()=>void save()}>{busy?'正在保存…':'确认保存原文'}</button></div>}</>:<form onSubmit={event=>{event.preventDefault();setError('');setCapture({url:manualUrl.trim(),title:manualTitle.trim(),content:manualContent.trim(),html:''});}} style={{display:'grid',gap:14,maxWidth:760}}>
  <p className="km-notice">自动读取不到时，可打开原文，将你能阅读的正文粘贴到这里。保存后会继续生成摘要和关联。</p>
  <label>原文链接<input type="url" required maxLength={2048} value={manualUrl} onChange={event=>setManualUrl(event.target.value)} style={{display:'block',width:'100%',marginTop:6}}/></label>
  <label>标题<input required maxLength={240} value={manualTitle} onChange={event=>setManualTitle(event.target.value)} style={{display:'block',width:'100%',marginTop:6}}/></label>
  <label>原文内容<textarea required minLength={8} maxLength={500000} rows={14} value={manualContent} onChange={event=>setManualContent(event.target.value)} style={{display:'block',width:'100%',marginTop:6}}/></label>
  <button type="submit" disabled={manualContent.trim().length<8}>预览并确认</button>
  <p className="km-notice">桌面 Chrome 也可<a href="/cheesecool-capture-extension.zip" download>下载收藏正文扩展</a>，在原文页面主动采集，再确认保存。</p>
 </form>}</section>;
}
