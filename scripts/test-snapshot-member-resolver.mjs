import test from 'node:test';
import assert from 'node:assert/strict';
import {createSnapshotMemberResolver} from '../sposched-snapshot-member-resolver.mjs';
import {prepareGoalIdentityForRegistration} from '../sposched-goal-identity-gate.mjs';
import {normalizeSpoSnapshot} from '../sposched-review-core.mjs';
const snapshot={players:['田中太郎'],playerTeam:new Map([['田中太郎','T1']]),playerIds:new Map([['田中太郎','official-id']])};
test('snapshot adapter never automatically confirms a fuzzy match',async()=>{
 const resolveMember=createSnapshotMemberResolver(snapshot);
 const response=await resolveMember({query:'田中太郎',team:'T1'});
 assert.equal(response.confirmed,false);
 const r=await prepareGoalIdentityForRegistration({source:'local-video',scorer:'田中太郎',team:'T1',resolveMember});
 assert.equal(r.ready,false);
 assert.equal(r.payload,null);
});
test('only explicit selection of official roster ID unlocks payload',async()=>{
 const resolveMember=createSnapshotMemberResolver(snapshot);
 const r=await prepareGoalIdentityForRegistration({source:'youtube',scorer:'田中太郎',team:'T1',resolveMember,selected:{scorer:'official-id'}});
 assert.equal(r.ready,true);
 assert.equal(r.payload.scorer_id,'official-id');
});
test('missing official IDs do not produce invented candidates',async()=>{
 const resolveMember=createSnapshotMemberResolver({...snapshot,playerIds:undefined});
 const r=await resolveMember({query:'田中太郎'});
 assert.deepEqual(r.candidates,[]);
});

test('actual normalized SS snapshot has names but no verified player IDs',async()=>{
 const current=normalizeSpoSnapshot({event_id:'test-event',matches:[{number:1,seq:1,left_team:'T1',right_team:'T2',status:'scheduled'}],roster:{T1:['田中太郎'],T2:[]},roster_source:'official-current-event-teams'});
 assert.deepEqual(current.players,['田中太郎']);
 assert.equal(current.playerIds,undefined);
 const resolver=createSnapshotMemberResolver(current);
 const r=await prepareGoalIdentityForRegistration({source:'local-video',scorer:'田中太郎',resolveMember:resolver});
 assert.equal(r.ready,false);
 assert.equal(r.payload,null);
});

test('candidate selection is restricted to scoring team',async()=>{
 const roster={players:['田中太郎','田中次郎'],
  playerTeam:new Map([['田中太郎','T1'],['田中次郎','T2']]),
  playerIds:new Map([['田中太郎','id-1'],['田中次郎','id-2']])};
 const resolveMember=createSnapshotMemberResolver(roster);
 const r=await resolveMember({query:'田中',team:'T1'});
 assert.ok(r.candidates.every(c=>c.team==='T1'));
 assert.ok(!r.candidates.some(c=>c.player_id==='id-2'));
 await assert.rejects(()=>prepareGoalIdentityForRegistration({
  source:'local-video',scorer:'田中',team:'T1',resolveMember,
  selected:{scorer:'id-2'}
 }),/名簿/);
});
