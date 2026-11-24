import {readPublic} from './public-http';

type Read=(url:URL,accept?:string)=>Promise<{text:string}>;
const clean=(v:unknown,max=240)=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,max):'';
const cap=(value:string,max=500000)=>Array.from(value).slice(0,max).join('');
const author=(v:any)=>clean(v?.user?.login||'deleted-user',100);
const jsonAccept='application/vnd.github+json';
/** Public GitHub API only. The injected reader has the same DNS-pinned, bounded contract. */
export async function githubSource(url:URL,read:Read=readPublic){
 if(url.hostname!=='github.com')return null;
 const parts=url.pathname.split('/').filter(Boolean);if(parts.length<2||!parts.slice(0,2).every(p=>/^[\w.-]+$/.test(p)))return null;
 const base=`https://api.github.com/repos/${parts[0]}/${parts[1]}`,archive:{url:string;data:unknown}[]=[];
 async function get(path:string){const endpoint=new URL(base+path);const response=await read(endpoint,jsonAccept),data=JSON.parse(response.text);archive.push({url:endpoint.href,data});return data;}
 if(parts.length===2){
  const [repository,readmeResult]=await Promise.allSettled([get(''),get('/readme')]);if(repository.status!=='fulfilled')return null;
  const repo=repository.value,readme=readmeResult.status==='fulfilled'?readmeResult.value:null;
  const text=readme?.encoding==='base64'&&typeof readme.content==='string'?Buffer.from(readme.content,'base64').toString('utf8'):'';
  const body=[repo.description,repo.language,Array.isArray(repo.topics)?repo.topics.join(', '):'',text].filter(Boolean).join('\n\n');
  return {title:clean(repo.full_name),summary:clean(repo.description||text,420),content:cap(body),cover_url:null,raw_source:JSON.stringify(archive),media_type:'application/json',capture_scope:text?'repository':'repository_metadata',source_truncated:body.length>500000};
 }
 if(['issues','pull'].includes(parts[2])&&/^\d+$/.test(parts[3]||'')&&parts.length===4){
  const number=parts[3],issue=await get('/issues/'+number);if(typeof issue.title!=='string'||typeof issue.html_url!=='string')return null;
  let partial=false;const errors:string[]=[];
  async function comments(path:string,total?:number){const rows:any[]=[];if(total===0)return rows;
   for(let page=1;page<=3;page++){
    try{const data=await get(path+`?per_page=100&page=${page}`);if(!Array.isArray(data))throw new Error('Invalid comments');rows.push(...data);if(data.length<100||total!==undefined&&rows.length>=total)return rows;}
    catch{partial=true;errors.push(path+':page-'+page);return rows;}
   }
   partial=true;return rows;
  }
  const ordinary=await comments('/issues/'+number+'/comments',typeof issue.comments==='number'?issue.comments:undefined);
  let inline:any[]=[],reviews:any[]=[];
  if(issue.pull_request){[inline,reviews]=await Promise.all([comments('/pulls/'+number+'/comments'),comments('/pulls/'+number+'/reviews')]);}
  const render=(row:any,label:string)=>[`## ${label} · ${author(row)} · ${clean(row.created_at||row.submitted_at,80)}`,clean(row.html_url,2048),row.path?`文件：${clean(row.path,600)}${Number.isInteger(row.line)?' · 行 '+row.line:''}`:'',row.state?'评审状态：'+clean(row.state,80):'',typeof row.body==='string'?row.body:''].filter(Boolean).join('\n\n');
  const body=[`# ${issue.title}`,`作者：${author(issue)}\n创建时间：${clean(issue.created_at,80)}\n状态：${clean(issue.state,40)}\n来源：${issue.html_url}`,typeof issue.body==='string'?issue.body:'',...ordinary.map(r=>render(r,'评论')),...reviews.map(r=>render(r,'评审')),...inline.map(r=>render(r,'代码评论'))].filter(Boolean).join('\n\n');
  const full=cap(body);return {title:clean(`${parts[0]}/${parts[1]} #${number} ${issue.title}`),summary:clean(issue.body||issue.title,420),content:full,cover_url:null,raw_source:JSON.stringify({responses:archive,failed_pages:errors}),media_type:'application/json',capture_scope:(issue.pull_request?'pull_request_discussion':'issue')+(partial?'_partial':''),source_truncated:partial||full.length<body.length};
 }
 if(parts[2]==='blob'&&parts.length>=5){
  const ref=decodeURIComponent(parts[3]),path=parts.slice(4).map(decodeURIComponent);
  if(path.some(p=>!p||p==='.'||p==='..')||!ref)return null;
  const file=await get('/contents/'+path.map(encodeURIComponent).join('/')+'?ref='+encodeURIComponent(ref));
  if(file.type!=='file'||file.encoding!=='base64'||typeof file.content!=='string'||file.size>1000000)return null;
  const bytes=Buffer.from(file.content,'base64');if(bytes.length>1000000||typeof file.size==='number'&&bytes.length!==file.size||bytes.includes(0))return null;
  let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return null;}
  if(!text.trim())return null;
  const body=`# ${parts[0]}/${parts[1]} · ${path.join('/')}\n\n版本：${ref}\n文件 SHA：${clean(file.sha,100)}\n来源：${url.href}\n\n${text}`;
  return {title:clean(`${path.join('/')} · ${parts[0]}/${parts[1]}`),summary:clean(text,420),content:cap(body),cover_url:null,raw_source:JSON.stringify(archive),media_type:'application/json',capture_scope:'repository_file',source_truncated:body.length>500000};
 }
 return null;
}
