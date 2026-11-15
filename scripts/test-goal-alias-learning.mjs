import test from 'node:test';
import assert from 'node:assert/strict';
import {onConfirmedGoalPlayerSelection as learn,resolveSpokenNameChoices} from '../sposched-goal-alias-learning.mjs';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const snapshot={
 matches:[{seq:1,leftTeam:'チーム1',rightTeam:'チーム2'}],
 players:['西村','山口'],
 playerTeam:new Map([['西村','チーム1'],['山口','チーム2']]),
 memberIds:new Map([['西村',A],['山口',B]])
};
const row={seq:1,team:'チーム1',goal:{scorer:'よーさん',assist:''}};
const resolveAlias=async()=>({candidates:[]});
test('human scorer choice invokes the writer with the stable registered member ID',async()=>{
 const writes=[];
 const r=await learn({row,snapshot,field:'scorer',officialName:'西村',resolveAlias,
  writeAlias:async x=>{writes.push(x);return {ok:true,saved:true,user_id:x.user_id,alias:x.alias}}});
 assert.equal(r.saved,true);
 assert.deepEqual(writes,[{alias:'よーさん',person:'西村',user_id:A}]);
});
test('wrong-team member cannot create an alias',async()=>{
 let called=false;
 const r=await learn({row,snapshot,field:'scorer',officialName:'山口',resolveAlias,
  writeAlias:async()=>{called=true;return {ok:true}}});
 assert.equal(r.saved,false);assert.equal(called,false);
});
test('missing spoken name and unsupported field never write',async()=>{
 let called=false;const writeAlias=async()=>{called=true;return {ok:true}};
 assert.equal((await learn({row,snapshot,field:'assist',officialName:'西村',resolveAlias,writeAlias})).saved,false);
 assert.equal((await learn({row,snapshot,field:'team',officialName:'西村',writeAlias})).saved,false);
 assert.equal(called,false);
});
test('shared nickname may attach to another explicitly selected member without overwriting',async()=>{
 const writes=[];
 const r=await learn({row,snapshot,field:'scorer',officialName:'西村',
  resolveAlias:async()=>({candidates:[{name:'山口',user_id:B}]}),
  writeAlias:async input=>{writes.push(input);return {
   ok:true,saved:true,alias:input.alias,user_id:input.user_id,shared:true}}});
 assert.equal(r.saved,true);assert.equal(r.shared,true);
 assert.deepEqual(writes,[{alias:'よーさん',person:'西村',user_id:A}]);
});
test('SS alias lookup must be connected before any write',async()=>{
 let called=false;
 const r=await learn({row,snapshot,field:'scorer',officialName:'西村',
  writeAlias:async()=>{called=true;return {ok:true}}});
 assert.equal(r.saved,false);assert.equal(called,false);
});
test('already registered alias is idempotently skipped based on user_id',async()=>{
 let called=false;
 const r=await learn({row,snapshot,field:'scorer',officialName:'西村',
  resolveAlias:async()=>({candidates:[{name:'別の表示名',user_id:A}]}),
  writeAlias:async()=>{called=true;return {ok:true}}});
 assert.equal(r.saved,false);assert.match(r.reason,/登録済み/);assert.equal(called,false);
});
test('unverified alias lookup identity or missing current member ID refuses mutation',async()=>{
 let count=0;const writeAlias=async()=>{count++;return {ok:true}};
 const unsafe=await learn({row,snapshot,field:'scorer',officialName:'西村',
  resolveAlias:async()=>({candidates:[{name:'山口'}]}),writeAlias});
 assert.equal(unsafe.saved,false);
 const noId=await learn({row,snapshot:{...snapshot,memberIds:new Map()},field:'scorer',
  officialName:'西村',resolveAlias,writeAlias});
 assert.equal(noId.saved,false);assert.equal(count,0);
});
test('same nickname for two players remains ambiguous with team labels',()=>{
 const roster={matches:[{seq:1,leftTeam:'チーム1',rightTeam:'チーム2'}],
  players:['たいせいA','たいせいB'],playerTeam:new Map([['たいせいA','チーム1'],['たいせいB','チーム2']])};
 const aliases=[{alias:'たいせい',name:'たいせいA'},{alias:'たいせい',name:'たいせいB'}];
 const both=resolveSpokenNameChoices({spoken:'たいせい',snapshot:roster,seq:1,aliases});
 assert.equal(both.status,'ambiguous');assert.equal(both.candidates.length,2);
 assert.deepEqual(both.candidates.map(c=>c.team),['チーム1','チーム2']);
 const narrowed=resolveSpokenNameChoices({spoken:'たいせい',snapshot:roster,seq:1,team:'チーム1',aliases});
 assert.equal(narrowed.status,'unique');assert.equal(narrowed.candidates[0].name,'たいせいA');
});

test('analysis official label does not replace raw nickname in post-commit writer',async()=>{
 const writes=[];
 const r=await learn({row:{...row,goal:{scorer:'西村',rawScorer:'よーさん'}},snapshot,
  field:'scorer',officialName:'西村',resolveAlias,
  writeAlias:async x=>{writes.push(x);return {ok:true,saved:true,user_id:x.user_id,alias:x.alias}}});
 assert.equal(r.saved,true);assert.equal(writes[0].alias,'よーさん');
});
