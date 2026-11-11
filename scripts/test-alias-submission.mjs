import test from 'node:test';
import assert from 'node:assert/strict';
import {submitConfirmedSsAlias as submit} from '../sposched-alias-submission.mjs';
const base={spoken:'よーさん',officialName:'西村',source:'local-video',confirmed:true,candidates:[{name:'西村',aliases:['YO']}]};
test('never writes when no authenticated writer is connected',async()=>{
 const result=await submit({...base,approved:true});
 assert.equal(result.saved,false);assert.match(result.reason,/未接続/);
});
test('user confirmation submits exact alias and official name once',async()=>{
 const calls=[];const result=await submit({...base,writeAlias:async input=>{calls.push(input);return {ok:true}}});
 assert.equal(result.saved,true);assert.deepEqual(calls,[{alias:'よーさん',person:'西村'}]);
});
test('rejects unconfirmed and conflicting nicknames before write',async()=>{
 let calls=0;const writeAlias=async()=>{calls++;return {ok:true}};
 assert.equal((await submit({...base,confirmed:false,writeAlias})).saved,false);
 assert.equal((await submit({...base,spoken:'YO',writeAlias})).saved,false);
 assert.equal(calls,0);
});
test('upstream refusal is never reported as success',async()=>{
 const result=await submit({...base,writeAlias:async()=>({ok:false,error:'denied'})});
 assert.equal(result.saved,false);assert.equal(result.reason,'denied');
});
