import test from 'node:test';
import assert from 'node:assert/strict';
import {auditCurrentTestFixtureGates} from '../sposched-gate-audit.mjs';
const ids=[1,2,3,4].map(i=>'11111111-1111-4111-8111-11111111111'+i);
const fixtures=ids.map((matchId,i)=>({seq:i+1,matchId}));
const reply=status=>({environment:'STAGING ONLY',status,
 recovery_available:status==='pending',write_sent:false});
test('inspects the exact four unique match journals without writes',async()=>{
 const called=[];
 const results=await auditCurrentTestFixtureGates([...fixtures].reverse(),async id=>{
  called.push(id);return reply(id===ids[0]?'verified':'idle');
 });
 assert.deepEqual(called,ids);
 assert.equal(results.current_fixtures_clear,true);
 assert.equal(results.verified,1);
 assert.equal(results.idle,3);
 assert.equal(results.all_events_clear,false);
 assert.equal(results.historical_objects_inspected,false);
});
test('pending and rejected receipts block clearance even after 11/11 batch completes',async()=>{
 const r=await auditCurrentTestFixtureGates(fixtures,async id=>
  reply(id===ids[1]?'pending':id===ids[3]?'rejected':'verified'));
 assert.equal(r.current_fixtures_clear,false);
 assert.equal(r.pending,1);
 assert.deepEqual(r.uncertain.map(x=>x.seq),[2,4]);
});
test('fails closed on missing, duplicate or invalid fixture IDs',async()=>{
 for(const invalid of [
  fixtures.slice(1),[fixtures[0],fixtures[0],fixtures[2],fixtures[3]],
  fixtures.map((m,i)=>i===2?{...m,matchId:'bad'}:m)
 ])await assert.rejects(auditCurrentTestFixtureGates(invalid,async()=>reply('idle')));
});
test('fails closed when a journal response is missing or looks like a mutation',async()=>{
 for(const response of [null,{status:'idle',write_sent:false},
  {environment:'STAGING ONLY',status:'idle',write_sent:true},
  {environment:'STAGING ONLY',status:'idle'}]){
  await assert.rejects(auditCurrentTestFixtureGates(fixtures,async()=>response));
 }
});
test('a transport error cannot be interpreted as a clear journal',async()=>{
 await assert.rejects(auditCurrentTestFixtureGates(fixtures,async()=>{
  throw Error('timeout');
 }),/timeout/);
});
