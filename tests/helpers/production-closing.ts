/** Explicit bounded release acceptance, imported only by a temporary protected route. */
import {randomUUID,createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {serviceDatabase,supabaseConfig} from '../../lib/supabase';
import {siteAiConfig} from '../../lib/site-ai';
import {readServiceHealth,startServiceHealth} from '../../lib/service-health';
import {offsite,offsiteConfigured} from '../../lib/backup-offsite';
import {encryptBackup,decryptBackup,backupHash} from '../../lib/backup-crypto';
import {prepareRestore} from '../../lib/backup-restore';
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const ensure=(value:unknown,message:string)=>{if(!value)throw new Error(message);};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const stats=(rows:{ms:number}[])=>{const values=rows.map(r=>r.ms).sort((a,b)=>a-b);return {requests:values.length,p50_ms:Math.round(values[Math.floor(values.length*.5)]),p95_ms:Math.round(values[Math.ceil(values.length*.95)-1]),max_ms:Math.round(values.at(-1)!)};};
async function bounded<T,U>(values:T[],run:(value:T,index:number)=>Promise<U>){let cursor=0;const results:U[]=[],errors:unknown[]=[];await Promise.all(Array.from({length:Math.min(4,values.length)},async()=>{while(cursor<values.length){const i=cursor++;try{results[i]=await run(values[i],i);}catch(error){errors.push(error);}}}));if(errors.length)throw errors[0];return results;}
export async function productionClosing(origin:string){
 const service=serviceDatabase(),config=supabaseConfig();if(!service||!config)throw new Error('server_configuration');
 const actors:{id:string;cookie:string;signOut:()=>Promise<unknown>}[]=[],cleanup:boolean[]=[],checks:string[]=[],report:Record<string,unknown>={concurrency:4};let failure:string|null=null,remoteProbe:string|null=null;
 const realOwner=(process.env.AI_ADMIN_USER_IDS||'').split(',').map(s=>s.trim()).find(Boolean);
 const deadline=Date.now()+230000;
 async function checked<T extends {error:unknown}>(operation:PromiseLike<T>){const r=await operation;if(r.error)throw new Error('database_operation');return r;}
 async function realCount(){if(!realOwner)return null;return (await checked(service!.from('bookmarks').select('id',{count:'exact',head:true}).eq('user_id',realOwner).is('deleted_at',null))).count;}
 const before=await realCount();
 async function actor(){const created=await service!.auth.admin.generateLink({type:'magiclink',email:'cheesecool-close-'+randomUUID()+'@example.invalid'});if(created.error)throw new Error('test_account');
  const client=createClient(config!.url,config!.key,{auth:{persistSession:false,autoRefreshToken:false}});const entry={id:created.data.user.id,cookie:'',signOut:()=>client.auth.signOut({scope:'global'})};actors.push(entry);
  const verified=await client.auth.verifyOtp({type:created.data.properties.verification_type==='signup'?'signup':'magiclink',token_hash:created.data.properties.hashed_token});if(verified.error||!verified.data.session)throw new Error('test_session');
  const value='base64-'+Buffer.from(JSON.stringify(verified.data.session)).toString('base64url'),name='sb-'+new URL(config!.url).hostname.split('.')[0]+'-auth-token';entry.cookie=value.length<=3180?name+'='+value:Array.from({length:Math.ceil(value.length/3180)},(_,i)=>name+'.'+i+'='+value.slice(i*3180,(i+1)*3180)).join('; ');return entry;
 }
 async function api(cookie:string,path:string,body?:object){const started=performance.now(),response=await fetch(origin+path,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(Math.max(1,Math.min(20000,deadline-Date.now()))),cache:'no-store'});let data:any;try{data=await response.json();}catch{throw new Error('non_json_api_response');}return {status:response.status,data,ms:performance.now()-started};}
 async function drained(owner:string,ids:string[],limitMs=150000){const start=Date.now();while(Date.now()-start<limitMs&&Date.now()<deadline){const r=await checked(service!.from('bookmark_jobs').select('bookmark_id,state').eq('user_id',owner).in('bookmark_id',ids));if(r.data?.length===ids.length&&r.data.every(j=>j.state==='complete'))return Date.now()-start;if(r.data?.some(j=>j.state==='failed'||j.state==='limited'))throw new Error('queue_failed');await wait(1000);}throw new Error('queue_drain_timeout');}
 try{
  const services=await siteAiConfig();report.services=await readServiceHealth();if(services.embedding||services.ocr||services.asr||services.rerank){await startServiceHealth();report.services=await readServiceHealth();}
  report.offsite={configured:offsiteConfigured(),state:offsiteConfigured()?'pending':'blocked_missing_configuration'};
  const a=await actor(),b=await actor(),runId=randomUUID(),content=(i:number)=>`收尾验收条目 ${i}：芝士库保存原始资料和来源版本，摘要必须保留逐字原文证据，检索结果必须按账号隔离。验收标记 closingcapture${i}。`;
  const bodies=Array.from({length:8},(_,i)=>({url:`https://example.invalid/closing/${runId}/${i}`,title:'Release acceptance '+i,content:content(i),html:'<article><p>'+content(i)+'</p></article>'}));
  const saved=await bounded(bodies,body=>api(a.cookie,'/api/capture',body));ensure(saved.every(r=>r.status===200&&r.data.ok&&r.data.id),'concurrent_capture');const ids=saved.map(r=>r.data.id as string);ensure(new Set(ids).size===8,'capture_unique');report.capture=stats(saved);checks.push('eight_http_captures_at_four_concurrency');
  report.queue_drain_ms=await drained(a.id,ids);const originals=await checked(service.from('bookmarks').select('id,content,ai_summary,source_hash').eq('user_id',a.id).in('id',ids));ensure(originals.data?.every(row=>row.ai_summary&&row.source_hash&&bodies.some(body=>body.content===row.content)),'queue_original_summary');
  const audits=await checked(service.from('bookmark_derivations').select('bookmark_id,evidence').eq('user_id',a.id).in('bookmark_id',ids));ensure(audits.data?.length===8&&audits.data.every(row=>Array.isArray(row.evidence)&&row.evidence.length>0),'lease_unique_grounded_audits');checks.push('queue_drained_without_duplicate_derivations');
  const duplicated=await bounded(Array.from({length:4}),()=>api(a.cookie,'/api/capture',bodies[0]));ensure(duplicated.every(r=>r.status===200&&r.data.id===ids[0]||r.status===409),'duplicate_capture_status');const count=await checked(service.from('bookmarks').select('id',{count:'exact',head:true}).eq('user_id',a.id));ensure(count.count===8,'capture_idempotency');await drained(a.id,ids);checks.push('duplicate_capture_preserves_single_record');
  await checked(service.from('knowledge_enrichment_jobs').delete().eq('user_id',a.id));
  // Separate synthetic retrieval fixture; these 192 records are not counted as HTTP capture throughput.
  const seed=Array.from({length:192},(_,i)=>{const marker='closingseed'+String(i).padStart(8,'0'),text=`${marker}: 原始资料需要保留来源证据和账户隔离。`;return {id:randomUUID(),user_id:a.id,original_url:`record://closing/${runId}/${i}`,canonical_url:`record://closing/${runId}/${i}`,platform:'web',title:marker,record_type:'knowledge_note',content:text,source_hash:hash(text),ai_summary:'Synthetic retrieval fixture',status:'indexed',attributes:{acceptance_fixture:true}};});
  await checked(service.from('bookmarks').insert(seed));await checked(service.from('bookmark_jobs').update({state:'complete',stage:'complete',lease_until:null}).eq('user_id',a.id).in('bookmark_id',seed.map(r=>r.id)));
  await checked(service.from('bookmark_chunks').insert(seed.flatMap(row=>Array.from({length:5},(_,ordinal)=>({user_id:a.id,bookmark_id:row.id,source_hash:row.source_hash,ordinal,content:row.content+' 第 '+ordinal+' 段。'})))));
  const chunks=await checked(service.from('bookmark_chunks').select('id',{count:'exact',head:true}).eq('user_id',a.id));report.dataset={documents:200,chunks:chunks.count};
  const searched=await bounded(Array.from({length:12},(_,i)=>i),async i=>{const marker=seed[i*13].title,r=await api(a.cookie,'/api/knowledge',{operation:'search',question:marker});ensure(r.status===200&&r.data.sources?.some((s:any)=>s.bookmark_id===seed[i*13].id),'search_relevance');ensure(r.data.mode==='keyword'||r.data.mode==='hybrid','search_mode');return r;});report.search=stats(searched);checks.push('twelve_http_searches_at_four_concurrency');
  const listings=await bounded(Array.from({length:8}),()=>api(a.cookie,'/api/bookmarks'));ensure(listings.every(r=>r.status===200&&r.data.total===200),'collection_listing');report.collection=stats(listings);
  const isolated=await api(b.cookie,'/api/bookmarks?id='+ids[0]),searchForeign=await api(b.cookie,'/api/knowledge',{operation:'search',question:seed[0].title}),anonymous=await api('','/api/bookmarks');ensure(isolated.status===404&&searchForeign.status===200&&!searchForeign.data.sources.length&&anonymous.status===401,'account_isolation');checks.push('authenticated_owner_isolation_and_anonymous_denial');
  ensure((report.capture as any).p95_ms<10000&&(report.search as any).p95_ms<5000,'acceptance_latency_budget');
  if(offsiteConfigured()){
   const root=process.env.BACKUP_ENCRYPTION_KEY;if(!root)throw new Error('backup_encryption_unconfigured');
   const selected=await checked(service.from('bookmarks').select('*').eq('id',ids[1]).eq('user_id',a.id).single()),source=await checked(service.from('bookmark_sources').select('*').eq('bookmark_id',ids[1]).eq('user_id',a.id));
   const records=[{table:'bookmarks',data:selected.data},...(source.data||[]).map(data=>({table:'bookmark_sources',data}))],backupId=randomUUID(),key='closing-probe.bin';remoteProbe=`${a.id}/${backupId}/${key}`;
   const plain=Buffer.from(JSON.stringify(records)),encrypted=encryptBackup(plain,root,backupId,key);await offsite('PUT',remoteProbe,encrypted);const copy=Buffer.from(await (await offsite('GET',remoteProbe)).arrayBuffer());ensure(backupHash(copy)===backupHash(encrypted),'offsite_integrity');
   const restored=await prepareRestore(JSON.parse(decryptBackup(copy,root,backupId,key).toString()),a.id,b.id,async()=>Buffer.alloc(0),async()=>{}),session=randomUUID();await checked(service.from('knowledge_restore_sessions').insert({id:session,user_id:b.id}));await checked(service.from('knowledge_restore_rows').insert(restored.map((r,ordinal)=>({session_id:session,ordinal,table_name:r.table,payload:r.data}))));await checked(service.rpc('commit_knowledge_restore',{restore_id:session}));
   const restoredRows=await checked(service.from('bookmarks').select('content,source_hash').eq('user_id',b.id));ensure(restoredRows.data?.length===1&&restoredRows.data[0].source_hash===selected.data.source_hash&&restoredRows.data[0].content===selected.data.content,'offsite_restore');await offsite('DELETE',remoteProbe);remoteProbe=null;report.offsite={configured:true,state:'passed',method:'encrypted_remote_round_trip_and_isolated_database_restore'};checks.push('offsite_backup_restore');
  }
 }catch(error){failure=error instanceof Error?error.message:'unknown';}
 finally{
  if(remoteProbe)try{await offsite('DELETE',remoteProbe);}catch{failure=failure||'remote_cleanup';}
  for(const actor of actors){try{
   await actor.signOut();
   const backups=await service.from('knowledge_backups').select('id').eq('user_id',actor.id);for(const backup of backups.data||[]){const prefix=actor.id+'/'+backup.id+'/',listed=await service.storage.from('knowledge-backups').list(prefix.slice(0,-1),{limit:1000});if(listed.error)throw new Error('backup_cleanup');if(listed.data?.length){const deleted=await service.storage.from('knowledge-backups').remove(listed.data.map(r=>prefix+r.name));if(deleted.error)throw new Error('backup_cleanup');}}
   const deleted=await service.auth.admin.deleteUser(actor.id);if(deleted.error)throw new Error('account_cleanup');const remains=await service.from('bookmarks').select('id',{count:'exact',head:true}).eq('user_id',actor.id);cleanup.push(!remains.error&&remains.count===0);
  }catch{cleanup.push(false);}}
 }
 const after=await realCount();ensure(before===after,'real_account_changed');return {ok:!failure&&cleanup.length===2&&cleanup.every(Boolean),failure,checks,report,cleanup,real_bookmarks_preserved:before===after};
}
