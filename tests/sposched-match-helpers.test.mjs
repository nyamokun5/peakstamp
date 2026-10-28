import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeSpoSnapshot,prepareGoalRows} from '../sposched-review-core.mjs';
import {quickGoalDecisions} from '../sposched-quick-review.mjs';
import {prepareWorkerTournament} from '../sposched-worker-batch.mjs';
import {isVerifiedMatchHelper,opposingTeamHelperCandidates,recordVerifiedMatchHelpers}
 from '../sposched-match-helpers.mjs';

const E='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const IDS=['11111111-1111-4111-8111-111111111111',
 '22222222-2222-4222-8222-222222222222',
 '33333333-3333-4333-8333-333333333333',
 '44444444-4444-4444-8444-444444444444'];
const H='55555555-5555-4555-8555-555555555555';
const snap=()=>normalizeSpoSnapshot({
 event_id:E,roster:{
  'チーム1':['橋本 泰成'],'チーム2':['山田'],
  'チーム3':['Hiroyuki Kawata'],'チーム4':['田中']},
 matches:IDS.map((match_id,i)=>({
  seq:i+1,match_id,status:'scheduled',
  left_team:i===1?'チーム3':'チーム1',
  right_team:i===1?'チーム4':'チーム2',
  left_score:0,right_score:0,goals:[]
 }))
});
const row=s=>{
 const r=prepareGoalRows({goals:[{
  id:'video-1',source:{name:'IMG_0287.MOV'},
  scorer:'Hiroyuki Kawata',assist:'橋本 泰成',
  assistStatus:'named',matchSeq:2,matchLabel:'チーム3 vs チーム4'
 }]},s)[0];
 assert.equal(r.team,'チーム3');
 return r;
};
const official=(helpers=[{player_id:H,name:'橋本 泰成'}])=>({
 match_id:IDS[1],event_id:E,seq:2,status:'scheduled',
 left:{name:'チーム3',helpers},right:{name:'チーム4',helpers:[]}
});
test('cross-team assist is held until official SS match helper is confirmed',()=>{
 const s=snap(),r=row(s),rows=[r];
 assert.equal(opposingTeamHelperCandidates(s,r)[0].verified,false);
 assert.match(quickGoalDecisions(s,rows)[0].reason,/助っ人登録/);
 assert.throws(()=>prepareWorkerTournament({
  snapshot:s,rows,decisions:quickGoalDecisions(s,rows),requestId:E
 }),/助っ人登録/);
 const names=recordVerifiedMatchHelpers(s,2,official());
 assert.deepEqual(names,[{name:'橋本 泰成',team:'チーム3',playerId:H}]);
 assert.equal(isVerifiedMatchHelper(s,2,'橋本泰成','チーム3'),true);
 assert.equal(isVerifiedMatchHelper(s,1,'橋本 泰成','チーム3'),false);
 assert.equal(s.playerTeam.get('橋本 泰成'),'チーム1','home team must never be altered');
 const decisions=quickGoalDecisions(s,rows);
 assert.equal(decisions[0].state,'ready');
 const plan=prepareWorkerTournament({snapshot:s,rows,decisions,requestId:E});
 assert.equal(plan.operations.filter(o=>o.action==='create').length,1);
 assert.deepEqual(plan.operations.find(o=>o.action==='create'),{
  seq:2,action:'create',team:'チーム3',
  scorer:'Hiroyuki Kawata',assist:'橋本 泰成',expected_match_id:IDS[1]
 });
});
test('helper on the opposing match side does not authorize same name on scorer side',()=>{
 const s=snap(),r=row(s);
 const m=official([]);m.right.helpers=[{player_id:H,name:'橋本 泰成'}];
 recordVerifiedMatchHelpers(s,2,m);
 assert.equal(isVerifiedMatchHelper(s,2,'橋本 泰成','チーム3'),false);
 assert.equal(quickGoalDecisions(s,[r])[0].state,'attention');
});
test('wrong fixture identity, event or team, duplicated names and missing IDs fail closed',()=>{
 for(const change of [
  m=>m.match_id=IDS[0],m=>m.event_id=IDS[0],
  m=>m.left.name='チーム1',m=>m.seq=1,
  m=>m.left.helpers.push({player_id:IDS[0],name:'橋本泰成'}),
  m=>m.left.helpers[0].player_id='not-a-uuid'
 ]){
  const s=snap(),m=official();change(m);
  assert.throws(()=>recordVerifiedMatchHelpers(s,2,m));
  assert.equal(isVerifiedMatchHelper(s,2,'橋本 泰成','チーム3'),false);
 }
 const s=snap();recordVerifiedMatchHelpers(s,2,official());
 const newSnapshot=snap();
 assert.equal(isVerifiedMatchHelper(newSnapshot,2,'橋本 泰成','チーム3'),false);
 newSnapshot.matches[1].matchId=IDS[0];
 assert.equal(isVerifiedMatchHelper(newSnapshot,2,'橋本 泰成','チーム3'),false);
});
test('PeakStamp UI reads match helpers only and never claims new SS membership',()=>{
 const html=readFileSync(new URL('../sposched-review.html',import.meta.url),'utf8');
 assert.match(html,/SSの試合別助っ人登録を再確認（読み取りのみ）/);
 assert.match(html,/fetchSS\('\/match\?match_id='/);
 assert.match(html,/recordVerifiedMatchHelpers\(snapshot,m.seq,official\)/);
 assert.match(html,/SS側でこの試合の助っ人として登録した後、再確認/);
});
