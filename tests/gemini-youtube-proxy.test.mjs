import test from 'node:test';
import assert from 'node:assert/strict';
import handler,{normalizeYouTubeAnalysis} from '../api/gemini-youtube.js';
import peakStampPrompt from '../youtube-ps-prompt.mjs';
import {MAX_GEMINI_DURATION_SECONDS} from '../gemini-wav-chunks.mjs';

const videoId='-sEOeqqTyuw',origin='https://nyamokun5.github.io';
function setup(t){
 const saved={key:process.env.GEMINI_API_KEY,access:process.env.PEAKSTAMP_ACCESS_CODE};
 process.env.GEMINI_API_KEY='server-only-google-key';process.env.PEAKSTAMP_ACCESS_CODE='existing-access-code';
 t.after(()=>{for(const [k,v] of [['GEMINI_API_KEY',saved.key],['PEAKSTAMP_ACCESS_CODE',saved.access]])
  if(v===undefined)delete process.env[k];else process.env[k]=v;});
 const invoke=async(body,options={})=>{
  const response={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},
   json(data){this.body=data;return this;},end(){return this;}};
  await handler({method:options.method||'POST',headers:{origin,'content-type':'application/json',
   'x-peakstamp-access':'existing-access-code',...options.headers},body},response);return response;
 };
 return {invoke};
}
const answer=data=>Response.json({candidates:[{content:{parts:[{thought:true,text:'must not parse thoughts'},
 {text:JSON.stringify(data)}]}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:30}});

test('duration and PS analysis use server key, canonical YouTube URI and fixed prompts',async t=>{
 const {invoke}=setup(t),requests=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  requests.push({url,options,body:JSON.parse(options.body)});
  return requests.length===1?answer({duration:900}):answer({events:[{reaction_time_seconds:12,type:'goal_reaction',quote:'ゴール'}],
   utterances:[{time_seconds:18,kind:'goal_call',quote:'たつおさんソロかな',scorer:'たつお',assist:null,confidence:'low'}]});
 });
 const duration=await invoke({videoId,mode:'duration'});
 assert.equal(duration.code,200);assert.equal(duration.body.duration,900);
 const analyzed=await invoke({videoId,mode:'highlights',durationSeconds:900});
 assert.equal(analyzed.code,200);assert.equal(analyzed.body.duration_seconds,900);
 assert.equal(analyzed.body.events[0].reaction_time_seconds,12);
 assert.equal(analyzed.body.utterances[0].scorer,'たつお');assert.equal(analyzed.body.utterances[0].confidence,'low');
 assert.equal(analyzed.body.meta.source,'youtube');
 assert.equal(requests.length,2);
 for(const request of requests){
  assert.equal(request.url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
  assert.equal(request.options.headers['x-goog-api-key'],'server-only-google-key');
  assert.equal(request.body.contents[0].parts[0].fileData.fileUri,'https://www.youtube.com/watch?v='+videoId);
  assert.equal(request.options.redirect,'error');
 }
 assert.equal(requests[1].body.contents[0].parts[1].text,peakStampPrompt(900));
 assert.deepEqual(requests[1].body.contents[0].parts[0].videoMetadata,{startOffset:'0s',endOffset:'900s'},
  'the provider is constrained to the approved bounded interval, not the entire untrusted URL duration');
 assert.equal(JSON.stringify(analyzed.body).includes('server-only-google-key'),false);
 assert.equal(JSON.stringify(analyzed.body).includes('existing-access-code'),false);
});
test('authentication, CORS, input allowlist and 30-minute limit reject before paid request',async t=>{
 const {invoke}=setup(t);let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('unexpected');});
 assert.equal((await invoke({videoId,mode:'duration'},{headers:{origin:'https://evil.example'}})).code,403);
 assert.equal((await invoke({videoId,mode:'duration'},{headers:{'x-peakstamp-access':'wrong'}})).code,401);
 assert.equal((await invoke({videoId,mode:'duration'},{headers:{'content-type':'text/plain'}})).code,415);
 for(const body of [null,[],{videoId:'https://evil.example',mode:'duration'},
  {videoId,mode:'duration',prompt:'arbitrary paid request'},{videoId,mode:'duration',apiKey:'browser-key'},
  {videoId,mode:'duration',durationSeconds:1},{videoId,mode:'anything'},
  {videoId,mode:'highlights',durationSeconds:'900'},
  {videoId,mode:'highlights',durationSeconds:0},{videoId,mode:'highlights',durationSeconds:1800.01}])
  assert.equal((await invoke(body)).code,400);
 assert.equal(calls,0);
});
test('public version and preflight perform no provider calls and contain no secrets',async t=>{
 const {invoke}=setup(t);t.mock.method(globalThis,'fetch',async()=>{throw Error('must not fetch');});
 const version=await invoke(undefined,{method:'GET'});
 assert.equal(version.code,200);assert.equal(version.body.maxDurationSeconds,MAX_GEMINI_DURATION_SECONDS);
 assert.equal(version.body.promptRevision,'phonetic-hiragana-20261112-v1');
 assert.equal(version.headers['Access-Control-Allow-Origin'],origin);
 assert.equal((await invoke(undefined,{method:'OPTIONS'})).code,204);
 assert.equal((await invoke(undefined,{method:'DELETE'})).code,405);
 delete process.env.GEMINI_API_KEY;
 assert.equal((await invoke({videoId,mode:'duration'})).code,503);
});
test('duration over 30 minutes is returned but highlights stops before another paid call',async t=>{
 const {invoke}=setup(t);let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return answer({duration:3600});});
 const duration=await invoke({videoId,mode:'duration'});
 assert.equal(duration.code,200);assert.equal(duration.body.duration,3600);
 assert.equal((await invoke({videoId,mode:'highlights',durationSeconds:duration.body.duration})).code,400);
 assert.equal(calls,1);
});
test('upstream rejection, timeout and invalid results never retry or expose provider errors',async t=>{
 const {invoke}=setup(t);let calls=0,mode;
 t.mock.method(globalThis,'fetch',async()=>{calls++;
  if(mode==='timeout')throw Object.assign(Error('server-only-google-key'),{name:'TimeoutError'});
  if(typeof mode==='number')return new Response('server-only-google-key',{status:mode});
  if(mode==='bad-json')return new Response('not JSON');
  if(mode==='missing-arrays')return answer({events:[]});
  if(mode==='bad-duration')return answer({duration:null});
  return answer({events:[],utterances:[]});
 });
 for(const [value,status] of [[429,429],[403,502],[500,502],['timeout',504],['bad-json',502],['missing-arrays',502]]){
  mode=value;const response=await invoke({videoId,mode:'highlights',durationSeconds:60});
  assert.equal(response.code,status);assert.equal(JSON.stringify(response.body).includes('server-only-google-key'),false);
 }
 mode='bad-duration';assert.equal((await invoke({videoId,mode:'duration'})).code,502);
 assert.equal(calls,7);
});
test('normalizer keeps tentative phonetic calls and rejects fabricated or invalid time rows',()=>{
 const normalized=normalizeYouTubeAnalysis({events:[{reaction_time_seconds:null},{reaction_time_seconds:1900},
  {reaction_time_seconds:3,type:'unknown',quote:'ゴール',suggested_clip_start_seconds:-5,suggested_clip_end_seconds:2000}],
  utterances:[{time_seconds:15,kind:'goal_call',quote:'たつおさんソロかな',scorer:'たつお',confidence:'low'},
   {time_seconds:-1,kind:'goal_call',quote:'invalid'},{time_seconds:1900,kind:'goal_call',quote:'outside'}]},1800);
 assert.equal(normalized.events.length,1);assert.equal(normalized.events[0].type,'uncertain');
 assert.equal(normalized.events[0].suggested_clip_start_seconds,0);assert.equal(normalized.events[0].suggested_clip_end_seconds,1800);
 assert.equal(normalized.utterances.length,1);assert.equal(normalized.utterances[0].scorer,'たつお');
 assert.equal(normalized.utterances[0].assist,null);assert.equal(normalized.utterances[0].confidence,'low');
 assert.throws(()=>normalizeYouTubeAnalysis({events:[]},60));
});
