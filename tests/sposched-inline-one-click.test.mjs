import test from 'node:test';
import assert from 'node:assert/strict';
import {runOneClickKnockout} from '../sposched-inline-one-click.mjs';
const id='11111111-1111-4111-8111-111111111111';
const req='22222222-2222-4222-8222-222222222222';
const job={event_id:id,request_id:req,status:'awaiting_second_round',completed:2,total:2};
const make=overrides=>({
 start:async()=>({event_id:id,request_id:req}),
 inspect:async()=>job,
 refreshOfficial:async()=>({eventId:id}),
 buildSecond:async()=>({event_id:id,request_id:req,confirm:'TEST-ONLY BATCH APPEND',operations:[]}),
 append:async()=>({event_id:id,request_id:req,status:'running'}),
 verifyCurrent:async()=>{},
 wait:async()=>{},
 ...overrides
});
test('one click starts once, refreshes official snapshot and appends once',async()=>{
 const calls=[];
 const result=await runOneClickKnockout(make({
 start:async()=>{calls.push('start');return {event_id:id,request_id:req}},
 inspect:async()=>{calls.push('inspect');return job},
 refreshOfficial:async()=>{calls.push('refresh');return {eventId:id}},
 buildSecond:async()=>{calls.push('build');return {event_id:id,request_id:req,confirm:'TEST-ONLY BATCH APPEND'}},
 append:async()=>{calls.push('append');return {event_id:id,request_id:req,status:'running'}}
 }));
 assert.equal(result.status,'running');
 assert.deepEqual(calls,['start','inspect','refresh','build','append']);
});
test('blocked job never appends',async()=>{
 let appended=false;
 await assert.rejects(runOneClickKnockout(make({
 inspect:async()=>({...job,status:'blocked'}),
 append:async()=>{appended=true}
 })),/停止/);
 assert.equal(appended,false);
});
test('unconfirmed event cannot append',async()=>{
 let appended=false;
 await assert.rejects(runOneClickKnockout(make({
 inspect:async()=>({...job,event_id:'other'}),
 append:async()=>{appended=true}
 })),/一致しません/);
 assert.equal(appended,false);
});
