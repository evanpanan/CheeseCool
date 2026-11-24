import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {serviceDatabase} from './supabase';
export const uploadPartSize=8388608,maxOriginalBytes=200000000;
export type OriginalPart={ordinal:number;path:string;bytes:number;sha256:string};
export type OriginalAsset={id:string;user_id:string;bookmark_id:string;object_path:string;filename:string;media_type:string;sha256:string;bytes:number;parts:OriginalPart[];integrity_kind?:string};
export function assetParts(asset:OriginalAsset):OriginalPart[]{
 const parts=asset.parts?.length?asset.parts:[{ordinal:0,path:asset.object_path,bytes:asset.bytes,sha256:asset.sha256}];
 const ordered=[...parts].sort((a,b)=>a.ordinal-b.ordinal);
 if(ordered.some((p,i)=>p.ordinal!==i||!p.path.startsWith(asset.user_id+'/')||!Number.isSafeInteger(p.bytes)||p.bytes<=0||p.bytes>uploadPartSize||!/^[a-f0-9]{64}$/.test(p.sha256))||ordered.reduce((n,p)=>n+p.bytes,0)!==asset.bytes)throw new Error('原件分片清单无效');
 return ordered;
}
export function byteRange(header:string|null,size:number){
 if(!header)return {start:0,end:size-1,partial:false};
 const match=/^bytes=(\d*)-(\d*)$/.exec(header);if(!match||(!match[1]&&!match[2]))throw new Error('无效的文件范围');
 const start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2])),end=match[1]?(match[2]?Number(match[2]):size-1):size-1;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)throw new Error('无效的文件范围');
 return {start,end:Math.min(size-1,end),partial:true};
}
export async function originalResponse(asset:OriginalAsset,rangeHeader:string|null=null){
 const range=byteRange(rangeHeader,asset.bytes),parts=assetParts(asset),service=serviceDatabase();if(!service)throw new Error('文件服务未配置');
 let offset=0;const wanted=parts.flatMap(part=>{const left=offset;offset+=part.bytes;return left<=range.end&&offset>range.start?[{part,left}]:[];});let index=0;
 const stream=new ReadableStream<Uint8Array>({async pull(controller){
  try{if(index>=wanted.length){controller.close();return;}const {part,left}=wanted[index++];const {data,error}=await service.storage.from('knowledge-originals').download(part.path);if(error||!data)throw new Error('原件分片暂时不可读');
   const bytes=Buffer.from(await data.arrayBuffer());if(bytes.length!==part.bytes||createHash('sha256').update(bytes).digest('hex')!==part.sha256)throw new Error('原件完整性校验失败');
   controller.enqueue(bytes.subarray(Math.max(0,range.start-left),Math.min(bytes.length,range.end-left+1)));
  }catch(error){controller.error(error);}
 }});
 return new Response(stream,{status:range.partial?206:200,headers:{'Content-Type':'application/octet-stream','Accept-Ranges':'bytes','Content-Length':String(range.end-range.start+1),...(range.partial?{'Content-Range':`bytes ${range.start}-${range.end}/${asset.bytes}`} : {}),'Content-Disposition':`attachment; filename="cheesecool-original"; filename*=UTF-8''${encodeURIComponent(asset.filename)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
export async function readOriginalBuffer(asset:OriginalAsset){const response=await originalResponse(asset);return Buffer.from(await response.arrayBuffer());}
export function mediaSourceToken(assetId:string,expires:number,secret:string){return createHmac('sha256',secret).update('cheesecool:media:'+assetId+':'+expires).digest('base64url');}
export function validMediaSourceToken(assetId:string,expires:number,token:string,secret:string,now=Date.now()){
 if(!Number.isSafeInteger(expires)||expires*1000<now||expires*1000>now+90000000||token.length!==43)return false;
 const expected=mediaSourceToken(assetId,expires,secret);return timingSafeEqual(Buffer.from(expected),Buffer.from(token));
}
export function internalMediaSource(assetId:string,stepId?:string,ttl=900){
 const secret=(process.env.MEDIA_SOURCE_SIGNING_KEY||process.env.AI_SETTINGS_ENCRYPTION_KEY),origin=process.env.NEXT_PUBLIC_SITE_URL;if(!secret||!origin)throw new Error('媒体工作进程未配置');
 const url=new URL('/api/internal/media-source',origin),expires=Math.floor(Date.now()/1000)+ttl;
 url.search=new URLSearchParams({id:assetId,...(stepId?{step:stepId}:{}),expires:String(expires),token:mediaSourceToken(assetId+(stepId?':'+stepId:''),expires,secret)}).toString();return url.href;
}
