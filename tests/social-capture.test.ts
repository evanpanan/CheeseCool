import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {socialPage,youtubeSource,youtubeId} from '../lib/social-source';
import {extract,extractHtml} from '../lib/extract';
import {identify} from '../lib/urls';
import {orbitDocument} from '../lib/orbit-document';
const video='dQw4w9WgXcQ',url=new URL('https://www.youtube.com/watch?v='+video);
function page(state:string,name='ytInitialPlayerResponse'){return new JSDOM('<title>- YouTube</title><script>var '+name+' = '+state+';</script>');}
test('video-specific public state replaces platform boilerplate without reading recommendations or executing scripts',()=>{
 const details={videoId:video,title:'具体视频的主题',shortDescription:'本期讲解知识管理的三个步骤\n第一步建立来源',author:'作者',thumbnail:{thumbnails:[{url:'https://i.ytimg.com/a.jpg'}]}};
 const html='<title>- YouTube</title><meta name="description" content="Enjoy the videos and music you love"><script>var ytInitialPlayerResponse = '+JSON.stringify({videoDetails:details,recommendations:{title:'其他视频'}})+'; throw new Error("never execute")</script>';
 const result=extractHtml(html,url);assert.equal(result.title,details.title);assert.equal(result.capture,'video_description_partial');assert(result.content.includes(details.shortDescription));assert(!result.content.includes('其他视频'));assert(!result.content.includes('Enjoy the videos'));
 const mismatch=page(JSON.stringify({videoDetails:{...details,videoId:'wrong'}}));try{assert.equal(socialPage(mismatch.window.document,url),null);}finally{mismatch.window.close();}
 assert.equal(extractHtml('<title>- YouTube</title><meta name="description" content="Enjoy the videos and music you love">',url).capture,'blocked');
});
test('oembed recovers a specific video title and author with an honest metadata-only scope',async()=>{
 let request='';const result=await youtubeSource(new URL('https://youtu.be/'+video),async u=>{request=u.href;return {text:JSON.stringify({type:'video',title:'真正的视频标题',author_name:'具体作者',thumbnail_url:'https://i.ytimg.com/x.jpg'})};});assert(result);assert.equal(result.capture_scope,'video_metadata_only');assert(result.content.includes('具体作者'));assert(!result.content.includes('提供视频'));assert(new URL(request).searchParams.get('url')?.endsWith(video));
 assert.equal(youtubeId(new URL('https://youtube.com.attacker.example/watch?v='+video)),null);assert.equal(youtubeId(new URL('https://www.youtube.com/shorts/'+video)),video);
});
test('Xiaohongshu short links are identified and hydration selects only the matching public note',()=>{
 assert.equal(identify(new URL('https://xhslink.cn/a/123')),'xiaohongshu');const id='64a123456789abcdef012345';const note={noteId:id,title:'具体笔记主题',desc:'这里是这篇笔记的正文\n而不是平台简介',user:{nickname:'笔记作者'}};
 const dom=page(JSON.stringify({note:{noteDetailMap:{[id]:{note},other:{note:{...note,noteId:'other',desc:'无关推荐'}}}},unavailable:null}).replace('"unavailable":null','"unavailable":undefined'),'__INITIAL_STATE__');try{const result=socialPage(dom.window.document,new URL('https://www.xiaohongshu.com/explore/'+id));assert.equal(result?.title,note.title);assert(result?.content.includes(note.desc));assert(!result?.content.includes('无关推荐'));assert.equal(socialPage(dom.window.document,new URL('https://www.xiaohongshu.com/explore/64b123456789abcdef012345')),null);}finally{dom.window.close();}
});
test('the canvas disables native selection and callout while detail text stays selectable',()=>{
 assert(orbitDocument.includes('html,body,main,canvas,.filters,.controls,.panel{user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}'));
 assert(orbitDocument.includes('.detail-page-text,.detail-summary{user-select:text;-webkit-user-select:text;-webkit-touch-callout:default}'));
});

test('the full extractor prefers a concrete description, falls back to public video metadata and never summarizes a platform shell',async()=>{
 for(const rich of [false,true]){
 const result=await extract(url,undefined,async input=>({url:input,text:input.pathname==='/oembed'?JSON.stringify({type:'video',title:'具体视频',author_name:'作者'}):'<title>- YouTube</title><meta name="description" content="Enjoy the videos and music you love">'+(rich?'<script>var ytInitialPlayerResponse='+JSON.stringify({videoDetails:{videoId:video,title:'更完整标题',shortDescription:'从视频页面采集的具体内容介绍',author:'作者'}})+'</script>':''),notModified:false,etag:undefined,lastModified:undefined}));
 assert(result.data);assert.equal(result.completeness,rich?'video_description_partial':'video_metadata_only');assert.equal(result.data.title,rich?'更完整标题':'具体视频');assert(!result.data.content.includes('Enjoy the videos'));assert(result.source?.raw.includes(rich?'videoDetails':'author_name'));
 }
});
