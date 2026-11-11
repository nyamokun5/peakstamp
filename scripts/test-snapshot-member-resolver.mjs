import test from 'node:test';
import assert from 'node:assert/strict';
import {createSnapshotMemberResolver} from '../sposched-snapshot-member-resolver.mjs';
import {prepareGoalIdentityForRegistration} from '../sposched-goal-identity-gate.mjs';
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
