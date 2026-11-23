const aliases: Record<string,string> = {
 'ui':'界面设计','ui设计':'界面设计','ui组件':'界面组件','react组件':'界面组件',
 '用户界面':'界面设计','人工智能':'人工智能','ai':'人工智能','ai工具':'AI工具',
 'ui组件库':'界面组件','ai界面组件':'界面组件','微交互':'交互动画','动画库':'交互动画','ai动效库':'交互动画','动态图形':'交互动画','动画性能优化':'交互动画','首屏动效':'交互动画','交互网页设计':'界面设计','ai代理':'智能体','ai设计工具':'AI工具',
 '前端':'前端开发','前端技术':'前端开发','动画':'交互动画','动效':'交互动画',
};
export function normalizeTags(values: unknown): string[] {
 if(!Array.isArray(values))return [];
 return [...new Set(values.filter((x):x is string=>typeof x==='string').map(x=>x.normalize('NFKC').trim().replace(/^#+/,'').slice(0,24)).filter(Boolean).map(x=>aliases[x.toLowerCase()]||x))].slice(0,8);
}
export function chunkContent(text:string,size=1800,overlap=180) {
 const chars=Array.from(text);const chunks:string[]=[];
 for(let start=0;start<chars.length;start+=size-overlap){const part=chars.slice(start,start+size).join('').trim();if(part)chunks.push(part);if(start+size>=chars.length)break;}
 return chunks;
}
export function validEvidence(content:string,values:unknown):string[]{
 if(!Array.isArray(values))return [];
 return [...new Set(values.filter((x):x is string=>typeof x==='string'&&x.trim().length>=8&&content.includes(x.trim())).map(x=>x.trim().slice(0,500)))].slice(0,5);
}

export function retrievalQuery(question:string){
 const words=question.normalize('NFKC').toLowerCase().match(/[a-z\d_-]{2,}|[\u4e00-\u9fff]{2,}/g)||[];
 const stop=new Set(['如何','什么','哪些','可以','我的','我们','这个','那个','一个','以及','有关','介绍','一下','有没有']);
 const terms=words.flatMap(word=>/[\u4e00-\u9fff]/.test(word)?[word,...Array.from({length:Math.max(0,word.length-1)},(_,i)=>word.slice(i,i+2))]:[word]);
 return [...new Set(terms.filter(t=>!stop.has(t)))].join(' ').slice(0,240);
}
