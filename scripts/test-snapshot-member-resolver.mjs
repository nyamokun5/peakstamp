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


const playerA='7c1e2a4b-5d6f-4a8b-9c0d-1e2f3a4b5c6d';
const userA='1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d';
const playerB='8b9c0d1e-2f3a-4b4c-9d5e-6f7a8b9c0d1e';
const importedSnapshot=(rosterPlayers)=>normalizeSpoSnapshot({
 event_id:'test-event',matches:[{number:1,seq:1,left_team:'チーム1',right_team:'チーム2',status:'scheduled'}],
 roster:{チーム1:['たいせいA','たいせいB'],チーム2:[]},
 roster_source:'official-current-event-teams',
 roster_players:rosterPlayers
});
test('official v1.6 snapshot exposes real player_id and member user_id, never guesses',async()=>{
 const current=importedSnapshot([
  {name:'たいせいA',team:'チーム1',player_id:playerA,user_id:userA,type:'member'},
  {name:'たいせいB',team:'チーム1',player_id:playerB,user_id:null,type:'guest'}
 ]);
 assert.equal(current.playerIds.get('たいせいA'),playerA);
 assert.equal(current.memberIds.get('たいせいA'),userA);
 assert.equal(current.memberIds.has('たいせいB'),false);
 const resolveMember=createSnapshotMemberResolver(current);
 const candidate=await resolveMember({query:'たいせいA',team:'チーム1'});
 assert.equal(candidate.confirmed,false,'official ID does not imply user confirmation');
 assert.ok(candidate.candidates.some(c=>c.player_id===playerA));
 assert.equal(candidate.candidates.find(c=>c.player_id===playerA)?.user_id,userA);
 const reviewed=await prepareGoalIdentityForRegistration({
  source:'local-video',scorer:'たいせいA',team:'チーム1',resolveMember,
  selected:{scorer:playerA}
 });
 assert.equal(reviewed.ready,true);
 assert.equal(reviewed.payload.scorer_id,playerA);
});
test('identical display names with distinct official IDs never resolve to one identity',async()=>{
 const current=normalizeSpoSnapshot({
  event_id:'test-event',matches:[{number:1,seq:1,left_team:'チーム1',right_team:'チーム2'}],
  roster:{チーム1:['たいせい'],チーム2:[]},roster_source:'official-current-event-teams',
  roster_players:[
   {name:'たいせい',team:'チーム1',player_id:playerA,user_id:userA},
   {name:'たいせい',team:'チーム1',player_id:playerB,user_id:null}
  ]
 });
 assert.equal(current.playerIds,undefined);
 assert.equal(current.memberIds,undefined);
 const resolved=await createSnapshotMemberResolver(current)({query:'たいせい',team:'チーム1'});
 assert.deepEqual(resolved.candidates,[]);
});
test('fallback and incorrectly assigned identity rows never create official IDs',()=>{
 const data={
  event_id:'test-event',matches:[{number:1,seq:1,left_team:'チーム1',right_team:'チーム2'}],
  roster:{チーム1:['たいせいA'],チーム2:[]},
  roster_players:[{name:'たいせいA',team:'チーム2',player_id:playerA,user_id:userA}]
 };
 assert.equal(normalizeSpoSnapshot({...data,roster_source:'official-current-event-teams'}).playerIds,undefined);
 assert.equal(normalizeSpoSnapshot({...data,roster_source:'event-embedded-fallback',
  roster_players:[{name:'たいせいA',team:'チーム1',player_id:playerA,user_id:userA}]
 }).playerIds,undefined);
});
