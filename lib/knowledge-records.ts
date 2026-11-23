import {ApiError} from './knowledge-api';
export const recordKinds=['note','journal','ai_conversation','meeting'] as const;
export function prepareRecord(input:Record<string,unknown>){
 const kind=String(input.kind||'note');if(!(recordKinds as readonly string[]).includes(kind))throw new ApiError(400,'记录类型无效');
 let raw=typeof input.content==='string'?input.content:'';let content=raw;
 if(kind==='ai_conversation'&&Array.isArray(input.messages)){
  if(!input.messages.length||input.messages.length>2000)throw new ApiError(400,'对话需包含 1 至 2000 条完整消息');
  const messages=input.messages.map(message=>{if(!message||!['user','assistant','system','developer','tool'].includes(message.role)||(!Object.hasOwn(message,'content')&&!message.tool_calls))throw new ApiError(400,'对话消息格式无效');return message;});
  raw=JSON.stringify({messages});content=messages.map(m=>`[${m.role}]\n${JSON.stringify(m)}`).join('\n\n');
 }
 if(!content.trim()||content.length>500000||Buffer.byteLength(raw)>1800000)throw new ApiError(400,'原件不能为空，正文最多 50 万字符且文件不超过 1.8 MB');
 const title=typeof input.title==='string'&&input.title.trim()?input.title.trim().slice(0,240):content.trim().split('\n')[0].slice(0,60);
 const attributes:Record<string,unknown>={};
 if(kind==='journal'){
  const timezone=typeof input.timezone==='string'?input.timezone:'UTC';try{new Intl.DateTimeFormat('en',{timeZone:timezone});}catch{throw new ApiError(400,'时区无效');}
  if(typeof input.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.date)||(!Number.isFinite(Date.parse(input.date))||new Date(input.date).toISOString().slice(0,10)!==input.date))throw new ApiError(400,'请选择日记日期');
  attributes.date=input.date;attributes.timezone=timezone;
 }
 return {kind,title,content,raw,attributes};
}
