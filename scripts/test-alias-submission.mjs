import test from 'node:test';
import assert from 'node:assert/strict';
import {submitConfirmedSsAlias as submit} from '../sposched-alias-submission.mjs';
const A='11111111-1111-4111-8111-111111111111';
const base={spoken:'よーさん',officialName:'西村',memberId:A,source:'local-video',
 confirmed:true,candidates:[{name:'西村',user_id:A,aliases:['YO']}]};
test('never writes when no authenticated writer is connected',async()=>{
 const result=await submit(base);
 assert.equal(result.saved,false);assert.match(result.reason,/未接続/);
});
test('human selection submits exact alias, official name and stable user ID once',async()=>{
 const calls=[];const result=await submit({...base,writeAlias:async input=>{calls.push(input);return {ok:true}}});
 assert.equal(result.saved,true);
 assert.deepEqual(calls,[{alias:'よーさん',person:'西村',user_id:A}]);
});
test('rejects unconfirmed, conflicting and ID-less nicknames before write',async()=>{
 let calls=0;const writeAlias=async()=>{calls++;return {ok:true}};
 assert.equal((await submit({...base,confirmed:false,writeAlias})).saved,false);
 assert.equal((await submit({...base,spoken:'YO',writeAlias})).saved,false);
 assert.equal((await submit({...base,memberId:null,writeAlias})).saved,false);
 assert.equal(calls,0);
});
test('upstream refusal is never reported as success',async()=>{
 const result=await submit({...base,writeAlias:async()=>({ok:false,error:'denied'})});
 assert.equal(result.saved,false);assert.equal(result.reason,'denied');
});
test('lost reply is uncertain and must never trigger blind retry',async()=>{
 let count=0;
 const result=await submit({...base,writeAlias:async()=>{count++;throw new Error('network outage');}});
 assert.equal(result.saved,false);assert.equal(result.uncertain,true);
 assert.equal(count,1);assert.doesNotMatch(JSON.stringify(result),/network outage/);
});
