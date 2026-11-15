import test from 'node:test';import assert from 'node:assert/strict';
import {followInlineRegistration,verifyInlineCompletion,appendInlineOnce} from '../sposched-inline-progress.mjs';
const snapshot=()=>({eventId:'e',matches:[1,2,3,4].map(seq=>({seq,matchId:'m'+seq,status:'finished',leftScore:0,rightScore:0,existingGoals:[]}))});
const job=(status='completed')=>({event_id:'e',request_id:'r',status,completed:8,total:8,fixture_ids:{1:'m1',2:'m2',3:'m3',4:'m4'},goal_receipts:[]});
const defaults=()=>({initial:job('running'),inspect:async()=>job(),refreshOfficial:async()=>snapshot(),verifyCurrent:()=>{},wait:async()=>{}});
test('automatic stage continuation once, then official completion',async()=>{
 let append=0,complete=0,reads=0;
 await followInlineRegistration({...defaults(),initial:job('awaiting_second_round'),
  continueSecond:async()=>{append++;return job('running')},refreshOfficial:async()=>{reads++;return snapshot()},onComplete:()=>complete++});
 assert.equal(append,1);assert.equal(complete,1);assert.equal(reads,2);
});
test('read-only inspection cannot append or silently answer tie',async()=>{
 let choices=0,complete=0;
 for(const status of ['awaiting_second_round','needs_decision'])await followInlineRegistration({...defaults(),initial:job(status),onDecision:()=>choices++,onComplete:()=>complete++});
 assert.equal(choices,1);assert.equal(complete,0);
});
test('changed job, stopped job, timeout and changed event never complete',async()=>{
 for(const overrides of [{inspect:async()=>({...job(),request_id:'other'})},{initial:job('blocked')},{maxChecks:1,inspect:async()=>job('running')},{verifyCurrent:()=>{throw Error('event changed')}}]){
 let done=0;await assert.rejects(followInlineRegistration({...defaults(),...overrides,onComplete:()=>done++}));assert.equal(done,0);
 }
});
test('completion requires exact finished fixtures and official goal receipts',()=>{
 for(const mutate of [s=>s.matches[0].matchId='old',s=>s.matches[3].status='scheduled',s=>s.matches[0].leftScore=null]){const s=snapshot();mutate(s);assert.throws(()=>verifyInlineCompletion(job(),s));}
 const j=job();j.goal_receipts=[{official_goal_id:'g',official_match_id:'m1'}];
 assert.throws(()=>verifyInlineCompletion(j,snapshot()));
 const s=snapshot();s.matches[0].existingGoals=[{id:'g'}];assert.equal(verifyInlineCompletion(j,s),true);
 s.matches[1].existingGoals=[{id:'g'}];assert.throws(()=>verifyInlineCompletion(j,s));
});
test('lost append reply stays locked across restarts; acknowledged append also cannot repeat',async()=>{
 for(const lost of [true,false]){
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};let writes=0;
 const opts={plan:{event_id:'e',request_id:'r',confirm:'TEST-ONLY BATCH APPEND'},storage,send:async()=>{writes++;if(lost)throw Error('lost');return job('running')}};
 if(lost)await assert.rejects(appendInlineOnce(opts));else await appendInlineOnce(opts);
 await assert.rejects(appendInlineOnce(opts));assert.equal(writes,1);
 }
});
test('failed official readback never announces success',async()=>{
 let done=0;await assert.rejects(followInlineRegistration({...defaults(),initial:job(),refreshOfficial:async()=>{throw Error('offline')},onComplete:()=>done++}));assert.equal(done,0);
});
