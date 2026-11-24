import {serviceDatabase} from '@/lib/supabase';
import {validMediaSourceToken,originalResponse,type OriginalAsset} from '@/lib/original-files';
export const maxDuration=240;
export async function GET(request:Request){
 const url=new URL(request.url),id=url.searchParams.get('id')||'',stepId=url.searchParams.get('step')||'',expires=Number(url.searchParams.get('expires')),token=url.searchParams.get('token')||'',secret=(process.env.MEDIA_SOURCE_SIGNING_KEY||process.env.AI_SETTINGS_ENCRYPTION_KEY);
 if(!secret||!validMediaSourceToken(id+(stepId?':'+stepId:''),expires,token,secret))return new Response(null,{status:401});
 const db=serviceDatabase();if(!db)return new Response(null,{status:503});
 const {data:asset}=await db.from('bookmark_assets').select('*').eq('id',id).maybeSingle();if(!asset)return new Response(null,{status:404});
 const {data:parent}=await db.from('bookmarks').select('id').eq('id',asset.bookmark_id).eq('user_id',asset.user_id).is('deleted_at',null).maybeSingle();if(!parent)return new Response(null,{status:404});
 let file=asset as OriginalAsset;if(stepId){const {data:step}=await db.from('knowledge_asset_steps').select('*').eq('id',stepId).eq('asset_id',asset.id).eq('user_id',asset.user_id).maybeSingle();if(!step?.object_path||!step.sha256||!step.bytes)return new Response(null,{status:404});file={...file,object_path:step.object_path,sha256:step.sha256,bytes:step.bytes,parts:[],integrity_kind:'sha256',filename:'segment.flac'};}
 try{return await originalResponse(file,request.headers.get('range'));}catch{return new Response(null,{status:416,headers:{'Content-Range':`bytes */${asset.bytes}`}});}
}
