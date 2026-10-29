const TTL = 15 * 60 * 1000;
const cache = new Map();
const inflight = new Map();
const escapeXML = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
async function memo(key, fn, ttl=TTL) {
 const old=cache.get(key); if(old && old.until>Date.now()) return old.value;
 if(inflight.has(key)) return inflight.get(key);
 const p=fn().then(value=>{if(cache.size>1500)cache.clear();cache.set(key,{value,until:Date.now()+ttl});return value}).finally(()=>inflight.delete(key));
 inflight.set(key,p);return p;
}
async function json(url) {
 const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':'MixcloudRegexFeed/1.0'},signal:AbortSignal.timeout(25000)});
 if(!r.ok)throw new Error(`Mixcloud returned ${r.status}`);
 return r.json();
}
export function compileRegex(pattern) {
 if(!pattern || pattern.length>160)throw new Error('Use a regex between 1 and 160 characters.');
 // Keep repeated groups and backreferences out of the synchronous regex engine.
 if(/\)[*+?{]|\\[1-9]|\(\?[=!<]|(?:\.\*|\.\+).*(?:\.\*|\.\+)/.test(pattern))throw new Error('For predictable matching, repeated groups, lookarounds, backreferences and repeated wildcards are unsupported.');
 try{return new RegExp(pattern,'i')}catch{throw new Error('Invalid regular expression.')}
}
export async function catalog() {
 return memo('catalog',async()=>{
  const archive=new Map(SEED.map(x=>[x.key,x]));
  let url='https://api.mixcloud.com/8ballradio/cloudcasts/?limit=100',reached=false;
  for(let page=0;url && page<120;page++){
   const result=await json(url);
   for(const x of result.data){
    if(archive.has(x.key))reached=true;
    archive.set(x.key,{key:x.key,name:x.name,created_time:x.created_time,audio_length:x.audio_length,slug:x.slug,picture:x.pictures?.extra_large});
   }
   if(reached || !result.paging?.next){url=null;break}
   const next=new URL(result.paging.next);
   if(next.origin!=='https://api.mixcloud.com'||next.pathname!=='/8ballradio/cloudcasts/')throw new Error('Unexpected Mixcloud pagination.');
   url=next.href;
  }
  if(url)throw new Error('Archive refresh exceeded the supported pagination limit.');
  return [...archive.values()].sort((a,b)=>Date.parse(b.created_time)-Date.parse(a.created_time));
 });
}
export async function media(slug) {
 return memo('media:'+slug,async()=>{
  const q=`{cloudcastLookup(lookup:{username:"8ballradio",slug:${JSON.stringify(slug)}}){name description restrictedReason streamInfo{url}}}`;
  const data=await json('https://app.mixcloud.com/graphql?'+new URLSearchParams({query:q}));
  if(data.errors)throw new Error('Mixcloud audio lookup failed.');
  const show=data.data?.cloudcastLookup;
  if(!show) return {unavailable:true,reason:'Episode not found'};
  if(show.restrictedReason) return {unavailable:true,reason:show.restrictedReason};
  if(!show.streamInfo?.url) return {unavailable:true,reason:'Mixcloud did not supply a downloadable audio file'};
  const key='IFYOUWANTTHEARTISTSTOGETPAIDDONOTDOWNLOADFROMMIXCLOUD';
  const url=Array.from(atob(show.streamInfo.url),(c,i)=>String.fromCharCode(c.charCodeAt(0)^key.charCodeAt(i%key.length))).join('');
  const target=new URL(url);
  if(target.protocol!=='https:'||!target.hostname.endsWith('.mixcloud.com'))throw new Error('Unexpected audio host.');
  const r=await fetch(url,{method:'HEAD',signal:AbortSignal.timeout(25000)});
  if(!r.ok)throw new Error(`Audio server returned ${r.status}`);
  const length=Number(r.headers.get('content-length'));
  if(!Number.isSafeInteger(length)||length<=0)throw new Error('Audio server did not supply a file size.');
  return {url,length,type:r.headers.get('content-type')?.split(';')[0]||'audio/mp4',description:show.description||'',name:show.name};
 },30*60*1000);
}
async function pool(items, fn, concurrency=5) {
 const results=new Array(items.length);let i=0;
 await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{for(;;){const n=i++;if(n>=items.length)return;results[n]=await fn(items[n])}}));return results;
}
export async function feed(url) {
 const pattern=url.searchParams.get('regex')??'correspondence';
 const regex=compileRegex(pattern);
 const rawLimit=url.searchParams.get('limit')??'100';
 if(!/^\d+$/.test(rawLimit)||Number(rawLimit)<1||Number(rawLimit)>200)throw Object.assign(new Error('limit must be an integer from 1 to 200.'),{status:400});
 return memo('feed:'+url.origin+':'+pattern+':'+rawLimit,async()=>{
  const shows=(await catalog()).filter(x=>regex.test(x.name)).slice(0,Number(rawLimit));
  const loaded=await pool(shows,async x=>({show:x,audio:await media(x.slug)}));
  const blocked=loaded.filter(x=>x.audio.unavailable);
  const entries=loaded.filter(x=>!x.audio.unavailable).map(({show:x,audio:a})=>{
   const audioURL=new URL('/audio/'+encodeURIComponent(x.slug)+'.m4a',url.origin).href;
   const title=escapeXML(x.name),link='https://www.mixcloud.com'+x.key;
   return `<item><title>${title}</title><link>${escapeXML(link)}</link><guid isPermaLink="true">${escapeXML(link)}</guid><pubDate>${new Date(x.created_time).toUTCString()}</pubDate><description>${escapeXML(a.description||x.name)}</description><enclosure url="${escapeXML(audioURL)}" length="${a.length}" type="${escapeXML(a.type)}"/><itunes:author>8 Ball Radio</itunes:author><itunes:duration>${Number(x.audio_length)}</itunes:duration>${x.picture?`<itunes:image href="${escapeXML(x.picture)}"/>`:''}</item>`;
  }).join('\n');
  const self=new URL('/feed.xml',url.origin);self.searchParams.set('regex',pattern);if(rawLimit!=='100')self.searchParams.set('limit',rawLimit);
  const description=`8 Ball Radio episodes with titles matching /${pattern}/i. Up to ${rawLimit} latest matches. Unofficial feed. ${blocked.length?blocked.length+' matching episode(s) omitted because Mixcloud restricts or does not supply their audio.':''}`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${escapeXML('8 Ball Radio · '+pattern)}</title><link>https://www.mixcloud.com/8ballradio/</link><description>${escapeXML(description)}</description><language>en</language><ttl>15</ttl><lastBuildDate>${new Date().toUTCString()}</lastBuildDate><atom:link href="${escapeXML(self.href)}" rel="self" type="application/rss+xml"/><itunes:author>8 Ball Radio</itunes:author><itunes:explicit>true</itunes:explicit><itunes:type>episodic</itunes:type>${shows[0]?.picture?`<itunes:image href="${escapeXML(shows[0].picture)}"/>`:''}\n${entries}\n</channel></rss>`;
 });
}
const HTML=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>8 Ball Radio · Podcast feeds</title><style>*{box-sizing:border-box}body{margin:0;background:#f1f0e9;color:#191b18;font:17px/1.6 ui-monospace,SFMono-Regular,monospace}main{max-width:760px;margin:10vh auto;padding:28px}small{font-size:12px;letter-spacing:.1em;text-transform:uppercase}h1{font:500 clamp(36px,8vw,64px)/1.05 system-ui;letter-spacing:-.05em;margin:28px 0}p{max-width:62ch;color:#55574d}form{border-top:1px solid #afb1a6;padding-top:28px;margin-top:36px}label{display:block;font-size:13px}input{display:block;width:100%;border:1px solid #9b9e90;background:#fffef9;padding:16px;font:inherit;margin:8px 0 16px}button{background:#223b28;color:white;border:0;padding:14px 20px;font:inherit;cursor:pointer}a{color:#223b28;overflow-wrap:anywhere}nav{display:flex;gap:24px;margin:28px 0;flex-wrap:wrap}output{display:block;margin-top:22px}footer{border-top:1px solid #afb1a6;margin-top:48px;padding-top:16px;font:12px/1.6 system-ui;color:#55574d}code{background:#e5e6dc;padding:2px 4px}</style><main><small>8 Ball Radio / Unofficial podcast bridge</small><h1>Find your frequency.</h1><p>Turn a slice of the 8 Ball Radio archive into a podcast feed. Match episode titles with a case-insensitive regular expression.</p><form id="form"><label for="regex">TITLE REGEX · CASE INSENSITIVE</label><input id="regex" name="regex" value="correspondence" required maxlength="160" spellcheck="false"><button>Get feed URL ↗</button><output id="out" aria-live="polite"></output></form><nav><a href="/feed.xml?regex=correspondence">Correspondence ↗</a><a href="/feed.xml?regex=ephemera">Ephemera ↗</a><a href="/feed.xml?regex=correspondence%7Cephemera">Both shows ↗</a></nav><p>Use <code>^ephemera</code> for titles starting with Ephemera, or <code>correspondence|ephemera</code> for either show. Paste the resulting URL into your podcast app’s “Add by URL” option.</p><footer>Checks for new uploads when your podcast app refreshes; results cached for 15 minutes. Latest 100 matches by default; add &amp;limit=200 for more. Repeated groups, lookarounds, backreferences and repeated wildcards are unsupported. Restricted episodes are omitted. Audio plays from Mixcloud’s servers. This service is independent of Mixcloud and 8 Ball Radio.<br><a href="https://www.mixcloud.com/8ballradio/">Listen on Mixcloud ↗</a></footer></main><script>document.getElementById('form').addEventListener('submit',e=>{e.preventDefault();const pattern=document.getElementById('regex').value;const out=document.getElementById('out');try{new RegExp(pattern,'i');const u=new URL('/feed.xml',location.origin);u.searchParams.set('regex',pattern);const a=document.createElement('a');a.href=u.href;a.textContent=u.href;out.replaceChildren(a)}catch{out.textContent='Invalid regular expression.'}})</script></html>`;
export default {async fetch(request){
 const url=new URL(request.url);if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
 try{
  if(url.pathname==='/')return new Response(request.method==='HEAD'?null:HTML,{headers:{'content-type':'text/html; charset=utf-8'}});
  if(url.pathname==='/feed.xml'){
   try{compileRegex(url.searchParams.get('regex')??'correspondence')}catch(e){return new Response(e.message,{status:400})}
   const body=await feed(url);return new Response(request.method==='HEAD'?null:body,{headers:{'content-type':'application/rss+xml; charset=utf-8','cache-control':'public, max-age=900','access-control-allow-origin':'*'}});
  }
  const m=url.pathname.match(/^\/audio\/([a-zA-Z0-9_-]+)\.m4a$/);
  if(m){
   if(!(await catalog()).some(x=>x.slug===m[1]))return new Response('Episode not found',{status:404});
   const a=await media(m[1]);if(a.unavailable)return new Response('Audio unavailable: '+a.reason,{status:404});
   if(request.method==='HEAD')return new Response(null,{headers:{'content-type':a.type,'content-length':String(a.length),'accept-ranges':'bytes','cache-control':'no-store'}});
   return new Response(null,{status:307,headers:{Location:a.url,'cache-control':'no-store'}});
  }
  return new Response('Not found',{status:404});
 }catch(e){return new Response(e.status===400?e.message:'The upstream audio service is unavailable. Please refresh later.',{status:e.status||502,headers:{'cache-control':'no-store'}})}
}};
