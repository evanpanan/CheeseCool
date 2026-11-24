import {createDecipheriv} from 'node:crypto';
import {encryptionKey,type AiSettings,resolveAi} from './ai-settings';
export type CapabilityProvider='aliyun'|'openai';
export type ServiceConfig={provider:CapabilityProvider;key:string;host:string;model:string};
export type EmbeddingService=ServiceConfig&{endpoint:string;space:string;dimensions:1536};
export type CapabilitySettings={provider:CapabilityProvider;aliyun_key?:string|null;aliyun_host?:string|null;embedding_model?:string|null;ocr_model?:string|null;asr_model?:string|null;rerank_model?:string|null};
export function validAliyunHost(host:string){return host==='dashscope.aliyuncs.com'||/^[a-zA-Z0-9-]{2,80}\.cn-beijing\.maas\.aliyuncs\.com$/.test(host);}
export function resolveCapabilities(settings:CapabilitySettings|null,ai:ReturnType<typeof resolveAi>){
 const provider=settings?.provider|| (process.env.CAPABILITY_PROVIDER==='openai'?'openai':'aliyun');
 let key:string|null=null;const host=(settings?.aliyun_host||process.env.DASHSCOPE_HOST||'dashscope.aliyuncs.com').trim();if(!validAliyunHost(host))throw new Error('百炼服务域名无效');
 if(provider==='aliyun'){
  key=process.env.DASHSCOPE_API_KEY||null;
  if(settings?.aliyun_key){const root=encryptionKey();if(!root)throw new Error('服务端密钥加密未配置');const bytes=Buffer.from(settings.aliyun_key,'base64url'),decipher=createDecipheriv('aes-256-gcm',root,bytes.subarray(0,12));decipher.setAAD(Buffer.from('cheesecool:site-ai:aliyun-services'));decipher.setAuthTag(bytes.subarray(12,28));key=Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8');}
 }else key=ai.embeddingKey;
 const embeddingModel=settings?.embedding_model|| (provider==='aliyun'?'text-embedding-v4':'text-embedding-3-small');
 const ocrModel=settings?.ocr_model|| (provider==='aliyun'?'qwen3.5-ocr':'gpt-4.1-mini');
 const asrModel=settings?.asr_model|| (provider==='aliyun'?'paraformer-v2':'gpt-transcribe');
 const common={provider,host:provider==='aliyun'?host:'api.openai.com',key:key||''};
 return {serviceProvider:provider,rerank:provider==='aliyun'&&key?{...common,model:settings?.rerank_model||'qwen3.7-text-rerank'} as ServiceConfig:null,embedding:key?{...common,model:embeddingModel,dimensions:1536 as const,space:`${provider}:${embeddingModel}:1536`,endpoint:provider==='aliyun'?`https://${host}/compatible-mode/v1/embeddings`:'https://api.openai.com/v1/embeddings'} as EmbeddingService:null,ocr:key?{...common,model:ocrModel} as ServiceConfig:null,asr:key?{...common,model:asrModel} as ServiceConfig:null};
}
