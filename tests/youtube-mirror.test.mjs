import test from 'node:test';import assert from 'node:assert/strict';
import {mirrorClips,publishMirror,mirrorDigest} from '../youtube-mirror.mjs';
import {buildMultiClipPlan} from '../multi-plan.mjs';import {goalSourceKey} from '../goal-stats.mjs';
const source=(id,n)=>({id,matchNumber:n,file:{name:id+'.mp4',size:1,lastModified:0},duration:120,bins:[{}],candidates:[{enabled:true,time:10.3,manualEnd:18.6,peakSeconds:14}]});
test('mirror uses final montage ranges and source order with source-local seconds, including merged overlaps',()=>{
 const a=source('a',1),b=source('b',2);a.candidates.push({enabled:true,time:17,manualEnd:22.7,peakSeconds:20});
 const sources=[b,a],plan=buildMultiClipPlan(sources),urls={[goalSourceKey(a)]:'https://youtu.be/-sEOeqqTyuw',[goalSourceKey(b)]:'https://youtu.be/ey1_5PaMvBo'};
 const clips=mirrorClips(sources,plan,urls);assert.deepEqual(clips.map(c=>[c.video,c.start,c.end]),[['ey1_5PaMvBo',10.3,18.6],['-sEOeqqTyuw',10.3,22.7]]);
 assert.throws(()=>mirrorClips(sources,plan,{}),/URL/);assert.throws(()=>mirrorClips(sources,[{sourceId:'a',start:10,end:121}],urls),/範囲/);
});
test('successful share returns the same link on repeated clicks without a second write',async()=>{
 const record={jobs:{}},clips=[{video:'-sEOeqqTyuw',match:'第1試合',start:10.3,end:18.6,label:'ハイライト',scorer:'',assist:''}];let calls=0;
 const options={clips,record,save(){},access:'mock-access',endpoint:'https://mock/share',fetchImpl:async(u,o)=>{calls++;return Response.json({id:await mirrorDigest(o.headers['X-Edit-Key'])})}};
 const first=await publishMirror(options),again=await publishMirror(options);assert.equal(first.id,again.id);assert.equal(calls,1);
});
test('lost response is journaled before write and only inspected, never replayed',async()=>{
 const record={jobs:{}},clips=[{video:'-sEOeqqTyuw',match:'第1試合',start:10.3,end:18.6,label:'ハイライト',scorer:'',assist:''}];let posts=0,gets=0,saved=false;
 const options={clips,record,save(){saved=true},access:'mock',endpoint:'https://mock/share',fetchImpl:async(u,o)=>{if(o.method==='POST'){assert.ok(saved);posts++;throw Error('lost')}gets++;return Response.json({clips})}};
 await assert.rejects(publishMirror(options),/再送/);await publishMirror(options);assert.equal(posts,1);assert.equal(gets,1);
});
test('unknown not-found result stays unknown and later clicks do not write',async()=>{
 const clips=[{video:'-sEOeqqTyuw',match:'x',start:1,end:2,label:'x',scorer:'',assist:''}],signature=await mirrorDigest(JSON.stringify(clips)),record={jobs:{[signature]:{id:'a'.repeat(64),status:'pending'}}};let gets=0;
 const options={clips,record,save(){},access:'',endpoint:'https://mock/share',fetchImpl:async(u,o)=>{assert.equal(o.method,undefined);gets++;return new Response('',{status:404})}};
 await assert.rejects(publishMirror(options),/再送しません/);await assert.rejects(publishMirror(options),/再送しません/);assert.equal(gets,2);assert.equal(record.jobs[signature].status,'pending');
});
test('short-share readiness failure occurs before the pending journal and write; explicit pre-write errors allow correction',async()=>{
 const clips=[{video:'-sEOeqqTyuw',match:'x',start:1,end:2,label:'x',scorer:'',assist:''}],record={jobs:{}};let writes=0;
 await assert.rejects(publishMirror({clips,record,save(){},access:'mock',endpoint:'https://mock/share',requireContract:true,fetchImpl:async()=>Response.json({contract:'old'})}),/保存は開始/);assert.deepEqual(record.jobs,{});
 const opts={clips,record,save(){},access:'mock',endpoint:'https://mock/share',fetchImpl:async()=>{writes++;return Response.json({error:'保存前の接続失敗',write_state:'not_started'},{status:503})}};
 await assert.rejects(publishMirror(opts),/保存前/);assert.deepEqual(record.jobs,{});assert.equal(writes,1);
});
test('pending readback requires merged participants to match and never writes on mismatch',async()=>{
 const clips=[{video:'-sEOeqqTyuw',match:'x',start:1,end:2,label:'x',scorer:'西村・山田',assist:'',participants:['西村','山田']}],signature=await mirrorDigest(JSON.stringify(clips)),record={jobs:{[signature]:{id:'a'.repeat(64),status:'pending'}}};
 await assert.rejects(publishMirror({clips,record,save(){},access:'',endpoint:'https://mock/share',fetchImpl:async(u,o)=>{assert.equal(o.method,undefined);return Response.json({clips:clips.map(({participants,...rest})=>rest)})}}),/再送しません/);assert.equal(record.jobs[signature].status,'pending');
});
