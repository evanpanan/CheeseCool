import {createHash} from 'node:crypto';
import {siteAiConfig} from './site-ai';
import {serviceDatabase} from './supabase';
import {aliyunRerank} from './advanced-retrieval';
import {embedMany} from './ai';
import {ocrPdf} from './asset-processing';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {submitAliyunTranscript,pollAliyunTranscript,validateAliyunTranscript} from './domestic-ai';
import type {ServiceConfig} from './capability-services';
function fingerprint(config:ServiceConfig){return createHash('sha256').update([config.provider,config.model,config.host,config.key].join(':')).digest('hex');}
function correctSpeech(text:string){return /original/i.test(text)&&/evidence/i.test(text);}
export async function readServiceHealth(){
 const db=serviceDatabase();if(!db)throw new Error('服务未配置');const config=await siteAiConfig();const {data,error}=await db.from('knowledge_service_checks').select('*');if(error)throw error;
 const result=[];for(const capability of ['embedding','ocr','asr','rerank'] as const){const service=config[capability];let row=data?.find(r=>r.capability===capability&&service&&r.fingerprint===fingerprint(service));
  if(row?.state==='running'&&row.remote_task_id&&capability==='asr'&&service?.provider==='aliyun'){
   try{const polled=await pollAliyunTranscript(row.remote_task_id,service);if(!polled.pending){const segments=validateAliyunTranscript(polled.value,0,15,0,true,true),passed=correctSpeech(segments.map(s=>s.text).join(' '));const patch={state:passed?'passed':'failed',message:passed?'语音、时间戳及说话人格式已验证':'识别结果未通过固定样例检查',updated_at:new Date().toISOString()};await db.from('knowledge_service_checks').update(patch).eq('capability',capability).eq('fingerprint',row.fingerprint);row={...row,...patch};}}
   catch{const patch={state:'failed',message:'转写检测未完成，请检查权限与额度',updated_at:new Date().toISOString()};await db.from('knowledge_service_checks').update(patch).eq('capability',capability).eq('fingerprint',row.fingerprint);row={...row,...patch};}
  }
  result.push({capability,provider:service?.provider||config.serviceProvider,model:service?.model||null,state:!service?'unconfigured':row?.state||'untested',message:row?.message||null,checked_at:row?.updated_at||null});
 }return result;
}
export async function startServiceHealth(){
 const db=serviceDatabase();if(!db)throw new Error('服务未配置');const config=await siteAiConfig();
 await Promise.all((['embedding','ocr','asr','rerank'] as const).map(async capability=>{const service=config[capability];if(!service)return;const token=fingerprint(service);const previous=await db.from('knowledge_service_checks').select('state,updated_at,fingerprint').eq('capability',capability).maybeSingle();if(previous.data?.fingerprint===token&&Date.now()-Date.parse(previous.data.updated_at)<60000)return;
  const {error}=await db.from('knowledge_service_checks').upsert({capability,provider:service.provider,model:service.model,fingerprint:token,state:'running',remote_task_id:null,message:'正在执行固定样例检测',updated_at:new Date().toISOString()},{onConflict:'capability'});if(error)throw error;
  try{
   let message='';
   if(capability==='embedding'&&config.embedding){const vectors=await embedMany(['CheeseCool original evidence','CheeseCool original evidence'],config.embedding);let product=0,a=0,b=0;for(let i=0;i<1536;i++){product+=vectors[0][i]*vectors[1][i];a+=vectors[0][i]**2;b+=vectors[1][i]**2;}if(product/Math.sqrt(a*b)<.999)throw new Error('重复样例向量不一致');message='接口、1536 维格式及重复样例一致性已验证';}
   else if(capability==='rerank'&&config.rerank){const ranked=await aliyunRerank('How to preserve original documents?',[{chunk_id:'noise',bookmark_id:'noise',title:'Weather',url:'',content:'Weather forecasts predict rain and sunshine.',score:0},{chunk_id:'match',bookmark_id:'match',title:'Original documents',url:'',content:'Preserve original documents by storing full source files with integrity checks.',score:0}],config.rerank);if(ranked[0]?.chunk_id!=='match')throw new Error('重排样例未通过');message='固定相关与无关材料排序已验证';}
   else if(capability==='ocr'&&config.ocr){const text=await ocrPdf(await readFile(join(process.cwd(),'public/service-probe/ocr.pdf')),'ocr.pdf',service.key,config.ocr);if(!/456/.test(text)||!/original/i.test(text))throw new Error('OCR 样例未通过');message='扫描图像固定样例已验证';}
   else if(capability==='asr'&&config.asr){
    if(service.provider==='aliyun'){const source=new URL('/service-probe/speech.wav',process.env.NEXT_PUBLIC_SITE_URL);const task=await submitAliyunTranscript(source.href,true,service);await db.from('knowledge_service_checks').update({remote_task_id:task}).eq('capability',capability).eq('fingerprint',token);return;}
    const bytes=await readFile(join(process.cwd(),'public/service-probe/speech.wav')),form=new FormData();form.set('file',new File([bytes],'speech.wav',{type:'audio/wav'}));form.set('model',service.model);form.set('response_format','json');const response=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+service.key},body:form,signal:AbortSignal.timeout(90000),redirect:'error'});const result=await response.json();if(!response.ok||!correctSpeech(String(result.text||'')))throw new Error('转写样例未通过');message='固定语音样例已验证，未检测多人分离';
   }
   await db.from('knowledge_service_checks').update({state:'passed',message,updated_at:new Date().toISOString()}).eq('capability',capability).eq('fingerprint',token);
  }catch{await db.from('knowledge_service_checks').update({state:'failed',message:'检测未通过，请检查模型名称、服务权限或额度；现有原件不受影响',updated_at:new Date().toISOString()}).eq('capability',capability).eq('fingerprint',token);}
 }));return readServiceHealth();
}
