'use client';
import {useEffect,useState} from 'react';
async function request(body:object){const response=await fetch('/api/uploads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});const data=await response.json();if(!response.ok)throw new Error(data.error||'上传暂未完成');return data;}
export function UploadOriginal({onSaved}:{onSaved:()=>Promise<void>}){
 const [uploads,setUploads]=useState<{id:string;filename:string;done:number;total:number}[]>([]);
 const load=()=>fetch('/api/uploads').then(r=>r.json()).then(data=>setUploads(data.uploads||[])).catch(()=>{});
 useEffect(()=>{void load();},[]);
 const [busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[message,setMessage]=useState(''),[error,setError]=useState(''),[diarize,setDiarize]=useState(true);
 async function upload(file:File){
  setBusy(true);setError('');setProgress(0);setMessage('正在准备上传…');
  const key='cheesecool:upload:'+JSON.stringify([file.name,file.size,file.lastModified]);
  try{
   if(file.size>200000000)throw new Error('单个文件最大 200 MB');
   let session;let prior:string|null=null;try{prior=localStorage.getItem(key);}catch{}
   if(prior)try{session=await request({operation:'status',id:prior});if(session.state!=='uploading'||Date.parse(session.expires_at)<=Date.now())session=null;}catch{}
   if(!session){session=await request({operation:'init',filename:file.name,bytes:file.size,media_type:file.type,diarize});try{localStorage.setItem(key,session.id);}catch{}}
   const done=new Set<number>(session.parts.map((p:{ordinal:number})=>p.ordinal));
   for(let ordinal=0;ordinal<session.part_count;ordinal++){
    if(!done.has(ordinal)){
     const bytes=await file.slice(ordinal*session.part_size,Math.min(file.size,(ordinal+1)*session.part_size)).arrayBuffer();
     const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
     let successful=false;for(let attempt=0;attempt<3;attempt++){
      try{const signed=await request({operation:'sign',id:session.id,ordinal});const response=await fetch(signed.url,{method:'PUT',headers:{'Content-Type':'application/octet-stream','x-upsert':'false'},body:bytes,signal:AbortSignal.timeout(120000)});if(!response.ok&&![400,409].includes(response.status))throw new Error('分片上传中断');await request({operation:'part_done',id:session.id,ordinal,sha256:hash});successful=true;break;}catch(e){if(attempt===2)throw e;await new Promise(r=>setTimeout(r,500*2**attempt));}
     }if(!successful)throw new Error('分片上传未完成');
    }
    const percentage=Math.round((ordinal+1)/session.part_count*100);setProgress(percentage);setMessage(`正在上传 ${percentage}%`);
   }
   await request({operation:'complete',id:session.id});try{localStorage.removeItem(key);}catch{}
   setMessage('原件已保存，正在后台处理');await onSaved();
  }catch(e){setError((e instanceof Error?e.message:'上传未完成')+'；重新选择同一文件可继续上传');}
  finally{setBusy(false);void load();}
 }
 return <section className="km-ask"><h2>导入文档与音视频原件</h2><p className="km-notice">最大 200 MB，分片直传并支持续传。长音视频分段处理；扫描 PDF 逐页识别。</p><label><input type="checkbox" checked={diarize} disabled={busy} onChange={e=>setDiarize(e.target.checked)}/>区分说话人（分段标签）</label><input type="file" accept=".pdf,.docx,.txt,.md,.csv,.json,.mp3,.wav,.m4a,.ogg,.flac,.mp4,.webm,.mov,.mkv,.mpeg,.mpg,.aac,.opus,.mpga" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void upload(file);}}/>{busy&&<progress max={100} value={progress} aria-label="上传进度"/>}{message&&<p role="status">{message}</p>}{error&&<p className="error" role="alert">{error}</p>}{!busy&&uploads.map(u=><p key={u.id}>{u.filename} · 已上传 {u.done}/{u.total} 片 <button onClick={()=>{void request({operation:'cancel',id:u.id}).then(load).catch(e=>setError(e.message));}}>取消该上传</button></p>)}</section>;
}
