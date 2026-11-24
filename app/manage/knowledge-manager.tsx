'use client';
import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import {KnowledgeStudio} from './knowledge-studio';
import {OperationalStats} from './operational-stats';
import {AiSignal} from '../ai-signal';
type Bookmark={id:string;title:string;original_url:string;tags:string[];notes:string;status:string};
type Job={id:string;bookmark_id:string;state:string;stage:string;attempts:number;error_message:string|null};
type Detail={bookmark:Bookmark;assets:{id:string;filename:string}[];sources:{id:string;origin:string;captured_at:string;source_url:string;extracted_content:string;truncated:boolean}[];derivations:{id:string;provider:string;model:string;created_at:string;source_hash:string;origin:string;evidence:string[]}[]};
type Citation={archive_url?:string;chunk_id:string;title:string;url:string;quote:string};
const states:Record<string,string>={queued:'排队中',running:'处理中',waiting:'等待继续',complete:'已完成',failed:'需重试',limited:'读取受限',cancelled:'已取消'};
async function responseData(response:Response){const data=await response.json();if(!response.ok)throw new Error(data.error||'操作失败');return data;}
export function KnowledgeManager(){
 const [tab,setTab]=useState<'library'|'jobs'|'ask'|'studio'>('library'),[trash,setTrash]=useState(false),[page,setPage]=useState(0);
 const [rows,setRows]=useState<Bookmark[]>([]),[jobs,setJobs]=useState<Job[]>([]),[total,setTotal]=useState(0);
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState(''),[detail,setDetail]=useState<Detail|null>(null);
 const [question,setQuestion]=useState(''),[answer,setAnswer]=useState(''),[citations,setCitations]=useState<Citation[]>([]);
 const load=useCallback(async(signal?:AbortSignal)=>{
  const [list,work]=await Promise.all([fetch(`/api/bookmarks?trash=${trash}&page=${page}`,{signal}).then(responseData),fetch('/api/jobs',{signal}).then(responseData)]);
  setRows(list.bookmarks);setTotal(list.total);setJobs(work.jobs);
 },[trash,page]);
 useEffect(()=>{const controller=new AbortController();load(controller.signal).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>controller.abort();},[load]);
 async function mutate(payload:object){setBusy(true);setError('');setNotice('');try{await fetch('/api/bookmarks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).then(responseData);await load();setNotice('已保存');}catch(e){setError(e instanceof Error?e.message:'操作失败');}finally{setBusy(false);}}
 async function inspect(id:string){setError('');try{setDetail(await fetch('/api/bookmarks?id='+id).then(responseData));}catch(e){setError(e instanceof Error?e.message:'来源读取失败');}}
 async function exportBackup(){setBusy(true);setError('');try{const response=await fetch('/api/bookmarks?format=export');if(!response.ok)await responseData(response);const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='cheesecool-backup.json';a.click();URL.revokeObjectURL(url);}catch(e){setError(e instanceof Error?e.message:'导出失败');}finally{setBusy(false);}}
 async function importBackup(file:File){setBusy(true);setError('');try{
  if(file.size>10000000)throw new Error('备份文件不能超过 10 MB');const data=JSON.parse(await file.text());const imported=Array.isArray(data)?data:data.bookmarks;
  if(!Array.isArray(imported)||imported.length>500)throw new Error('请选择最多 500 条收藏的 JSON 备份');let count=0;const mapping:Record<string,string>={};
  for(let i=0;i<imported.length;i++){
   const row=imported[i],source=Array.isArray(data.sources)?data.sources.find((s:{bookmark_id:string;source_hash?:string})=>s.bookmark_id===row.id&&s.source_hash===row.source_hash):undefined;
   const result=await fetch('/api/bookmarks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'import',bookmarks:[row],sources:source?[source]:[]})}).then(responseData);count+=result.imported;
   if(row.id&&result.resolved_id)mapping[row.id]=result.resolved_id;
   const inserted=result.inserted?.[0];
   if(inserted){
    for(const asset of (Array.isArray(data.attachments)?data.attachments:[]).filter((a:{bookmark_id:string})=>a.bookmark_id===row.id)){const bytes=Uint8Array.from(atob(asset.data),(c:string)=>c.charCodeAt(0));const form=new FormData();form.set('bookmark_id',inserted.id);form.set('file',new File([bytes],asset.filename,{type:asset.media_type}));await fetch('/api/assets',{method:'POST',body:form}).then(responseData);}
    for(const snapshot of (Array.isArray(data.sources)?data.sources:[]).filter((s:{bookmark_id:string})=>s.bookmark_id===row.id))await fetch('/api/bookmarks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'import_source',id:inserted.id,source:snapshot})}).then(responseData);
    for(const version of (Array.isArray(data.derivations)?data.derivations:[]).filter((s:{bookmark_id:string})=>s.bookmark_id===row.id))await fetch('/api/bookmarks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'import_derivation',id:inserted.id,derivation:version})}).then(responseData);
   }
   setNotice(`正在导入 ${i+1} / ${imported.length}`);
  }
  const mapIds=(ids:string[])=>ids.map(id=>{if(!mapping[id])throw new Error('备份缺少部分被引用材料，已恢复的数据会保留');return mapping[id];});
  for(const row of imported){
   if(row.attributes?.derived_from?.length&&mapping[row.id])await fetch('/api/bookmarks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'restore_links',id:mapping[row.id],source_ids:mapIds(row.attributes.derived_from)})}).then(responseData);
  }
  for(const insight of Array.isArray(data.insights)?data.insights:[]){
   const value={...insight,source_ids:mapIds(insight.source_ids),evidence:(insight.evidence||[]).map((e:{source_id:string;quote:string})=>({...e,source_id:mapping[e.source_id]}))};
   await fetch('/api/insights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'import_draft',value})}).then(responseData);
  }
  for(const entity of Array.isArray(data.entities)?data.entities:[])await fetch('/api/insights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'import_entity',value:{...entity,source_ids:mapIds(entity.source_ids)}})}).then(responseData);
  for(const row of imported)if(row.deleted_at&&mapping[row.id])await fetch('/api/bookmarks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'delete',id:mapping[row.id]})}).then(responseData);
  await load();setNotice(`已导入 ${count} 条，已有链接自动跳过；历史分析以导入草稿恢复`);
 }catch(e){setError(e instanceof Error?e.message:'导入失败；已成功的条目会保留，可重新导入');}finally{setBusy(false);}}
 async function ask(){setBusy(true);setError('');setAnswer('');setCitations([]);try{const data=await fetch('/api/knowledge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question})}).then(responseData);setAnswer(data.answer);setCitations(data.citations);}catch(e){setError(e instanceof Error?e.message:'问答暂不可用');}finally{setBusy(false);}}
 return <>
  <header className="km-heading"><div><span className="km-eyebrow"><AiSignal size={18}/>你的知识资产</span><h1>内容管理</h1></div><Link href="/">返回芝士库</Link></header>
  <nav className="km-tabs" aria-label="管理内容">{([['library','收藏'],['jobs','处理任务'],['ask','知识问答'],['studio','记录与分析']] as const).map(([key,label])=><button key={key} aria-pressed={tab===key} onClick={()=>{setTab(key);setError('');}}>{label}</button>)}</nav>
  {error&&<p className="error" role="alert">{error}</p>}{notice&&<p role="status" className="km-notice">{notice}</p>}
  {tab==='library'&&<>
   <div className="km-toolbar"><button aria-pressed={!trash} onClick={()=>{setTrash(false);setPage(0);}}>全部收藏</button><button aria-pressed={trash} onClick={()=>{setTrash(true);setPage(0);}}>回收站</button><span/><button disabled={busy} onClick={exportBackup}>导出备份</button><label className="km-import">导入备份<input type="file" accept="application/json,.json" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)void importBackup(f);e.target.value='';}}/></label></div>
   {!rows.length&&<p className="km-notice">这里还没有收藏</p>}
   <div className="km-list">{rows.map(row=><article key={row.id}><a href={row.original_url} target="_blank" rel="noopener noreferrer" className="km-title">{row.title}</a><p className="km-domain">{new URL(row.original_url).hostname}</p>
    {!trash?<form onSubmit={async e=>{e.preventDefault();const values=new FormData(e.currentTarget);await mutate({operation:'update',id:row.id,title:values.get('title'),tags:String(values.get('tags')).split(/[,，]/),notes:values.get('notes')});}}>
     <label>标题<input name="title" defaultValue={row.title} maxLength={240}/></label><label>标签<input name="tags" defaultValue={row.tags.join('，')} placeholder="多个标签用逗号分隔"/></label><label>我的笔记<textarea name="notes" defaultValue={row.notes} maxLength={10000} rows={2}/></label>
     <div className="km-row-actions"><button disabled={busy} type="submit">保存修改</button><button disabled={busy} type="button" onClick={()=>inspect(row.id)}>来源与版本</button><button disabled={busy} type="button" onClick={()=>mutate({operation:'recapture',id:row.id})}>重新采集</button><button disabled={busy} type="button" onClick={()=>mutate({operation:'delete',id:row.id})}>移入回收站</button></div>
    </form>:<button disabled={busy} onClick={()=>mutate({operation:'restore',id:row.id})}>恢复收藏</button>}
   </article>)}</div>
   <div className="km-pagination"><button disabled={!page||busy} onClick={()=>setPage(p=>p-1)}>上一页</button><span>{page+1} / {Math.max(1,Math.ceil(total/30))}</span><button disabled={(page+1)*30>=total||busy} onClick={()=>setPage(p=>p+1)}>下一页</button></div>
   {detail&&<section className="km-provenance"><div className="km-toolbar"><h2>来源与版本</h2><span/><button onClick={()=>setDetail(null)}>收起</button></div><h3>{detail.bookmark.title}</h3>{detail.assets?.map(asset=><p key={asset.id}><a href={'/api/assets?id='+asset.id}>下载原件 · {asset.filename}</a></p>)}{detail.sources.map(source=><details key={source.id}><summary>{new Date(source.captured_at).toLocaleString()} · {source.origin==='import'?'导入资料':source.origin==='legacy'?'历史提取文本':source.origin==='user'?'本人原件或提取文本':'网页存档'}{source.truncated?' · 已截断':''}</summary><a href={source.source_url} target="_blank" rel="noopener noreferrer">查看来源</a><pre>{source.extracted_content}</pre></details>)}{detail.derivations.map(version=><div className="km-version" key={version.id}><strong>{version.origin==='legacy'?'历史整理结果（模型信息未记录）':`${version.origin==='import'?'导入版本 · ':''}${version.provider} · ${version.model}`}</strong><p>{new Date(version.created_at).toLocaleString()}</p>{version.evidence.map((quote,i)=><blockquote key={i}>{quote}</blockquote>)}</div>)}</section>}
  </>}
  {tab==='jobs'&&<><OperationalStats/><div className="km-toolbar"><p>任务独立于页面运行，失败自动退避重试，最多 4 次。</p><span/><button disabled={busy} onClick={()=>load().catch(e=>setError(e.message))}>刷新状态</button></div><div className="km-list">{jobs.map(job=><article key={job.id}><h2>{rows.find(r=>r.id===job.bookmark_id)?.title||'收藏处理任务'}</h2><p>{states[job.state]||job.state} · {{extract:'采集原文',organize:'整理摘要与标签',index:'建立关联',complete:'完成'}[job.stage]||job.stage} · 尝试 {job.attempts}/4</p>{job.error_message&&<p>{job.error_message}</p>}{['failed','limited','waiting'].includes(job.state)&&<button disabled={busy} onClick={()=>mutate({operation:'retry',id:job.bookmark_id})}>重新处理</button>}</article>)}</div></>}
  {tab==='studio'&&<KnowledgeStudio records={rows} onSaved={load}/>}
  {tab==='ask'&&<section className="km-ask"><h2>从收藏中找到答案</h2><form onSubmit={e=>{e.preventDefault();void ask();}}><label>你的问题<textarea value={question} onChange={e=>setQuestion(e.target.value)} placeholder="例如：界面组件有哪些交互设计方法" maxLength={240} rows={3}/></label><button disabled={busy||!question.trim()}>{busy?'正在查找原文证据…':'查询芝士库'}</button></form>{answer&&<div className="km-answer"><p>{answer}</p>{citations.map((cite,i)=><blockquote key={cite.chunk_id+':'+i}><a href={cite.archive_url||cite.url} target="_blank" rel="noopener noreferrer">{cite.title}</a><p>{cite.quote}</p></blockquote>)}</div>}</section>}
 </>;
}
