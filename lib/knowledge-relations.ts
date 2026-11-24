import {chunkContent,normalizeTags,retrievalQuery} from './knowledge-content';
export type RelationSource={id:string;title:string;content:string;source_hash:string;tags:string[]};
export type RelationEvidence={source_id:string;source_hash:string;quote:string};
export const relationPromptVersion='relation-v1';
export function sharedTopics(a:RelationSource,b:RelationSource){
 const other=new Set(normalizeTags(b.tags).map(t=>t.toLowerCase()));
 return normalizeTags(a.tags).filter(t=>other.has(t.toLowerCase()));
}
export function relationExcerpts(source:RelationSource,other:RelationSource){
 const terms=retrievalQuery([...sharedTopics(source,other),other.title,...other.tags].join(' ')).split(' ').filter(Boolean);
 return chunkContent(source.content,1800,180).map((text,ordinal)=>({text,ordinal,score:terms.filter(t=>text.toLowerCase().includes(t)).length}))
 .sort((a,b)=>b.score-a.score||a.ordinal-b.ordinal).slice(0,2).sort((a,b)=>a.ordinal-b.ordinal).map(p=>p.text);
}
export function validateRelation(value:unknown,sources:RelationSource[]){
 if(!value||typeof value!=='object')throw new Error('关联分析格式无效');
 const result=value as {kind?:unknown;reason?:unknown;evidence?:unknown};
 if(!['related','complement','contradict','none'].includes(String(result.kind))||typeof result.reason!=='string'||!result.reason.trim())throw new Error('关联分析格式无效');
 const evidence:RelationEvidence[]=[];
 for(const entry of Array.isArray(result.evidence)?result.evidence:[]){
  if(!entry||typeof entry!=='object')continue;
  const source=sources.find(s=>s.id===entry.source_id),quote=typeof entry.quote==='string'?entry.quote.trim():'';
  if(source&&quote.length>=8&&quote.length<=500&&source.content.includes(quote))evidence.push({source_id:source.id,source_hash:source.source_hash,quote});
 }
 if(!sources.every(s=>evidence.some(e=>e.source_id===s.id)))throw new Error('关联分析缺少双方可验证的原文证据');
 return {kind:result.kind as 'related'|'complement'|'contradict'|'none',reason:result.reason.trim().slice(0,1200),evidence:sources.flatMap(s=>evidence.filter(e=>e.source_id===s.id).slice(0,3))};
}
