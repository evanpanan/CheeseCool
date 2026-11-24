// Temporary release acceptance endpoint. Removed after the live checks.
import {createHmac,timingSafeEqual,randomUUID,randomBytes,createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {runBackups,cleanupBackups,backupArtifacts,readBackupArtifact} from '@/lib/knowledge-backups';
import {prepareRestore,type BackupRecord} from '@/lib/backup-restore';
import {backupHash,decryptBackup} from '@/lib/backup-crypto';
import {captureLinkedOriginal} from '@/lib/linked-originals';
import JSZip from 'jszip';
import {serviceDatabase,supabaseConfig} from '@/lib/supabase';
export const maxDuration=300;
export async function POST(request:Request){
 const secret=process.env.CRON_SECRET;if(!secret)return new Response(null,{status:401});
 const expected=createHmac('sha256',secret).update('knowledge-backend-acceptance').digest('hex');
 const received=request.headers.get('x-acceptance-token')||'';
 if(received.length!==expected.length||!timingSafeEqual(Buffer.from(received),Buffer.from(expected)))return new Response(null,{status:401});
 const service=serviceDatabase(),config=supabaseConfig();if(!service||!config)return Response.json({error:'configuration'},{status:503});
 const accounts:string[]=[],checks:string[]=[],cleanup:boolean[]=[];
 const ensure=(value:unknown,label:string)=>{if(!value)throw new Error(label);};
 const origin=new URL(request.url).origin;
 async function account(){
  const result=await service!.auth.admin.generateLink({type:'magiclink',email:'cheesecool-qa-'+randomUUID()+'@example.invalid'});
  if(result.error)throw new Error('Temporary test account unavailable');
  accounts.push(result.data.user.id);
  const client=createClient(config!.url,config!.key,{auth:{persistSession:false,autoRefreshToken:false}});
  const verified=await client.auth.verifyOtp({type:result.data.properties.verification_type==='signup'?'signup':'magiclink',token_hash:result.data.properties.hashed_token});
  if(verified.error||!verified.data.session)throw new Error('Temporary test session unavailable: '+String(verified.error?.status)+' '+String(verified.error?.code));
  const value='base64-'+Buffer.from(JSON.stringify(verified.data.session)).toString('base64url');
  const name='sb-czinujtztqmtcddwyqgh-auth-token';
  const cookie=value.length<=3180?name+'='+value:Array.from({length:Math.ceil(value.length/3180)},(_,i)=>`${name}.${i}=${value.slice(i*3180,(i+1)*3180)}`).join('; ');
  return {id:result.data.user.id,cookie};
 }
 async function api(cookie:string,path:string,body?:object){
  const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'});
  const data=await response.json();return {status:response.status,data};
 }
 async function ok(cookie:string,path:string,body?:object){const result=await api(cookie,path,body);if(result.status!==200)throw new Error(path+': '+result.status+' '+String(result.data.error||''));return result.data;}
 let failure='';
 try{
 const a=await account(),b=await account();
 const created=await service.from('bookmarks').insert({user_id:a.id,original_url:origin+'/service-probe/speech.wav',canonical_url:origin+'/service-probe/speech.wav',platform:'web',title:'Original backed-up media',content:'Preserve source bytes and original text without changing their meaning.',source_hash:'qa-original-source',status:'indexed'}).select('*').single();if(created.error)throw new Error('fixture_record');const id=created.data.id;
 await service.from('bookmark_jobs').update({state:'cancelled'}).eq('bookmark_id',id);
 ensure(await captureLinkedOriginal(new URL(origin+'/service-probe/speech.wav'),a.id,id),'linked_media');
 const raw='Exact original source '+a.id+' must remain unchanged.';
 const source=await service.from('bookmark_sources').insert({user_id:a.id,bookmark_id:id,source_url:origin+'/service-probe/speech.wav',source_hash:'qa-original-source',raw_content:raw,extracted_content:created.data.content});if(source.error)throw new Error('fixture_source');
 checks.push('public_media_link_preserves_private_original');
 const queued=await ok(a.cookie,'/api/backups',{operation:'create'});ensure(queued.id,'backup_queued');
 let completed=false;for(let i=0;i<50;i++){await runBackups();const {data:state}=await service.from('knowledge_backups').select('state').eq('id',queued.id).single();if(state?.state==='complete'){completed=true;break;}if(state?.state==='failed')throw new Error('backup_failed');await new Promise(r=>setTimeout(r,150));}ensure(completed,'backup_completed');
 ensure((await fetch(origin+'/api/backups?id='+queued.id,{headers:{Cookie:b.cookie}})).status===404,'backup_owner_isolation');
 const response=await fetch(origin+'/api/backups?id='+queued.id,{headers:{Cookie:a.cookie},cache:'no-store'});ensure(response.ok,'encrypted_export');const archive=await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()));const root=process.env.BACKUP_ENCRYPTION_KEY!;
 const manifest=JSON.parse(decryptBackup(await archive.file('manifest.bin')!.async('nodebuffer'),root,queued.id,'manifest.bin').toString());
 const records:BackupRecord[]=[];const artifacts=new Map<string,{sha256:string}>(manifest.artifacts.map((f:{key:string;sha256:string})=>[f.key,f]));
 async function read(key:string){const bytes=await archive.file(key)!.async('nodebuffer');ensure(backupHash(bytes)===artifacts.get(key)?.sha256,'encrypted_integrity');return decryptBackup(bytes,root,queued.id,key);}
 for(const key of artifacts.keys())if(key.startsWith('record-'))records.push(JSON.parse((await read(key)).toString()));ensure(records.some(r=>r.table==='bookmark_sources'&&r.data.raw_content===raw),'snapshot_source_fidelity');
 checks.push('encrypted_streaming_export_and_ownership');
 const prepared=await prepareRestore(records,a.id,b.id,read,async(path,bytes)=>{const r=await service.storage.from('knowledge-originals').upload(path,bytes,{upsert:false});if(r.error)throw new Error('restore_file');}),session=randomUUID();
 const start=await service.from('knowledge_restore_sessions').insert({id:session,user_id:b.id});if(start.error)throw new Error('restore_session');for(let i=0;i<prepared.length;i++){const r=await service.from('knowledge_restore_rows').insert({session_id:session,ordinal:i,table_name:prepared[i].table,payload:prepared[i].data});if(r.error)throw new Error('restore_stage');}const finish=await service.rpc('commit_knowledge_restore',{restore_id:session});if(finish.error)throw new Error('restore_commit');
 const restored=await service.from('bookmark_sources').select('raw_content,source_hash').eq('user_id',b.id).single();ensure(restored.data?.raw_content===raw&&restored.data?.source_hash==='qa-original-source','restore_source_fidelity');
 const original=await service.from('bookmark_assets').select('*').eq('user_id',a.id).single(),restoredAsset=await service.from('bookmark_assets').select('*').eq('user_id',b.id).single();const oa=await service.storage.from('knowledge-originals').download(original.data.object_path),ra=await service.storage.from('knowledge-originals').download(restoredAsset.data.object_path);ensure(oa.data&&ra.data&&backupHash(Buffer.from(await oa.data.arrayBuffer()))===backupHash(Buffer.from(await ra.data.arrayBuffer())),'restored_binary_fidelity');
 checks.push('atomic_restore_into_new_account_with_source_and_binary_fidelity');
 const operations=await ok(a.cookie,'/api/operations');ensure(operations.metrics,'operational_metrics');
 }catch(error){failure=error instanceof Error?error.message:'unknown';}
 finally{for(const id of accounts){const result=await service.auth.admin.deleteUser(id);cleanup.push(!result.error);}for(let i=0;i<3;i++)await cleanupBackups().catch(()=>{});}
 return Response.json({checks,cleanup,...(failure?{error:failure}:{})},{status:failure?500:200});
}
