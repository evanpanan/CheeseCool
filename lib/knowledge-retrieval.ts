import type {EvidenceChunk} from './ai';
import {retrievalQuery,normalizeTags} from './knowledge-content';
import type {database} from './supabase';
export type RetrievalCandidate=EvidenceChunk&{lexical_rank?:number|null;semantic_rank?:number|null};

export function expandRetrievalQuery(question:string){
 const base=retrievalQuery(question);
 const aliases=normalizeTags(question.split(/[\s,，、]+/u));
 return [...new Set((base+' '+aliases.map(retrievalQuery).join(' ')).split(' ').filter(Boolean))].join(' ').slice(0,240);
}
/** Deterministic local reranking; no unconfigured external reranker is implied. */
export function rerankEvidence(question:string,candidates:RetrievalCandidate[],limit=8){
 const terms=expandRetrievalQuery(question).split(' ').filter(Boolean),phrase=question.normalize('NFKC').toLowerCase().trim();
 const ranked=candidates.map(chunk=>{
  const text=chunk.content.normalize('NFKC').toLowerCase(),title=chunk.title.normalize('NFKC').toLowerCase();
  const coverage=terms.length?terms.filter(t=>text.includes(t)).length/terms.length:0;
  const titleCoverage=terms.length?terms.filter(t=>title.includes(t)).length/terms.length:0;
  const rank=chunk.score*30+coverage*.65+titleCoverage*.15+(phrase.length>=3&&text.includes(phrase)?.25:0);
  return {...chunk,rerank_score:rank};
 }).sort((a,b)=>b.rerank_score-a.rerank_score||a.chunk_id.localeCompare(b.chunk_id));
 const counts=new Map<string,number>(),seen=new Set<string>(),selected:typeof ranked=[];
 for(const chunk of ranked){
  if((counts.get(chunk.bookmark_id)||0)>=2||seen.has(chunk.content.trim()))continue;
  selected.push(chunk);seen.add(chunk.content.trim());counts.set(chunk.bookmark_id,(counts.get(chunk.bookmark_id)||0)+1);
  if(selected.length>=limit)break;
 }
 return selected;
}
export async function retrieveEvidence(db:Awaited<ReturnType<typeof database>>,question:string,vector:number[]|null,space='openai:text-embedding-3-small:1536'){
 const expanded=await db.rpc('expand_entity_retrieval_query',{query_text:question});if(expanded.error)throw expanded.error;const query=typeof expanded.data==='string'?expanded.data:question;
 const {data,error}=await db.rpc('hybrid_knowledge_candidates_v2',{query_text:expandRetrievalQuery(query),query_embedding:vector?JSON.stringify(vector):null,query_space:space});
 if(error)throw error;
 const candidates=(data||[]) as RetrievalCandidate[];
 const sources=rerankEvidence(question,candidates);
 return {sources,mode:vector?'hybrid':'keyword',ranking:'rrf-local-v1',candidate_count:candidates.length,semantic_matches:candidates.filter(c=>c.semantic_rank!=null).length};
}
