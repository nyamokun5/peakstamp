import test from 'node:test';
import assert from 'node:assert/strict';
import handler,{PROMPT_REVISION} from '../api/gemini-audio.js';
test('public version is read-only, returns no secrets and rejects unrelated origins',async()=>{
 const invoke=async origin=>{
  const result={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
  await handler({method:'GET',headers:{origin}},result);return result;
 };
 const result=await invoke('https://nyamokun5.github.io');
 assert.equal(result.code,200);
 assert.deepEqual(result.body,{service:'peakstamp-gemini-api',model:'gemini-3.8-flash',promptRevision:PROMPT_REVISION});
 assert.equal(result.headers['Access-Control-Allow-Origin'],'https://nyamokun5.github.io');
 assert.equal((await invoke('https://unrelated.invalid')).code,403);
});
