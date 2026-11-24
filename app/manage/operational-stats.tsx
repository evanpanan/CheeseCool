'use client';
import {useEffect,useState} from 'react';
export function OperationalStats({site=false}:{site?:boolean}){
 const [data,setData]=useState<{jobs:Record<string,number>;original_bytes:number;last24h:{complete:number;failed:number;limited:number;average_duration_ms:number|null}}|null>(null),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();const read=()=>fetch('/api/operations'+(site?'?scope=site':''),{signal:controller.signal}).then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error);setData(data.metrics);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});void read();const timer=setInterval(()=>void read(),30000);return()=>{controller.abort();clearInterval(timer);};},[site]);
 return <section className="km-ask" style={{marginBlock:24}}><h2>{site?'站点处理状态':'处理状态'}</h2>{data?<><p>排队 {data.jobs.queued||0} · 处理中 {data.jobs.running||0} · 等待服务或继续 {data.jobs.waiting||0} · 需重试 {data.jobs.failed||0}</p><p>近 24 小时完成任务 {data.last24h.complete} 次 · 最终失败 {data.last24h.failed} 次 · 读取受限 {data.last24h.limited} 次</p><p>原件占用 {(data.original_bytes/1000000).toFixed(1)} MB{data.last24h.average_duration_ms!==null?' · 平均处理轮次 '+(data.last24h.average_duration_ms/1000).toFixed(1)+' 秒':''}</p></>:<p>{error||'正在读取运行状态…'}</p>}</section>;
}
