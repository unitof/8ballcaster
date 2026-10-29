import worker from '../worker/index.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const origin='https://mixcloud-regex-feed.unitof.chatgpt.site';
for(const pattern of ['correspondence','ephemera']){
 const r=await worker.fetch(new Request(origin+'/feed.xml?regex='+pattern));
 const body=await r.text();
 assert.equal(r.status,200,body);
 fs.writeFileSync('/tmp/'+pattern+'.rss',body);
 const items=[...body.matchAll(/<enclosure url="([^"]+)" length="(\d+)" type="([^"]+)"/g)];
 console.log(pattern,items.length,'playable enclosures');
 assert(items.length>5);
 const enclosure=items[0][1].replaceAll('&amp;','&');
 const head=await worker.fetch(new Request(enclosure,{method:'HEAD'}));
 assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),items[0][2]);
 const play=await worker.fetch(new Request(enclosure));assert.equal(play.status,307);
 const range=await fetch(play.headers.get('Location'),{headers:{Range:'bytes=0-31'},signal:AbortSignal.timeout(25000)});
 const bytes=new Uint8Array(await range.arrayBuffer());
 assert.equal(range.status,206);assert.equal(bytes.length,32);
 console.log(pattern,'HEAD size verified; playback Range 206:',new TextDecoder().decode(bytes.slice(4,8)));
}
for(const query of ['regex=%5B','regex=%28a%2B%29%2B','regex=ephemera&limit=0']){
 const r=await worker.fetch(new Request(origin+'/feed.xml?'+query));assert.equal(r.status,400);
}
console.log('Live feed and audio checks passed');
