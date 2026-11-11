import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveGoalIdentities,chooseIdentity} from '../sposched-name-resolution.mjs';
const player={name:'正式氏名',player_id:'uuid-1'};
test('calls resolver for both scorer and assist before goal submit',async()=>{
 const calls=[];
 const r=await resolveGoalIdentities({scorer:'たっちゃん',assist:'よーさん',team:'T1',
  resolveMember:async arg=>{calls.push(arg);return {confirmed:true,player_id:'uuid-1',candidates:[player]}}});
 assert.deepEqual(calls.map(x=>x.role),['scorer','assist']);
 assert.equal(r.canSubmit,true);
 assert.equal(r.scorer.name,'正式氏名');
});
test('ambiguous scorer requires manual selection',async()=>{
 const r=await resolveGoalIdentities({scorer:'たっちゃん',resolveMember:async()=>({candidates:[player]})});
 assert.equal(r.canSubmit,false);
 assert.equal(chooseIdentity(r.scorer,'uuid-1').name,'正式氏名');
});
test('unresolved assist blocks silent misattribution',async()=>{
 const r=await resolveGoalIdentities({scorer:'A',assist:'B',resolveMember:async({role})=>
 role==='scorer'?{confirmed:true,player_id:'uuid-1',candidates:[player]}:{candidates:[]}});
 assert.equal(r.canSubmit,false);
});
test('no assist is accepted without a second resolver call',async()=>{
 let calls=0;
 const r=await resolveGoalIdentities({scorer:'A',resolveMember:async()=>{calls++;return {confirmed:true,player_id:'uuid-1',candidates:[player]}}});
 assert.equal(calls,1);assert.equal(r.canSubmit,true);
});
test('unknown player IDs cannot be manually injected',()=>{
 assert.throws(()=>chooseIdentity({status:'unresolved',candidates:[player]},'other'),/名簿/);
});


test('two たいせい identities override an upstream preferred candidate',async()=>{
 const players=[
  {name:'たいせいA',player_id:'player-a',team:'チーム1'},
  {name:'たいせいB',player_id:'player-b',team:'チーム2'}
 ];
 const resolveMember=async()=>({
  confirmed:true,player_id:'player-a',candidates:players
 });
 const result=await resolveGoalIdentities({scorer:'たいせい',resolveMember});
 assert.equal(result.canSubmit,false,'do not trust preferred match when 2 people share a nickname');
 assert.equal(result.scorer.status,'unresolved');
 assert.equal(result.scorer.candidates.length,2);
 assert.equal(chooseIdentity(result.scorer,'player-b').player_id,'player-b');
});
