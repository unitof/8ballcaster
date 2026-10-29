import fs from 'node:fs';
const seed=JSON.parse(fs.readFileSync('catalog.json','utf8'));
fs.writeFileSync('worker/index.js','// Initial archive snapshot; current uploads refresh at request time.\nconst SEED='+JSON.stringify(seed)+';\n'+fs.readFileSync('worker/runtime.js','utf8'));
