'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {UploadOriginal} from './upload-original';
type RecordRow={id:string;title:string};
type Insight={id:string;title:string;body:string;state:string;published_bookmark_id:string|null;evidence:{source_id:string;source_hash:string;quote:string}[];entities:{name:string;kind:string;description:string}[]};
type Entity={origin?:string;id:string;name:string;kind:string;description:string};
async function read(response:Response){const data=await response.json();if(!response.ok)throw new Error(data.error||'操作暂未完成');return data;}
export function KnowledgeStudio({records,onSaved}:{records:RecordRow[];onSaved:()=>Promise<void>}){
 const [kind,setKind]=useState('note'),[title,setTitle]=useState(''),[content,setContent]=useState(''),[date,setDate]=useState('');
 const [selected,setSelected]=useState<string[]>([]),[question,setQuestion]=useState(''),[insights,setInsights]=useState<Insight[]>([]),[entities,setEntities]=useState<Entity[]>([]);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function load(){const data=await fetch('/api/insights').then(read);setInsights(data.insights);setEntities(data.entities);}
 useEffect(()=>{setDate(new Intl.DateTimeFormat('en-CA').format(new Date()));void load().catch(e=>setError(e.message));},[]);
 async function run(work:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await work();await load();await onSaved();}catch(e){setError(e instanceof Error?e.message:'操作失败');}finally{setBusy(false);}}
 return <div className="km-studio">{error&&<p className="error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <section className="km-ask"><h2>记下一份原件</h2><form onSubmit={e=>{e.preventDefault();void run(async()=>{await fetch('/api/documents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,title,content,date,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone})}).then(read);setContent('');setTitle('');setNotice('原件已保存，正在整理');});}}>
   <label>类型<select value={kind} onChange={e=>setKind(e.target.value)}><option value="note">随记与想法</option><option value="journal">日记</option><option value="ai_conversation">完整 AI 对话</option><option value="meeting">会议与交流逐字稿</option></select></label>
   {kind==='journal'&&<label>日期<input type="date" value={date} onChange={e=>setDate(e.target.value)} required/></label>}
   <label>标题<input value={title} onChange={e=>setTitle(e.target.value)} maxLength={240} placeholder="可选，默认使用第一行"/></label>
   <label>完整原文<textarea value={content} onChange={e=>setContent(e.target.value)} rows={8} maxLength={500000} required placeholder={kind==='ai_conversation'?'粘贴完整对话，保留角色、顺序和原文':'粘贴原文；整理结果将另存，不覆盖原稿'}/></label>
   <button disabled={busy||!content.trim()}>保存原件</button>
  </form></section>
  <UploadOriginal onSaved={onSaved}/><section className="km-ask"><h2>采集浏览器正文</h2><p className="km-notice">在桌面 Chrome 安装扩展，主动采集自己已能阅读的页面，再确认保存。不会上传 Cookie 或密码。</p><a href="/cheesecool-capture-extension.zip" download>下载浏览器扩展与安装说明</a></section>
  <section className="km-ask"><h2>跨材料分析</h2><p className="km-notice">选择 1 至 6 份材料。先生成有来源的候选观点，再由你确认是否沉淀为知识。</p><form onSubmit={e=>{e.preventDefault();void run(async()=>{await fetch('/api/insights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'analyze',ids:selected,question})}).then(read);setNotice('分析草稿已生成，请核对后确认');});}}>
   <fieldset className="km-source-picker"><legend>当前列表的材料</legend>{records.map(record=><label key={record.id}><input type="checkbox" checked={selected.includes(record.id)} disabled={busy||(!selected.includes(record.id)&&selected.length>=6)} onChange={e=>setSelected(ids=>e.target.checked?[...ids,record.id]:ids.filter(id=>id!==record.id))}/>{record.title}</label>)}</fieldset>
   <label>分析方向<input value={question} onChange={e=>setQuestion(e.target.value)} maxLength={500} placeholder="提炼共识、差异与可复用观点"/></label><button disabled={busy||!selected.length}>{busy?'正在处理…':'生成分析草稿'}</button>
  </form></section>
  {insights.map(insight=><section className="km-ask" key={insight.id}><div className="km-toolbar"><h2>{insight.title}</h2><span/><small>{insight.state==='draft'?'待确认':insight.state==='confirmed'?'已确认':'已放弃'}</small></div><p style={{whiteSpace:'pre-wrap',lineHeight:1.9}}>{insight.body}</p>{insight.evidence.map((e,i)=><blockquote key={i}><Link href={'/document/'+e.source_id+'?version='+encodeURIComponent(e.source_hash)}>查看材料</Link><p>{e.quote}</p></blockquote>)}{Boolean(insight.entities.length)&&<details><summary>候选实体 {insight.entities.length}</summary>{insight.entities.map((entity,i)=><p key={i}>{entity.name} · {entity.description}</p>)}</details>}
   {insight.state==='draft'?<div className="km-row-actions"><button disabled={busy} onClick={()=>run(async()=>{await fetch('/api/insights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'confirm',id:insight.id})}).then(read);setNotice('已保存为知识笔记，并更新已确认实体');})}>确认并沉淀为知识</button><button disabled={busy} onClick={()=>run(async()=>{await fetch('/api/insights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'reject',id:insight.id})}).then(read);})}>放弃草稿</button></div>:insight.published_bookmark_id&&<Link href={'/document/'+insight.published_bookmark_id}>打开知识笔记</Link>}
  </section>)}
  {Boolean(entities.length)&&<section className="km-ask"><h2>实体档案</h2>{entities.map(entity=><div className="km-version" key={entity.id}><strong>{entity.name}</strong><small> · {entity.origin==='import'?'导入档案':'已确认'}</small><p>{entity.description}</p></div>)}</section>}
 </div>;
}
