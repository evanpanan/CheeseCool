import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import ipaddr from 'ipaddr.js';
import { webUrl } from './urls';

export function isPublicAddress(address: string) {
  if (!ipaddr.isValid(address)) return false;
  const ip = ipaddr.process(address);
  return ip.range() === 'unicast' && (ip.kind() === 'ipv4' ||
    (ip.toByteArray()[0] & 0xe0) === 0x20);
}

export async function readPublic(input: URL, accepts = 'text/html,application/xhtml+xml') {
  const signal = AbortSignal.timeout(6500);
  let url = input;
  for (let hop = 0; hop <= 5; hop++) {
    url = webUrl(url.href);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (!hostname.includes('.') && !hostname.includes(':')) throw new Error('需要公开域名。');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const addresses = await Promise.race([
      lookup(hostname, { all: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('DNS 超时')), 2500); }),
    ]).finally(() => clearTimeout(timer));
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
      throw new Error('链接必须指向公开网络。');
    }
    const { address, family } = addresses[0];
    const response = await new Promise<{ location?: string; text?: string }>((resolve, reject) => {
      const transport = url.protocol === 'https:' ? https : http;
      const request = transport.get(url, {
        agent: false, family, signal,
        lookup: (_hostname, _options, callback) => callback(null, address, family),
        headers: { 'User-Agent': 'CheeseCool/1.0', Accept: accepts, 'Accept-Encoding': 'identity' },
      }, (res) => {
        const code = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
          res.destroy();
          return resolve({ location: res.headers.location });
        }
        const contentType = res.headers['content-type'] ?? '';
        if (code < 200 || code >= 300 ||
            !/^(text\/html|application\/(xhtml\+xml|json|[^;]+\+json))(;|$)/i.test(contentType) ||
            (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity')) {
          res.destroy();
          return reject(new Error('来源未返回可读取的公开内容。'));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 2_000_000) request.destroy(new Error('来源页面过大。'));
          else chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          const charset = contentType.match(/charset=["']?([\w-]+)/i)?.[1] ?? 'utf-8';
          try { resolve({ text: new TextDecoder(charset).decode(Buffer.concat(chunks)) }); }
          catch { reject(new Error('来源字符编码无法读取。')); }
        });
      });
      request.on('error', reject);
    });
    if (response.location) {
      url = new URL(response.location, url);
      continue;
    }
    return { url, text: response.text ?? '' };
  }
  throw new Error('链接重定向次数过多。');
}

/** DNS-pinned stream; every redirect is revalidated before any bytes are consumed. */
export async function openPublicStream(input:URL,options:{timeoutMs?:number;accept?:string}={}){
 const signal=AbortSignal.timeout(options.timeoutMs||120000);let url=input;
 for(let hop=0;hop<=5;hop++){url=webUrl(url.href);const hostname=url.hostname.replace(/^\[|\]$/g,'');let timer:ReturnType<typeof setTimeout>|undefined;const addresses=await Promise.race([lookup(hostname,{all:true}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('DNS 超时')),2500);})]).finally(()=>clearTimeout(timer));if(!addresses.length||addresses.some(a=>!isPublicAddress(a.address)))throw new Error('链接必须指向公开网络');const {address,family}=addresses[0];
 const response=await new Promise<http.IncomingMessage>((resolve,reject)=>{const req=(url.protocol==='https:'?https:http).get(url,{agent:false,family,signal,lookup:(_h,_o,cb)=>cb(null,address,family),headers:{'User-Agent':'CheeseCool/1.0',Accept:options.accept||'application/pdf,audio/*,video/*,text/html;q=0.5','Accept-Encoding':'identity'}},resolve);req.on('error',reject);});
 if([301,302,303,307,308].includes(response.statusCode||0)&&response.headers.location){response.destroy();url=new URL(response.headers.location,url);continue;}if((response.statusCode||0)<200||(response.statusCode||0)>=300||response.headers['content-encoding']&&response.headers['content-encoding']!=='identity'){response.destroy();throw new Error('公开来源暂不可读取');}return {url,response};
 }throw new Error('链接重定向次数过多');
}
