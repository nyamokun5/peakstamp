import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

test('both APIs cold-start as explicit ESM without Node syntax detection or require(ESM)',()=>{
 const root=mkdtempSync(join(tmpdir(),'peakstamp-api-esm-'));
 try{
  // Vercel's Node builder finds the nearest package.json for EACH .js file.
  // A CommonJS parent must not cause api/*.js to be rewritten into require()
  // calls for the shared .mjs prompts (ERR_REQUIRE_ESM in its runtime shim).
  writeFileSync(join(root,'package.json'),JSON.stringify({type:'commonjs'}));
  mkdirSync(join(root,'api'));
  for(const file of ['api/package.json','api/gemini-audio.js','api/gemini-youtube.js',
   'youtube-ps-prompt.mjs','gemini-wav-chunks.mjs'])
   copyFileSync(new URL('../'+file,import.meta.url),join(root,file));
  writeFileSync(join(root,'smoke.mjs'),`
   import assert from 'node:assert/strict';
   let providerCalls=0;
   globalThis.fetch=async()=>{providerCalls++;throw Error('Provider must not be contacted');};
   const invoke=async(handler,method='GET',body)=>{
    const res={headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},
     json(data){this.body=data;return this},end(){return this}};
    await handler({method,headers:{origin:'https://nyamokun5.github.io','content-type':'application/json'},body},res);
    return res;
   };
   const audio=(await import('./api/gemini-audio.js')).default;
   const youtube=(await import('./api/gemini-youtube.js')).default;
   for(const handler of [audio,youtube]){
    const health=await invoke(handler);
    assert.equal(health.code,200);assert.equal(health.body.model,'gemini-3.8-flash');
    assert.equal((await invoke(handler,'OPTIONS')).code,204);
   }
   process.env.GEMINI_API_KEY='synthetic-server-key';process.env.PEAKSTAMP_ACCESS_CODE='synthetic-access';
   const denied=await invoke(youtube,'POST',{videoId:'-sEOeqqTyuw',mode:'duration'});
   assert.equal(denied.code,401);assert.equal(providerCalls,0);
   console.log('Explicit API module scope: cold starts and read-only health passed');
  `);
  const output=execFileSync(process.execPath,['--no-experimental-detect-module',
   '--no-experimental-require-module',join(root,'smoke.mjs')],{encoding:'utf8',timeout:10000});
  assert.match(output,/cold starts and read-only health passed/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
