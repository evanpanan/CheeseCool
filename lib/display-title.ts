/** Display aliases never replace archived titles, source content or search text. */
export const nodeTitleLimit=14;
export function nodeTitleWidth(value:string){return Array.from(value).reduce((n,char)=>n+(/[\x00-\x7f]/u.test(char)?.5:1),0);}
export function fitsNodeTitle(value:string){return Array.from(value).length<=28&&nodeTitleWidth(value)<=nodeTitleLimit;}
function boundedTitle(value:string){
 if(fitsNodeTitle(value))return value;
 // Temporary fallback while a semantic alias is generated. Prefer whole words.
 const words=[...new Intl.Segmenter('zh',{granularity:'word'}).segment(value)].map(item=>item.segment);
 let result='';for(const word of words){if(!fitsNodeTitle(result+word+'…'))break;result+=word;}
 if(!result)for(const char of Array.from(value)){if(!fitsNodeTitle(result+char+'…'))break;result+=char;}
 return result.trimEnd()+'…';
}
export function displayTitle(title:string,recordType='web',platform='web',tags:string[]=[]):string{
 const clean=title.replace(/\s+/gu,' ').trim();
 if(recordType!=='web')return boundedTitle(clean);
 const leading=clean.split(/\s*[|｜]\s*|\s+[—–·]\s+|\s+-\s+/u)[0].trim();
 const name=Array.from(leading).length>=3?leading:clean;
 if(fitsNodeTitle(name))return name;
 // Explicit book/work names are useful complete subjects, unlike a chopped sentence.
 const work=name.match(/[《「『]([^》」』]{2,28})[》」』]/u)?.[1];
 if(work&&fitsNodeTitle(work))return work;
 const phrases=name.replace(/^(?:万字|深度|完整|一文)?(?:解读|解析|详解)[：:\s]*/u,'').split(/[：:，,。！？!?；;]/u).map(part=>part.trim());
 const subject=phrases.find(part=>Array.from(part).length>=3&&fitsNodeTitle(part));
 if(subject)return subject;
 if(platform==='x'&&tags[0]&&fitsNodeTitle(tags[0]+' · 推文'))return tags[0]+' · 推文';
 return boundedTitle(name);
}

export function homepageTitle(title:string){
 const name=title.replace(/^(?:home(?:page)?|首页|主页)\s*[-—|:：]?\s+/iu,'').replace(/\s*[-—|:：]\s*(?:home(?:page)?|首页|主页)$/iu,'').trim();
 const short=displayTitle(name);return Array.from(short).length<3?short+' 官网':short;
}
