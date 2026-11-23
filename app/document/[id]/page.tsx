import {notFound,redirect} from 'next/navigation';
import Link from 'next/link';
import {database} from '@/lib/supabase';
import {isAiAdmin} from '@/lib/ai-admin';
import {WorkspaceHeader} from '@/app/workspace-header';
export const dynamic='force-dynamic';
export const metadata={title:'知识原件',robots:{index:false,follow:false}};
export default async function Document({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{version?:string}>}){
 const {id}=await params;if(!/^[a-f\d-]{36}$/i.test(id))notFound();
 const db=await database();const {data:{user}}=await db.auth.getUser();if(!user)redirect('/login');
 const {data:record}=await db.from('bookmarks').select('id,title,record_type,content,attributes').eq('id',id).is('deleted_at',null).maybeSingle();if(!record)notFound();
 const {data:assets}=await db.from('bookmark_assets').select('id,filename').eq('bookmark_id',id);
 const {version}=await searchParams;if(version&&(typeof version!=='string'||!/^([a-f\d]{64})$/i.test(version)))notFound();const sourceQuery=db.from('bookmark_sources').select('id,captured_at,extracted_content,metadata').eq('bookmark_id',id).order('captured_at',{ascending:false}).limit(1);
 const {data:sources}=await (version?sourceQuery.eq('source_hash',version):sourceQuery);if(version&&!sources?.length)notFound();
 return <><WorkspaceHeader account={{email:user.email,avatarUrl:user.user_metadata?.avatar_url,showAdmin:isAiAdmin(user.id)}}/><main className="frame" style={{maxWidth:860,padding:'40px 24px 80px'}}><Link href="/manage">内容管理</Link><h1 style={{fontSize:28,margin:'24px 0'}}>{version&&typeof sources?.[0]?.metadata?.title==='string'?sources[0].metadata.title:record.title}</h1>{version&&<p style={{fontSize:12,color:'var(--subtle)'}}>来源存档版本 · {sources?.[0]?.captured_at}</p>}{assets?.map(asset=><p key={asset.id}><a href={'/api/assets?id='+asset.id}>下载原始文件 · {asset.filename}</a></p>)}{sources?.[0]&&<a href={'/api/documents?source='+sources[0].id}>{assets?.length?'下载提取文本':'下载完整原件'}</a>}{['asr','ocr'].includes(record.attributes?.extraction_method)&&<p style={{fontSize:13,color:'var(--subtle)'}}>这是自动识别文本，请核对专名与说话人；原始文件已保留。</p>}<p style={{color:'var(--subtle)',fontSize:12,margin:'14px 0'}}>原件只读 · 整理与修订另存，不覆盖原稿</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontFamily:'inherit',fontSize:15,lineHeight:1.9}}>{version?sources?.[0]?.extracted_content:record.content}</pre></main></>;
}
